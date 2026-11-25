"""The Ktemia API client, sync (:class:`Ktemia`) and async (:class:`AsyncKtemia`).

Mirrors ``packages/ktemia/src/client.ts``: the same validation, error mapping,
retry rules and search behaviour, so Python and JavaScript callers (and the
agents built on them) see identical results. Keep it server-side: the API key
must not ship to a browser.
"""

from __future__ import annotations

import asyncio
import email.utils
import math
import os
import time
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

import httpx

from ._version import VERSION
from .errors import EMPTY_RESULT_CODES, KtemiaError
from .validate import check_car_search, check_flight_search, check_hotel_search, check_text

DEFAULT_BASE_URL = "https://api.ktemia.com"
API_KEYS_URL = "https://app.ktemia.com/api-keys"

MAX_RETRY_AFTER_SECONDS = 30
SERVER_RETRY_DELAY_SECONDS = 1.0

LOOKUP_PATHS = {
    "airport": "/flights/airports",
    "airline": "/flights/airlines",
    "hotelLocation": "/hotels/locations",
    "carLocation": "/cars/locations",
}

_CHECKS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "flights": check_flight_search,
    "hotels": check_hotel_search,
    "cars": check_car_search,
}


# ── Shared, transport-free helpers ───────────────────────────────────────────


def _env(name: str) -> str | None:
    value = os.environ.get(name)
    return value.strip() if value and value.strip() else None


def _resolve_base_url(explicit: str | None) -> str:
    raw = (explicit or _env("KTEMIA_API_URL") or DEFAULT_BASE_URL).rstrip("/")
    parts = urlsplit(raw)
    local = parts.hostname in ("localhost", "127.0.0.1")
    # A key sent to the wrong host cannot be taken back, so overrides must be https.
    if parts.scheme != "https" and not local:
        raise KtemiaError(
            code="INSECURE_API_URL",
            status=0,
            message=f"The Ktemia base URL must use https (got {parts.scheme}://{parts.netloc}).",
        )
    return raw


def _compact(obj: dict[str, Any]) -> dict[str, Any]:
    """Drops keys left unset, so the API sees a clean body (it rejects unknown or null fields)."""
    return {k: v for k, v in obj.items() if v is not None}


def _query_pairs(query: dict[str, Any] | None) -> list[tuple[str, str]]:
    """The API reads a list as one comma-separated value; a repeated key keeps only the last."""
    pairs: list[tuple[str, str]] = []
    for key, value in (query or {}).items():
        if value is None:
            continue
        if isinstance(value, (list, tuple)):
            if value:
                pairs.append((key, ",".join(str(v) for v in value)))
        elif isinstance(value, bool):
            pairs.append((key, "true" if value else "false"))
        else:
            pairs.append((key, str(value)))
    return pairs


def parse_retry_after(header: str | None) -> int | None:
    """Retry-After is seconds or an HTTP date. Clamped so a bad header cannot stall a caller."""
    if header is None or not header.strip():
        return None
    value = header.strip()
    try:
        seconds = float(value)
    except ValueError:
        try:
            when = email.utils.parsedate_to_datetime(value)
        except (TypeError, ValueError):
            return None
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        seconds = (when - datetime.now(timezone.utc)).total_seconds()
    if math.isnan(seconds):
        return None
    return int(min(max(math.ceil(seconds), 0), MAX_RETRY_AFTER_SECONDS))


def _parse_error_body(body: Any) -> dict[str, str] | None:
    if not isinstance(body, dict):
        return None
    error = body.get("error")
    if not isinstance(error, dict):
        return None
    code, message = error.get("code"), error.get("message")
    if not isinstance(code, str) or not isinstance(message, str):
        return None
    out = {"code": code, "message": message}
    if isinstance(error.get("param"), str):
        out["param"] = error["param"]
    return out


def _error_from_response(response: httpx.Response, body: Any) -> KtemiaError:
    parsed = _parse_error_body(body)
    status = response.status_code
    retry_after = parse_retry_after(response.headers.get("Retry-After"))

    if status == 429:
        code = parsed["code"] if parsed else "RATE_LIMIT_EXCEEDED"
        if code == "QUOTA_EXCEEDED":
            limit = response.headers.get("X-Quota-Limit")
            return KtemiaError(
                code=code,
                status=status,
                body=body,
                retryable=False,
                message=(
                    (parsed["message"] if parsed else "The monthly request quota for this account is used up.")
                    + " Retrying will not help, and another key on the same account shares the same quota."
                    + (f" The plan allows {limit} requests a month." if limit else "")
                    + " Check the key status (free) for the reset date, or upgrade at https://www.ktemia.com/pricing/."
                ),
            )
        return KtemiaError(
            code=code,
            status=status,
            body=body,
            retryable=True,
            retry_after=retry_after,
            message=(
                (parsed["message"] if parsed else "Too many requests per second.")
                + f" This is a speed limit, not the monthly quota: wait {retry_after if retry_after is not None else 'a few'} seconds and retry."
            ),
        )

    if parsed:
        return KtemiaError(
            code=parsed["code"],
            status=status,
            body=body,
            retryable=status >= 500,
            param=parsed.get("param"),
            message=parsed["message"],
        )
    return KtemiaError(
        code="UPSTREAM_ERROR" if status >= 500 else "REQUEST_FAILED",
        status=status,
        body=body,
        retryable=status >= 500,
        message=f"The Ktemia API returned HTTP {status}.",
    )


def _parse_response(response: httpx.Response) -> Any:
    if response.is_redirect:
        # The key must never follow a redirect to another host.
        raise KtemiaError(
            code="UPSTREAM_ERROR",
            status=response.status_code,
            message="The Ktemia API answered with a redirect, which is not followed so the API key never reaches another host.",
        )
    try:
        body: Any = response.json() if response.content else None
    except ValueError:
        body = None
    if response.is_success:
        if body is None:
            raise KtemiaError(
                code="UPSTREAM_ERROR",
                status=response.status_code,
                retryable=True,
                message="The Ktemia API answered with something that was not JSON.",
            )
        return body
    raise _error_from_response(response, body)


def _transport_error(exc: Exception, timeout: float) -> KtemiaError:
    if isinstance(exc, httpx.TimeoutException):
        return KtemiaError(
            code="TIMEOUT",
            status=0,
            retryable=True,
            message=f"The Ktemia API did not answer within {round(timeout)} seconds.",
        )
    return KtemiaError(
        code="NETWORK_ERROR",
        status=0,
        retryable=True,
        message=f"Could not reach the Ktemia API: {exc}",
    )


def _missing_key_error() -> KtemiaError:
    return KtemiaError(
        code="MISSING_API_KEY",
        status=401,
        message=(
            "No Ktemia API key. Set the KTEMIA_API_KEY environment variable or pass api_key. "
            f"Create a free key at {API_KEYS_URL}; the Free plan includes 100 requests a month."
        ),
    )


def _lookup_query(kind: str, query: str, type: str | None, country: str | None, locale: str | None) -> tuple[str, dict[str, Any]]:
    path = LOOKUP_PATHS.get(kind)
    if not path:
        raise KtemiaError(
            code="INVALID_INPUT",
            status=400,
            param="kind",
            message=f"kind must be one of {', '.join(LOOKUP_PATHS)}.",
        )
    text = check_text(query, "query", "Pass a place, airport, or airline name.")
    params: dict[str, Any] = {"query": text, "country": country, "locale": locale}
    # Only the car endpoint takes a location type; others reject it.
    if kind == "carLocation" and type:
        params["type"] = type
    return path, _compact(params)


def _empty_page(vertical: str, token: str, error: KtemiaError) -> dict[str, Any]:
    return {
        "vertical": vertical,
        "token": token,
        "hasMore": False,
        vertical: [],
        "noResults": {"code": error.code, "message": error.message},
    }


def _no_token_error(vertical: str) -> KtemiaError:
    return KtemiaError(
        code="UPSTREAM_ERROR",
        status=502,
        retryable=True,
        message=f"Ktemia started a {vertical} search but returned no search token.",
    )


class _Base:
    def __init__(
        self,
        api_key: str | None,
        base_url: str | None,
        timeout: float,
        max_retries: int,
        user_agent: str | None,
    ) -> None:
        # Resolved now but checked per request, so constructing a client at
        # import time (as frameworks do) never fails a build that has no key.
        self._api_key = (api_key or "").strip() or _env("KTEMIA_API_KEY")
        self._base_url = _resolve_base_url(base_url)
        self._timeout = timeout
        self._max_retries = max(0, max_retries)
        self._client_id = user_agent or f"ktemia-python/{VERSION}"

    def _headers(self, has_body: bool) -> dict[str, str]:
        if not self._api_key:
            raise _missing_key_error()
        headers = {
            "X-API-Key": self._api_key,
            "X-Ktemia-Client": self._client_id,
            "Accept": "application/json",
        }
        if has_body:
            headers["Content-Type"] = "application/json"
        return headers

    def _next_delay(self, error: KtemiaError, state: dict[str, Any]) -> float | None:
        """How long to wait before retrying, or None to give up. Same rules as the JS client."""
        if error.code == "RATE_LIMIT_EXCEEDED" and state["rate"] < self._max_retries:
            state["rate"] += 1
            return float(error.retry_after if error.retry_after is not None else 1)
        if error.retryable and error.code != "RATE_LIMIT_EXCEEDED" and not state["server"]:
            state["server"] = True
            return SERVER_RETRY_DELAY_SECONDS
        return None


# ── Sync client ──────────────────────────────────────────────────────────────


class Vertical:
    """Search, paging and details for one vertical (flights, hotels or cars)."""

    def __init__(self, client: Ktemia, vertical: str) -> None:
        self._client = client
        self.vertical = vertical

    def search(self, **params: Any) -> dict[str, Any]:
        """Starts a search and reads its first page. Costs two requests.

        Field names are the API's own (``departureDate``, ``pickupLocation``).
        A search that matches nothing returns a page with ``noResults`` set.
        """
        body = _compact(_CHECKS[self.vertical](params))
        try:
            started = self._client.request("POST", f"/{self.vertical}/search", body=body)
        except KtemiaError as error:
            if error.code in EMPTY_RESULT_CODES:
                return _empty_page(self.vertical, "", error)
            raise
        token = started.get("searchToken") if isinstance(started, dict) else None
        if not token:
            raise _no_token_error(self.vertical)
        return self.page(token)

    def page(self, token: str) -> dict[str, Any]:
        """Reads the page at ``token``: a searchToken, or the nextToken of the previous page. Costs one request."""
        t = check_text(token, "token", "Use the nextToken from the previous page.")
        try:
            body = self._client.request("GET", f"/{self.vertical}/results", query={"token": t})
        except KtemiaError as error:
            if error.code in EMPTY_RESULT_CODES:
                return _empty_page(self.vertical, t, error)
            raise
        return {**body, "vertical": self.vertical, "token": t, "hasMore": bool(body.get("hasMore"))}

    def details(self, token: str, result_id: str | int) -> dict[str, Any]:
        """Every price and booking link for one result. ``token`` is the token of the page it appeared on."""
        query = {
            "token": check_text(token, "token", "Use the token of the page the result appeared on."),
            "resultId": check_text(result_id, "resultId", "Use the id of a result from a search page."),
        }
        return self._client.request("GET", f"/{self.vertical}/details", query=query)


class Hotels(Vertical):
    def reviews(self, hotel_id: str | int, **params: Any) -> dict[str, Any]:
        """Guest reviews for one hotel. Pages are numbered, starting at 1. Costs one request."""
        hotel = check_text(hotel_id, "hotelId", "Use the id of a hotel from a search result.")
        return self._client.request("GET", "/hotels/reviews", query=_compact({**params, "hotelId": hotel}))


class Ktemia(_Base):
    """Ktemia travel search: flights, hotels, and rental cars. Search only;
    booking links hand off to the provider.

    >>> kt = Ktemia()  # reads KTEMIA_API_KEY
    >>> page = kt.flights.search(origin="LAX", destination="LON", departureDate="2027-03-14")
    """

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str | None = None,
        timeout: float = 60.0,
        max_retries: int = 2,
        user_agent: str | None = None,
        http_client: httpx.Client | None = None,
        sleep: Callable[[float], None] | None = None,
    ) -> None:
        super().__init__(api_key, base_url, timeout, max_retries, user_agent)
        # follow_redirects stays False: the API key must never be replayed to another origin.
        self._http = http_client or httpx.Client(timeout=timeout, follow_redirects=False)
        self._sleep = sleep or time.sleep
        self.flights = Vertical(self, "flights")
        self.hotels = Hotels(self, "hotels")
        self.cars = Vertical(self, "cars")

    def key_status(self) -> dict[str, Any]:
        """Plan, rate limits, and remaining monthly quota. Free: never counts against the quota."""
        return self.request("GET", "/key")

    def lookup(
        self,
        kind: str,
        query: str,
        *,
        type: str | None = None,
        country: str | None = None,
        locale: str | None = None,
    ) -> dict[str, Any]:
        """Resolves a place or airline name to the codes searches need. Costs one request.

        ``kind`` is ``airport``, ``airline``, ``hotelLocation`` or ``carLocation``.
        """
        path, params = _lookup_query(kind, query, type, country, locale)
        return {"kind": kind, **self.request("GET", path, query=params)}

    def request(self, method: str, path: str, *, query: dict[str, Any] | None = None, body: Any = None) -> Any:
        """Low-level call to any Ktemia endpoint, with the same authentication, error mapping and retries."""
        headers = self._headers(body is not None)
        state = {"rate": 0, "server": False}
        while True:
            try:
                try:
                    response = self._http.request(
                        method,
                        self._base_url + path,
                        params=_query_pairs(query) or None,
                        json=body,
                        headers=headers,
                        timeout=self._timeout,
                    )
                except httpx.HTTPError as exc:
                    raise _transport_error(exc, self._timeout) from exc
                return _parse_response(response)
            except KtemiaError as error:
                delay = self._next_delay(error, state)
                if delay is None:
                    raise
                self._sleep(delay)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> Ktemia:  # noqa: PYI034 - typing.Self needs 3.11
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


# ── Async client ─────────────────────────────────────────────────────────────


class AsyncVertical:
    """Async search, paging and details for one vertical."""

    def __init__(self, client: AsyncKtemia, vertical: str) -> None:
        self._client = client
        self.vertical = vertical

    async def search(self, **params: Any) -> dict[str, Any]:
        """Starts a search and reads its first page. Costs two requests."""
        body = _compact(_CHECKS[self.vertical](params))
        try:
            started = await self._client.request("POST", f"/{self.vertical}/search", body=body)
        except KtemiaError as error:
            if error.code in EMPTY_RESULT_CODES:
                return _empty_page(self.vertical, "", error)
            raise
        token = started.get("searchToken") if isinstance(started, dict) else None
        if not token:
            raise _no_token_error(self.vertical)
        return await self.page(token)

    async def page(self, token: str) -> dict[str, Any]:
        """Reads the page at ``token``. Costs one request."""
        t = check_text(token, "token", "Use the nextToken from the previous page.")
        try:
            body = await self._client.request("GET", f"/{self.vertical}/results", query={"token": t})
        except KtemiaError as error:
            if error.code in EMPTY_RESULT_CODES:
                return _empty_page(self.vertical, t, error)
            raise
        return {**body, "vertical": self.vertical, "token": t, "hasMore": bool(body.get("hasMore"))}

    async def details(self, token: str, result_id: str | int) -> dict[str, Any]:
        """Every price and booking link for one result."""
        query = {
            "token": check_text(token, "token", "Use the token of the page the result appeared on."),
            "resultId": check_text(result_id, "resultId", "Use the id of a result from a search page."),
        }
        return await self._client.request("GET", f"/{self.vertical}/details", query=query)


class AsyncHotels(AsyncVertical):
    async def reviews(self, hotel_id: str | int, **params: Any) -> dict[str, Any]:
        """Guest reviews for one hotel. Costs one request."""
        hotel = check_text(hotel_id, "hotelId", "Use the id of a hotel from a search result.")
        return await self._client.request("GET", "/hotels/reviews", query=_compact({**params, "hotelId": hotel}))


class AsyncKtemia(_Base):
    """The async Ktemia client. Same methods as :class:`Ktemia`, awaited."""

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str | None = None,
        timeout: float = 60.0,
        max_retries: int = 2,
        user_agent: str | None = None,
        http_client: httpx.AsyncClient | None = None,
        sleep: Callable[[float], Awaitable[None]] | None = None,
    ) -> None:
        super().__init__(api_key, base_url, timeout, max_retries, user_agent)
        self._http = http_client or httpx.AsyncClient(timeout=timeout, follow_redirects=False)
        self._sleep = sleep or asyncio.sleep
        self.flights = AsyncVertical(self, "flights")
        self.hotels = AsyncHotels(self, "hotels")
        self.cars = AsyncVertical(self, "cars")

    async def key_status(self) -> dict[str, Any]:
        """Plan, rate limits, and remaining monthly quota. Free."""
        return await self.request("GET", "/key")

    async def lookup(
        self,
        kind: str,
        query: str,
        *,
        type: str | None = None,
        country: str | None = None,
        locale: str | None = None,
    ) -> dict[str, Any]:
        """Resolves a place or airline name to the codes searches need. Costs one request."""
        path, params = _lookup_query(kind, query, type, country, locale)
        return {"kind": kind, **(await self.request("GET", path, query=params))}

    async def request(self, method: str, path: str, *, query: dict[str, Any] | None = None, body: Any = None) -> Any:
        """Low-level async call to any Ktemia endpoint."""
        headers = self._headers(body is not None)
        state = {"rate": 0, "server": False}
        while True:
            try:
                try:
                    response = await self._http.request(
                        method,
                        self._base_url + path,
                        params=_query_pairs(query) or None,
                        json=body,
                        headers=headers,
                        timeout=self._timeout,
                    )
                except httpx.HTTPError as exc:
                    raise _transport_error(exc, self._timeout) from exc
                return _parse_response(response)
            except KtemiaError as error:
                delay = self._next_delay(error, state)
                if delay is None:
                    raise
                await self._sleep(delay)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> AsyncKtemia:  # noqa: PYI034 - typing.Self needs 3.11
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()
