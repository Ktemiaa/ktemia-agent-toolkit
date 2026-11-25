"""The official Python client for the Ktemia travel search API.

Search and compare flights, hotels, and rental cars across airlines, booking
sites and rental companies. Ktemia searches and compares; it does not book.
"""

from ._version import VERSION
from .client import (
    API_KEYS_URL,
    DEFAULT_BASE_URL,
    LOOKUP_PATHS,
    AsyncKtemia,
    Ktemia,
    parse_retry_after,
)
from .errors import EMPTY_RESULT_CODES, KtemiaError, KtemiaValidationError
from .spec import TOOL_NAMES, enum_values, param_description, shared_note, tool_description, tool_spec
from .validate import (
    MAX_LEGS,
    MAX_NIGHTS,
    MAX_PASSENGERS,
    MIN_LEGS,
    check_car_search,
    check_date,
    check_flight_search,
    check_hotel_search,
    check_place,
)

__version__ = VERSION

__all__ = [
    "API_KEYS_URL",
    "DEFAULT_BASE_URL",
    "EMPTY_RESULT_CODES",
    "LOOKUP_PATHS",
    "MAX_LEGS",
    "MAX_NIGHTS",
    "MAX_PASSENGERS",
    "MIN_LEGS",
    "TOOL_NAMES",
    "VERSION",
    "AsyncKtemia",
    "Ktemia",
    "KtemiaError",
    "KtemiaValidationError",
    "__version__",
    "check_car_search",
    "check_date",
    "check_flight_search",
    "check_hotel_search",
    "check_place",
    "enum_values",
    "param_description",
    "parse_retry_after",
    "shared_note",
    "tool_description",
    "tool_spec",
]
