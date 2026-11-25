"""Offline tests for the Python client. Every request goes to an httpx.MockTransport."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest

from ktemia import (
    VERSION,
    AsyncKtemia,
    Ktemia,
    KtemiaError,
    KtemiaValidationError,
    check_flight_search,
    parse_retry_after,
    tool_description,
)

FUTURE = "2099-03-14"
FUTURE_2 = "2099-03-20"


def make(handler, **kw) -> tuple[Ktemia, list[httpx.Request], list[float]]:
    calls: list[httpx.Request] = []
    sleeps: list[float] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return handler(request)

    http = httpx.Client(transport=httpx.MockTransport(wrapped))
    kt = Ktemia(api_key="test-key", http_client=http, sleep=sleeps.append, **kw)
    return kt, calls, sleeps


def ok(data) -> httpx.Response:
    return httpx.Response(200, json=data)


def err(status: int, code: str, message: str = "nope", headers=None, param=None) -> httpx.Response:
    error = {"code": code, "message": message}
    if param:
        error["param"] = param
    return httpx.Response(status, json={"success": False, "error": error, "data": None}, headers=headers)


# ── Requests ─────────────────────────────────────────────────────────────────


def test_sends_key_and_client_id():
    kt, calls, _ = make(lambda r: ok({"plan": {"name": "free"}}))
    kt.key_status()
    req = calls[0]
    assert req.url.path == "/key"
    assert req.headers["X-API-Key"] == "test-key"
    assert req.headers["X-Ktemia-Client"] == f"ktemia-python/{VERSION}"


def test_missing_key_never_sends(monkeypatch):
    monkeypatch.delenv("KTEMIA_API_KEY", raising=False)
    calls = []
    kt = Ktemia(http_client=httpx.Client(transport=httpx.MockTransport(lambda r: calls.append(r) or ok({}))))
    with pytest.raises(KtemiaError) as info:
        kt.key_status()
    assert info.value.code == "MISSING_API_KEY"
    assert calls == []


def test_reads_key_from_env(monkeypatch):
    monkeypatch.setenv("KTEMIA_API_KEY", "env-key")
    seen = []
    kt = Ktemia(http_client=httpx.Client(transport=httpx.MockTransport(lambda r: seen.append(r) or ok({}))))
    kt.key_status()
    assert seen[0].headers["X-API-Key"] == "env-key"


def test_rejects_insecure_base_url():
    with pytest.raises(KtemiaError) as info:
        Ktemia(api_key="k", base_url="http://evil.example.com")
    assert info.value.code == "INSECURE_API_URL"
    Ktemia(api_key="k", base_url="http://localhost:8000")  # local dev is fine


def test_search_posts_then_reads_first_page():
    def handler(r: httpx.Request):
        if r.method == "POST":
            assert r.url.path == "/flights/search"
            assert json.loads(r.content) == {"origin": "LAX", "destination": "LON", "departureDate": FUTURE}
            return ok({"searchToken": "tok1", "expiresIn": 3600})
        assert r.url.path == "/flights/results"
        assert r.url.params["token"] == "tok1"
        return ok({"flights": [{"id": "f1"}], "hasMore": True, "nextToken": "tok2"})

    kt, calls, _ = make(handler)
    page = kt.flights.search(origin="lax", destination="LON", departureDate=FUTURE)
    assert [c.method for c in calls] == ["POST", "GET"]
    assert page["vertical"] == "flights" and page["token"] == "tok1"
    assert page["hasMore"] is True and page["nextToken"] == "tok2"


def test_empty_search_returns_page_not_error():
    kt, _, _ = make(lambda r: ok({"searchToken": "t"}) if r.method == "POST" else err(404, "NO_RESULTS", "Nothing"))
    page = kt.flights.search(origin="LAX", destination="LON", departureDate=FUTURE)
    assert page["flights"] == [] and page["hasMore"] is False
    assert page["noResults"]["code"] == "NO_RESULTS"


def test_list_query_is_comma_joined():
    kt, calls, _ = make(lambda r: ok({"reviews": []}))
    kt.hotels.reviews(12345, sources=["booking", "agoda"], months=[1, 2], page=2)
    q = calls[0].url.params
    assert q["hotelId"] == "12345"
    assert q["sources"] == "booking,agoda"
    assert q["months"] == "1,2"
    assert q.get_list("sources") == ["booking,agoda"]


def test_lookup_sends_type_only_for_cars():
    kt, calls, _ = make(lambda r: ok({"locations": []}))
    out = kt.lookup("hotelLocation", "Lisbon", type="city")
    assert "type" not in calls[0].url.params and out["kind"] == "hotelLocation"
    kt.lookup("carLocation", "Lisbon", type="airport")
    assert calls[1].url.params["type"] == "airport" and calls[1].url.path == "/cars/locations"


def test_lookup_unknown_kind():
    kt, calls, _ = make(lambda r: ok({}))
    with pytest.raises(KtemiaError) as info:
        kt.lookup("train", "Paris")
    assert info.value.param == "kind" and calls == []


# ── Errors and retries ───────────────────────────────────────────────────────


def test_quota_exceeded_is_never_retried():
    kt, calls, sleeps = make(lambda r: err(429, "QUOTA_EXCEEDED", "Quota used", {"X-Quota-Limit": "100"}))
    with pytest.raises(KtemiaError) as info:
        kt.key_status()
    assert info.value.code == "QUOTA_EXCEEDED" and info.value.retryable is False
    assert "100 requests a month" in info.value.message
    assert len(calls) == 1 and sleeps == []


def test_rate_limit_retries_with_retry_after():
    responses = iter([err(429, "RATE_LIMIT_EXCEEDED", "slow", {"Retry-After": "3"}), ok({"plan": {}})])
    kt, calls, sleeps = make(lambda r: next(responses))
    assert kt.key_status() == {"plan": {}}
    assert len(calls) == 2 and sleeps == [3.0]


def test_rate_limit_gives_up_after_max_retries():
    kt, calls, sleeps = make(lambda r: err(429, "RATE_LIMIT_EXCEEDED", headers={"Retry-After": "1"}), max_retries=2)
    with pytest.raises(KtemiaError) as info:
        kt.key_status()
    assert info.value.code == "RATE_LIMIT_EXCEEDED" and info.value.retryable is True
    assert len(calls) == 3 and sleeps == [1.0, 1.0]


def test_server_error_retried_once():
    kt, calls, sleeps = make(lambda r: err(502, "SEARCH_FAILED"))
    with pytest.raises(KtemiaError) as info:
        kt.key_status()
    assert info.value.code == "SEARCH_FAILED" and info.value.retryable
    assert len(calls) == 2 and len(sleeps) == 1


def test_client_error_keeps_code_and_param():
    kt, calls, _ = make(lambda r: err(400, "INVALID_ORIGIN", "Unknown origin", param="origin"))
    with pytest.raises(KtemiaError) as info:
        kt.lookup("airport", "x")
    e = info.value
    assert (e.code, e.status, e.param, e.retryable) == ("INVALID_ORIGIN", 400, "origin", False)
    assert len(calls) == 1
    assert e.to_dict() == {"code": "INVALID_ORIGIN", "message": "Unknown origin", "retryable": False, "param": "origin"}


def test_search_expired_not_retried():
    kt, calls, _ = make(lambda r: err(410, "SEARCH_EXPIRED"))
    with pytest.raises(KtemiaError) as info:
        kt.flights.page("old")
    assert info.value.code == "SEARCH_EXPIRED" and len(calls) == 1


def test_redirect_is_not_followed():
    kt, calls, _ = make(lambda r: httpx.Response(302, headers={"Location": "https://evil.example.com/"}))
    with pytest.raises(KtemiaError):
        kt.key_status()
    assert all(c.url.host == "api.ktemia.com" for c in calls)


def test_non_json_success_is_an_error():
    kt, _, _ = make(lambda r: httpx.Response(200, text="<html>"))
    with pytest.raises(KtemiaError) as info:
        kt.key_status()
    assert info.value.code == "UPSTREAM_ERROR"


def test_network_error_maps_to_code():
    def boom(r):
        raise httpx.ConnectError("refused")

    kt, _, _ = make(boom)
    with pytest.raises(KtemiaError) as info:
        kt.key_status()
    assert info.value.code == "NETWORK_ERROR" and info.value.status == 0


def test_parse_retry_after():
    assert parse_retry_after("5") == 5
    assert parse_retry_after("999") == 30
    assert parse_retry_after("") is None
    assert parse_retry_after("soon") is None


# ── Validation (nothing is sent) ─────────────────────────────────────────────

NOW = datetime(2026, 11, 25, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    ("params", "param"),
    [
        ({"origin": "LAX", "destination": "LON", "departureDate": "2020-01-01"}, "departureDate"),
        ({"origin": "Los Angeles", "destination": "LON", "departureDate": FUTURE}, "origin"),
        ({"origin": "LAX", "destination": "LON", "departureDate": "2027-02-30"}, "departureDate"),
        ({"origin": "LAX", "destination": "LON"}, "departureDate"),
        ({"origin": "LAX", "destination": "LON", "departureDate": FUTURE_2, "returnDate": FUTURE}, "returnDate"),
        ({"origin": "LAX", "legs": [{"origin": "LAX", "destination": "LON", "date": FUTURE}]}, "legs"),
        ({"legs": [{"origin": "LAX", "destination": "LON", "date": FUTURE}]}, "legs"),
        (
            {"origin": "LAX", "destination": "LON", "departureDate": FUTURE, "passengers": {"adults": 1, "infantsOnLap": 2}},
            "passengers.infantsOnLap",
        ),
        ({"origin": "LAX", "destination": "LON", "departureDate": FUTURE, "passengers": {"adults": 10}}, "passengers"),
    ],
)
def test_flight_validation(params, param):
    with pytest.raises(KtemiaValidationError) as info:
        check_flight_search(params, NOW)
    assert info.value.param == param and info.value.code == "INVALID_INPUT"
    assert "no quota was used" in info.value.message


def test_validation_sends_nothing():
    kt, calls, _ = make(lambda r: ok({}))
    with pytest.raises(KtemiaValidationError):
        kt.hotels.search(location="Lisbon", checkin=FUTURE, checkout=FUTURE)  # zero nights
    with pytest.raises(KtemiaValidationError):
        kt.cars.search(pickupLocation="123", pickupDate=FUTURE, dropoffDate=FUTURE, pickupTime="9:15")
    assert calls == []


def test_multi_city_is_normalised():
    body = check_flight_search(
        {"legs": [{"origin": "lax", "destination": "lon", "date": FUTURE}, {"origin": "LON", "destination": "PAR", "date": FUTURE_2}]},
        NOW,
    )
    assert body["legs"][0] == {"origin": "LAX", "destination": "LON", "date": FUTURE}


# ── Async parity ─────────────────────────────────────────────────────────────


async def test_async_search_and_quota():
    calls = []

    def handler(r):
        calls.append(r)
        if r.url.path == "/key":
            return err(429, "QUOTA_EXCEEDED")
        if r.method == "POST":
            return ok({"searchToken": "a1"})
        return ok({"cars": [{"id": "c"}], "hasMore": False})

    slept = []

    async def sleep(s):
        slept.append(s)

    kt = AsyncKtemia(api_key="k", http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)), sleep=sleep)
    page = await kt.cars.search(pickupLocation=29230, pickupDate=FUTURE, dropoffDate=FUTURE_2)
    assert page["cars"] == [{"id": "c"}] and page["token"] == "a1"
    assert json.loads(calls[0].content)["pickupLocation"] == "29230"
    with pytest.raises(KtemiaError) as info:
        await kt.key_status()
    assert info.value.code == "QUOTA_EXCEEDED" and slept == []


# ── Shared spec ──────────────────────────────────────────────────────────────


def test_spec_matches_js_package():
    here = Path(__file__).resolve()
    py_spec = here.parents[1] / "src" / "ktemia" / "tools.json"
    js_spec = here.parents[3] / "packages" / "ktemia" / "src" / "tools.json"
    if not js_spec.exists():
        pytest.skip("not running inside the monorepo")
    assert json.loads(py_spec.read_text()) == json.loads(js_spec.read_text()), "run npm run sync-spec"


def test_tool_description_has_notes():
    text = tool_description("ktemia_search_flights", ["quotaNote"])
    assert text.startswith(tool_description("ktemia_search_flights")) and len(text) > 40
