"""Ktemia travel search tools for LangChain.

Every tool's name and description comes from the shared Ktemia tool spec, so a
model sees the same guidance here as through the Ktemia MCP server and the
Vercel AI SDK tools. Parameter names are the API's own (``departureDate``,
``pickupLocation``) for the same reason.

Errors the model can act on (a past date, a spent quota, a rate limit) are
returned as ``{"error": {...}}`` JSON instead of raised, so the model reads the
reason and decides what to do next, for example asking the user for a date.
"""

from __future__ import annotations

import json
from typing import Any, Literal

from ktemia import AsyncKtemia, Ktemia, KtemiaError, enum_values, param_description, tool_description
from langchain_core.callbacks import AsyncCallbackManagerForToolRun, CallbackManagerForToolRun
from langchain_core.tools import BaseTool
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from ._version import VERSION

SEARCH_NOTES = ["askDoNotGuessNote", "tokenLifetimeNote", "quotaNote", "searchNotBookNote"]

KEY_STATUS = "ktemia_key_status"
LOOKUP = "ktemia_lookup"
SEARCH_FLIGHTS = "ktemia_search_flights"
SEARCH_HOTELS = "ktemia_search_hotels"
SEARCH_CARS = "ktemia_search_cars"
GET_DETAILS = "ktemia_get_details"
HOTEL_REVIEWS = "ktemia_get_hotel_reviews"


def _d(tool: str, param: str) -> str:
    return param_description(tool, param)


IdLike = str | int
CarClass = Literal[tuple(enum_values("carClass"))]  # type: ignore[valid-type]

# ── Input schemas (limits match the live API) ────────────────────────────────


class KeyStatusInput(BaseModel):
    """No input: reports the plan, limits and remaining monthly quota."""


class LookupInput(BaseModel):
    kind: Literal["airport", "airline", "hotelLocation", "carLocation"] = Field(description=_d(LOOKUP, "kind"))
    query: str = Field(min_length=1, description=_d(LOOKUP, "query"))
    type: Literal["city", "airport", "all"] | None = Field(default=None, description=_d(LOOKUP, "type"))
    country: str | None = Field(default=None, min_length=2, max_length=2, description=_d(LOOKUP, "country"))
    locale: str | None = Field(default=None, description=_d(LOOKUP, "locale"))


class Leg(BaseModel):
    model_config = ConfigDict(extra="forbid")
    origin: str
    destination: str
    date: str


class Passengers(BaseModel):
    model_config = ConfigDict(extra="forbid")
    adults: int | None = Field(default=None, ge=0, le=9)
    children: int | None = Field(default=None, ge=0, le=9)
    infantsOnLap: int | None = Field(default=None, ge=0, le=9)


class SearchFlightsInput(BaseModel):
    nextToken: str | None = Field(default=None, description=_d(SEARCH_FLIGHTS, "nextToken"))
    origin: str | None = Field(default=None, description=_d(SEARCH_FLIGHTS, "origin"))
    destination: str | None = Field(default=None, description=_d(SEARCH_FLIGHTS, "destination"))
    departureDate: str | None = Field(default=None, description=_d(SEARCH_FLIGHTS, "departureDate"))
    returnDate: str | None = Field(default=None, description=_d(SEARCH_FLIGHTS, "returnDate"))
    legs: list[Leg] | None = Field(default=None, description=_d(SEARCH_FLIGHTS, "legs"))
    cabin: Literal["economy", "premiumEconomy", "business", "first"] | None = Field(
        default=None, description=_d(SEARCH_FLIGHTS, "cabin")
    )
    passengers: Passengers | None = Field(default=None, description=_d(SEARCH_FLIGHTS, "passengers"))
    maxStops: int | None = Field(default=None, ge=0, le=2, description=_d(SEARCH_FLIGHTS, "maxStops"))
    airlines: list[str] | None = Field(default=None, description=_d(SEARCH_FLIGHTS, "airlines"))
    alliances: list[Literal["oneworld", "skyteam", "starAlliance"]] | None = Field(
        default=None, description=_d(SEARCH_FLIGHTS, "alliances")
    )
    maxPrice: float | None = Field(default=None, gt=0, description=_d(SEARCH_FLIGHTS, "maxPrice"))
    sortBy: Literal["bestValue", "price", "duration", "departure", "arrival"] | None = Field(
        default=None, description=_d(SEARCH_FLIGHTS, "sortBy")
    )
    sortOrder: Literal["asc", "desc"] | None = Field(default=None, description=_d(SEARCH_FLIGHTS, "sortOrder"))
    country: str | None = Field(default=None, min_length=2, max_length=2, description=_d(SEARCH_FLIGHTS, "country"))


class SearchHotelsInput(BaseModel):
    nextToken: str | None = Field(default=None, description=_d(SEARCH_HOTELS, "nextToken"))
    location: IdLike | None = Field(default=None, description=_d(SEARCH_HOTELS, "location"))
    checkin: str | None = Field(default=None, description=_d(SEARCH_HOTELS, "checkin"))
    checkout: str | None = Field(default=None, description=_d(SEARCH_HOTELS, "checkout"))
    adults: int | None = Field(default=None, ge=1, le=16, description=_d(SEARCH_HOTELS, "adults"))
    rooms: int | None = Field(default=None, ge=1, le=8, description=_d(SEARCH_HOTELS, "rooms"))
    childAges: list[int] | None = Field(default=None, description=_d(SEARCH_HOTELS, "childAges"))
    minStars: int | None = Field(default=None, ge=2, le=5, description=_d(SEARCH_HOTELS, "minStars"))
    minRating: float | None = Field(default=None, description=_d(SEARCH_HOTELS, "minRating"))
    maxPrice: float | None = Field(default=None, gt=0, description=_d(SEARCH_HOTELS, "maxPrice"))
    freeCancellation: bool | None = Field(default=None, description=_d(SEARCH_HOTELS, "freeCancellation"))
    amenities: list[str] | None = Field(default=None, description=_d(SEARCH_HOTELS, "amenities"))
    providers: list[str] | None = Field(default=None, description=_d(SEARCH_HOTELS, "providers"))
    sortBy: Literal["bestValue", "price", "rating", "stars", "distance"] | None = Field(
        default=None, description=_d(SEARCH_HOTELS, "sortBy")
    )
    sortOrder: Literal["asc", "desc"] | None = Field(default=None, description=_d(SEARCH_HOTELS, "sortOrder"))
    country: str | None = Field(default=None, min_length=2, max_length=2, description=_d(SEARCH_HOTELS, "country"))


class SearchCarsInput(BaseModel):
    nextToken: str | None = Field(default=None, description=_d(SEARCH_CARS, "nextToken"))
    pickupLocation: IdLike | None = Field(default=None, description=_d(SEARCH_CARS, "pickupLocation"))
    dropoffLocation: IdLike | None = Field(default=None, description=_d(SEARCH_CARS, "dropoffLocation"))
    pickupDate: str | None = Field(default=None, description=_d(SEARCH_CARS, "pickupDate"))
    dropoffDate: str | None = Field(default=None, description=_d(SEARCH_CARS, "dropoffDate"))
    pickupTime: str | None = Field(default=None, description=_d(SEARCH_CARS, "pickupTime"))
    dropoffTime: str | None = Field(default=None, description=_d(SEARCH_CARS, "dropoffTime"))
    driverAge: int | None = Field(default=None, ge=18, le=99, description=_d(SEARCH_CARS, "driverAge"))
    carClass: CarClass | None = Field(default=None, description=_d(SEARCH_CARS, "carClass"))
    transmission: Literal["automatic", "manual"] | None = Field(default=None, description=_d(SEARCH_CARS, "transmission"))
    maxPrice: float | None = Field(default=None, gt=0, description=_d(SEARCH_CARS, "maxPrice"))
    providers: list[str] | None = Field(default=None, description=_d(SEARCH_CARS, "providers"))
    agencies: list[str] | None = Field(default=None, description=_d(SEARCH_CARS, "agencies"))
    sortBy: Literal["bestValue", "price", "rating", "distance"] | None = Field(
        default=None, description=_d(SEARCH_CARS, "sortBy")
    )
    sortOrder: Literal["asc", "desc"] | None = Field(default=None, description=_d(SEARCH_CARS, "sortOrder"))
    priceMode: Literal["total", "perDay"] | None = Field(default=None, description=_d(SEARCH_CARS, "priceMode"))
    country: str | None = Field(default=None, min_length=2, max_length=2, description=_d(SEARCH_CARS, "country"))


class GetDetailsInput(BaseModel):
    vertical: Literal["flights", "hotels", "cars"] = Field(description=_d(GET_DETAILS, "vertical"))
    token: str = Field(min_length=1, description=_d(GET_DETAILS, "token"))
    resultId: IdLike = Field(description=_d(GET_DETAILS, "resultId"))


class HotelReviewsInput(BaseModel):
    hotelId: IdLike = Field(description=_d(HOTEL_REVIEWS, "hotelId"))
    sortBy: Literal["recent", "oldest", "highestScore", "lowestScore"] | None = Field(
        default=None, description=_d(HOTEL_REVIEWS, "sortBy")
    )
    travelerTypes: list[Literal["families", "couples", "solo", "friends", "business"]] | None = Field(
        default=None, description=_d(HOTEL_REVIEWS, "travelerTypes")
    )
    months: list[int] | None = Field(default=None, description=_d(HOTEL_REVIEWS, "months"))
    sources: list[Literal["booking", "agoda", "priceline"]] | None = Field(
        default=None, description=_d(HOTEL_REVIEWS, "sources")
    )
    search: str | None = Field(default=None, description=_d(HOTEL_REVIEWS, "search"))
    page: int | None = Field(default=None, ge=1, le=1000, description=_d(HOTEL_REVIEWS, "page"))


# ── Helpers ──────────────────────────────────────────────────────────────────


def _clean(kwargs: dict[str, Any]) -> dict[str, Any]:
    """Drops unset values and turns nested models into plain dicts for the API."""
    out: dict[str, Any] = {}
    for key, value in kwargs.items():
        if value is None:
            continue
        if isinstance(value, BaseModel):
            value = {k: v for k, v in value.model_dump().items() if v is not None}
        elif isinstance(value, list):
            value = [
                {k: v for k, v in item.model_dump().items() if v is not None} if isinstance(item, BaseModel) else item
                for item in value
            ]
        out[key] = value
    return out


def _with_hint(name: str, page: dict[str, Any]) -> dict[str, Any]:
    if page.get("noResults"):
        hint = "The search matched nothing. Suggest other dates, a nearby airport, or fewer filters."
    elif page.get("nextToken"):
        hint = f"More results are available. To read the next page, call {name} with nextToken only."
    else:
        hint = "This is the last page of results."
    return {**page, "pagingHint": hint}


def _dump(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, default=str)


# ── Base tool ────────────────────────────────────────────────────────────────


class KtemiaBaseTool(BaseTool):
    """Shared plumbing: lazy clients and model-readable error results."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    api_key: SecretStr | None = Field(default=None, exclude=True)
    """Ktemia API key. Defaults to the ``KTEMIA_API_KEY`` environment variable."""
    client: Ktemia | None = Field(default=None, exclude=True)
    """Reuse an existing sync client instead of creating one."""
    async_client: AsyncKtemia | None = Field(default=None, exclude=True)
    """Reuse an existing async client instead of creating one."""

    def _sync_client(self) -> Ktemia:
        if self.client is None:
            key = self.api_key.get_secret_value() if self.api_key else None
            self.client = Ktemia(key, user_agent=f"langchain-ktemia/{VERSION}")
        return self.client

    def _async_client(self) -> AsyncKtemia:
        if self.async_client is None:
            key = self.api_key.get_secret_value() if self.api_key else None
            self.async_client = AsyncKtemia(key, user_agent=f"langchain-ktemia/{VERSION}")
        return self.async_client

    def _call(self, kt: Ktemia, args: dict[str, Any]) -> Any:  # pragma: no cover - overridden
        raise NotImplementedError

    async def _acall(self, kt: AsyncKtemia, args: dict[str, Any]) -> Any:  # pragma: no cover - overridden
        raise NotImplementedError

    def _run(self, run_manager: CallbackManagerForToolRun | None = None, **kwargs: Any) -> str:
        try:
            return _dump(self._call(self._sync_client(), _clean(kwargs)))
        except KtemiaError as error:
            return _dump({"error": error.to_dict()})

    async def _arun(self, run_manager: AsyncCallbackManagerForToolRun | None = None, **kwargs: Any) -> str:
        try:
            return _dump(await self._acall(self._async_client(), _clean(kwargs)))
        except KtemiaError as error:
            return _dump({"error": error.to_dict()})


# ── Tools ────────────────────────────────────────────────────────────────────


class KtemiaKeyStatus(KtemiaBaseTool):
    """Plan, rate limits and remaining monthly quota. Free: never counts against the quota."""

    name: str = KEY_STATUS
    description: str = tool_description(KEY_STATUS)
    args_schema: type[BaseModel] = KeyStatusInput

    def _call(self, kt: Ktemia, args: dict[str, Any]) -> Any:
        return kt.key_status()

    async def _acall(self, kt: AsyncKtemia, args: dict[str, Any]) -> Any:
        return await kt.key_status()


class KtemiaLookup(KtemiaBaseTool):
    """Resolves place and airline names to the codes and ids searches need."""

    name: str = LOOKUP
    description: str = tool_description(LOOKUP, ["quotaNote"])
    args_schema: type[BaseModel] = LookupInput

    def _call(self, kt: Ktemia, args: dict[str, Any]) -> Any:
        return kt.lookup(args.pop("kind"), args.pop("query"), **args)

    async def _acall(self, kt: AsyncKtemia, args: dict[str, Any]) -> Any:
        return await kt.lookup(args.pop("kind"), args.pop("query"), **args)


class _SearchTool(KtemiaBaseTool):
    vertical: str = ""

    def _call(self, kt: Ktemia, args: dict[str, Any]) -> Any:
        resource = getattr(kt, self.vertical)
        token = args.pop("nextToken", None)
        page = resource.page(token) if token else resource.search(**args)
        return _with_hint(self.name, page)

    async def _acall(self, kt: AsyncKtemia, args: dict[str, Any]) -> Any:
        resource = getattr(kt, self.vertical)
        token = args.pop("nextToken", None)
        page = await resource.page(token) if token else await resource.search(**args)
        return _with_hint(self.name, page)


class KtemiaSearchFlights(_SearchTool):
    """Searches flights across airlines and booking sites. Pass nextToken alone for the next page."""

    name: str = SEARCH_FLIGHTS
    description: str = tool_description(SEARCH_FLIGHTS, SEARCH_NOTES)
    args_schema: type[BaseModel] = SearchFlightsInput
    vertical: str = "flights"


class KtemiaSearchHotels(_SearchTool):
    """Searches hotels by locationId. Pass nextToken alone for the next page."""

    name: str = SEARCH_HOTELS
    description: str = tool_description(SEARCH_HOTELS, SEARCH_NOTES)
    args_schema: type[BaseModel] = SearchHotelsInput
    vertical: str = "hotels"


class KtemiaSearchCars(_SearchTool):
    """Searches rental cars by locationId. Pass nextToken alone for the next page."""

    name: str = SEARCH_CARS
    description: str = tool_description(SEARCH_CARS, SEARCH_NOTES)
    args_schema: type[BaseModel] = SearchCarsInput
    vertical: str = "cars"


class KtemiaGetDetails(KtemiaBaseTool):
    """Every seller's price and booking link for one chosen result."""

    name: str = GET_DETAILS
    description: str = tool_description(GET_DETAILS, ["tokenLifetimeNote", "quotaNote", "searchNotBookNote"])
    args_schema: type[BaseModel] = GetDetailsInput

    def _call(self, kt: Ktemia, args: dict[str, Any]) -> Any:
        vertical = args["vertical"]
        return {"vertical": vertical, **getattr(kt, vertical).details(args["token"], args["resultId"])}

    async def _acall(self, kt: AsyncKtemia, args: dict[str, Any]) -> Any:
        vertical = args["vertical"]
        return {"vertical": vertical, **(await getattr(kt, vertical).details(args["token"], args["resultId"]))}


class KtemiaHotelReviews(KtemiaBaseTool):
    """Guest reviews for one hotel, with filters and numbered pages."""

    name: str = HOTEL_REVIEWS
    description: str = tool_description(HOTEL_REVIEWS, ["quotaNote"])
    args_schema: type[BaseModel] = HotelReviewsInput

    def _call(self, kt: Ktemia, args: dict[str, Any]) -> Any:
        return kt.hotels.reviews(args.pop("hotelId"), **args)

    async def _acall(self, kt: AsyncKtemia, args: dict[str, Any]) -> Any:
        return await kt.hotels.reviews(args.pop("hotelId"), **args)


ALL_TOOLS: tuple[type[KtemiaBaseTool], ...] = (
    KtemiaKeyStatus,
    KtemiaLookup,
    KtemiaSearchFlights,
    KtemiaSearchHotels,
    KtemiaSearchCars,
    KtemiaGetDetails,
    KtemiaHotelReviews,
)
