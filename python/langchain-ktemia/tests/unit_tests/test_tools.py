"""Behaviour tests: every request goes to an httpx.MockTransport."""

from __future__ import annotations

import json

import httpx
import pytest
from ktemia import AsyncKtemia, Ktemia, tool_description
from pydantic import ValidationError

from langchain_ktemia import (
    VERSION,
    KtemiaGetDetails,
    KtemiaHotelReviews,
    KtemiaKeyStatus,
    KtemiaLookup,
    KtemiaSearchCars,
    KtemiaSearchFlights,
    KtemiaToolkit,
)

FUTURE, FUTURE_2 = "2099-03-14", "2099-03-20"


def clients(handler):
    calls: list[httpx.Request] = []

    def wrapped(r):
        calls.append(r)
        return handler(r)

    sync = Ktemia(
        "k",
        user_agent=f"langchain-ktemia/{VERSION}",
        http_client=httpx.Client(transport=httpx.MockTransport(wrapped)),
        sleep=lambda s: None,
    )

    async def nosleep(s):
        return None

    asy = AsyncKtemia(
        "k",
        user_agent=f"langchain-ktemia/{VERSION}",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(wrapped)),
        sleep=nosleep,
    )
    return sync, asy, calls


def ok(data):
    return httpx.Response(200, json=data)


def test_toolkit_has_seven_tools_with_spec_names():
    tools = KtemiaToolkit(api_key="k").get_tools()
    assert [t.name for t in tools] == [
        "ktemia_key_status",
        "ktemia_lookup",
        "ktemia_search_flights",
        "ktemia_search_hotels",
        "ktemia_search_cars",
        "ktemia_get_details",
        "ktemia_get_hotel_reviews",
    ]
    assert all(t.description for t in tools)
    assert tools[2].description.startswith(tool_description("ktemia_search_flights"))


def test_toolkit_shares_one_client():
    tools = KtemiaToolkit(api_key="k").get_tools()
    assert len({id(t.client) for t in tools}) == 1


def test_flight_search_runs_search_then_page_and_adds_hint():
    def handler(r):
        if r.method == "POST":
            body = json.loads(r.content)
            assert body == {"origin": "LAX", "destination": "LON", "departureDate": FUTURE, "passengers": {"adults": 2}}
            return ok({"searchToken": "t1"})
        return ok({"flights": [{"id": "f"}], "hasMore": True, "nextToken": "t2"})

    sync, _, calls = clients(handler)
    out = json.loads(
        KtemiaSearchFlights(client=sync).invoke(
            {"origin": "lax", "destination": "LON", "departureDate": FUTURE, "passengers": {"adults": 2}}
        )
    )
    assert [c.method for c in calls] == ["POST", "GET"]
    assert calls[0].headers["X-Ktemia-Client"] == f"langchain-ktemia/{VERSION}"
    assert out["nextToken"] == "t2" and "nextToken only" in out["pagingHint"]


def test_next_token_reads_page_only():
    sync, _, calls = clients(lambda r: ok({"flights": [], "hasMore": False}))
    out = json.loads(KtemiaSearchFlights(client=sync).invoke({"nextToken": "t2"}))
    assert [c.method for c in calls] == ["GET"] and calls[0].url.params["token"] == "t2"
    assert out["pagingHint"] == "This is the last page of results."


def test_validation_error_is_returned_not_raised_and_sends_nothing():
    sync, _, calls = clients(lambda r: ok({}))
    out = json.loads(
        KtemiaSearchFlights(client=sync).invoke({"origin": "Los Angeles", "destination": "LON", "departureDate": FUTURE})
    )
    assert out["error"]["code"] == "INVALID_INPUT" and out["error"]["param"] == "origin"
    assert calls == []


def test_quota_error_is_returned_and_not_retried():
    sync, _, calls = clients(
        lambda r: httpx.Response(429, json={"success": False, "error": {"code": "QUOTA_EXCEEDED", "message": "Used up"}})
    )
    out = json.loads(KtemiaKeyStatus(client=sync).invoke({}))
    assert out["error"]["code"] == "QUOTA_EXCEEDED" and out["error"]["retryable"] is False
    assert len(calls) == 1


def test_no_results_gives_suggestion_hint():
    def handler(r):
        if r.method == "POST":
            return ok({"searchToken": "t"})
        return httpx.Response(404, json={"success": False, "error": {"code": "NO_RESULTS", "message": "none"}})

    sync, _, _ = clients(handler)
    out = json.loads(
        KtemiaSearchCars(client=sync).invoke({"pickupLocation": 28501, "pickupDate": FUTURE, "dropoffDate": FUTURE_2})
    )
    assert out["cars"] == [] and "matched nothing" in out["pagingHint"]


def test_lookup_and_details_and_reviews():
    sync, _, calls = clients(lambda r: ok({"items": []}))
    json.loads(KtemiaLookup(client=sync).invoke({"kind": "carLocation", "query": "London", "type": "airport"}))
    assert calls[-1].url.path == "/cars/locations" and calls[-1].url.params["type"] == "airport"
    d = json.loads(KtemiaGetDetails(client=sync).invoke({"vertical": "hotels", "token": "t", "resultId": 123}))
    assert d["vertical"] == "hotels" and calls[-1].url.params["resultId"] == "123"
    KtemiaHotelReviews(client=sync).invoke({"hotelId": 99, "sources": ["booking", "agoda"]})
    assert calls[-1].url.params["sources"] == "booking,agoda"


def test_out_of_range_input_is_rejected_by_schema():
    sync, _, calls = clients(lambda r: ok({}))
    tool = KtemiaSearchFlights(client=sync)
    with pytest.raises(ValidationError):
        tool.invoke({"origin": "LAX", "destination": "LON", "departureDate": FUTURE, "maxStops": 5})
    assert calls == []


async def test_async_invoke():
    def handler(r):
        if r.method == "POST":
            return ok({"searchToken": "a"})
        return ok({"hotels": [{"id": "h"}], "hasMore": False})

    _, asy, calls = clients(handler)
    from langchain_ktemia import KtemiaSearchHotels

    out = json.loads(
        await KtemiaSearchHotels(async_client=asy).ainvoke({"location": 29230, "checkin": FUTURE, "checkout": FUTURE_2})
    )
    assert out["hotels"] == [{"id": "h"}]
    assert json.loads(calls[0].content)["location"] == "29230"


def test_api_key_is_not_serialised():
    tool = KtemiaKeyStatus(api_key="secret-value")
    assert "secret-value" not in json.dumps(tool.model_dump(), default=str)
