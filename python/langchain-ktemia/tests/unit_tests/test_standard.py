"""LangChain's standard tool tests, run against every Ktemia tool."""

from __future__ import annotations

from langchain_tests.unit_tests import ToolsUnitTests

from langchain_ktemia import (
    KtemiaGetDetails,
    KtemiaHotelReviews,
    KtemiaKeyStatus,
    KtemiaLookup,
    KtemiaSearchCars,
    KtemiaSearchFlights,
    KtemiaSearchHotels,
)

EXAMPLES = {
    KtemiaKeyStatus: {},
    KtemiaLookup: {"kind": "airport", "query": "London"},
    KtemiaSearchFlights: {"origin": "LAX", "destination": "LON", "departureDate": "2099-03-14"},
    KtemiaSearchHotels: {"location": "29230", "checkin": "2099-03-14", "checkout": "2099-03-16"},
    KtemiaSearchCars: {"pickupLocation": "28501", "pickupDate": "2099-03-14", "dropoffDate": "2099-03-16"},
    KtemiaGetDetails: {"vertical": "flights", "token": "tok", "resultId": "r1"},
    KtemiaHotelReviews: {"hotelId": "12345"},
}


def _suite(tool_cls, example):
    class _T(ToolsUnitTests):
        @property
        def tool_constructor(self):
            return tool_cls

        @property
        def tool_constructor_params(self):
            return {"api_key": "test-key"}

        @property
        def tool_invoke_params_example(self):
            return example

        @property
        def init_from_env_params(self):
            return ({"KTEMIA_API_KEY": "env-key"}, {}, {})

    _T.__name__ = f"Test{tool_cls.__name__}Standard"
    return _T


for _cls, _example in EXAMPLES.items():
    globals()[f"Test{_cls.__name__}Standard"] = _suite(_cls, _example)

del _cls, _example
