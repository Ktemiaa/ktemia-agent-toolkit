"""Input checks that run before any request is sent.

Every search spends quota, so a request that can only fail is rejected here
instead. These mirror the API's own rules and ``packages/ktemia/src/validate.ts``
exactly; the API stays the final judge, so anything not checked here is still
caught upstream.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

from .errors import KtemiaValidationError

MAX_PASSENGERS = 9
MAX_NIGHTS = 30
MIN_LEGS = 2
MAX_LEGS = 6

_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_PLACE_RE = re.compile(r"^[A-Z]{3,4}$")
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):(00|30)$")


def _earliest_date(now: datetime | None) -> str:
    """Yesterday in UTC: one day of slack for callers in time zones behind UTC."""
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return (current.astimezone(timezone.utc).date() - timedelta(days=1)).isoformat()


def check_date(value: Any, param: str, now: datetime | None = None) -> str:
    """Checks a YYYY-MM-DD date is real and not in the past."""
    text = value.strip() if isinstance(value, str) else ""
    match = _DATE_RE.match(text)
    if not match:
        raise KtemiaValidationError(
            param, f"{param} must be a date written YYYY-MM-DD, for example 2027-03-14."
        )
    try:
        date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        raise KtemiaValidationError(param, f"{param} is not a real calendar date: {text}.") from None
    if text < _earliest_date(now):
        raise KtemiaValidationError(
            param, f"{param} {text} is in the past. Ask the user for a future date."
        )
    return text


def check_place(value: Any, param: str) -> str:
    """IATA airport or city code, upper-cased: "lhr" becomes "LHR"."""
    code = value.strip().upper() if isinstance(value, str) else ""
    if not _PLACE_RE.match(code):
        raise KtemiaValidationError(
            param,
            f"{param} must be a 3 or 4 letter IATA airport or city code such as LHR or LON, "
            'not a place name. Resolve the name with a lookup (kind "airport") first.',
        )
    return code


def check_text(value: Any, param: str, hint: str) -> str:
    """A required non-empty string. Numbers are accepted and stringified, since ids are often numeric."""
    if isinstance(value, bool):
        text = ""
    elif isinstance(value, float) and value.is_integer():
        text = str(int(value))
    elif isinstance(value, (int, float)):
        text = str(value)
    elif isinstance(value, str):
        text = value.strip()
    else:
        text = ""
    if not text:
        raise KtemiaValidationError(param, f"{param} is required. {hint}")
    return text


def _check_time(value: Any, param: str) -> str:
    text = value.strip() if isinstance(value, str) else ""
    if not _TIME_RE.match(text):
        raise KtemiaValidationError(
            param,
            f"{param} must be HH:MM in 24-hour time, on the hour or half hour, for example 09:30.",
        )
    return text


def _days_between(start: str, end: str) -> int:
    return (date.fromisoformat(end) - date.fromisoformat(start)).days


def _check_passengers(p: dict[str, Any]) -> None:
    counts = {
        "adults": p.get("adults", 1) if p.get("adults") is not None else 1,
        "children": p.get("children") or 0,
        "infantsOnLap": p.get("infantsOnLap") or 0,
    }
    for name, n in counts.items():
        if isinstance(n, bool) or not isinstance(n, int) or n < 0:
            raise KtemiaValidationError(
                f"passengers.{name}", f"passengers.{name} must be a whole number of 0 or more."
            )
    total = sum(counts.values())
    if total == 0:
        raise KtemiaValidationError("passengers", "A flight search needs at least one passenger.")
    if total > MAX_PASSENGERS:
        raise KtemiaValidationError(
            "passengers",
            f"At most {MAX_PASSENGERS} passengers fit in one search (got {total}). "
            "Split the group into several searches.",
        )
    if counts["infantsOnLap"] > counts["adults"]:
        raise KtemiaValidationError(
            "passengers.infantsOnLap",
            "Each lap infant needs an adult. Count an infant with their own seat as a child instead.",
        )


def _present(value: Any) -> bool:
    return value is not None and value != ""


def check_flight_search(params: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    """Validates and normalises a flight search body. Returns a new dict."""
    body = dict(params)
    flat = any(_present(params.get(k)) for k in ("origin", "destination", "departureDate", "returnDate"))
    legs = params.get("legs")
    has_legs = isinstance(legs, (list, tuple)) and len(legs) > 0

    if flat and has_legs:
        raise KtemiaValidationError(
            "legs",
            "Pass either origin, destination and departureDate (one-way or return), "
            "or legs (multi-city), not both.",
        )

    if has_legs:
        if len(legs) < MIN_LEGS or len(legs) > MAX_LEGS:
            raise KtemiaValidationError(
                "legs",
                f"A multi-city trip has {MIN_LEGS} to {MAX_LEGS} legs (got {len(legs)}). "
                "Use origin and destination for a one-way trip.",
            )
        previous = ""
        out_legs = []
        for i, leg in enumerate(legs):
            leg = dict(leg)
            leg_date = check_date(leg.get("date"), f"legs[{i}].date", now)
            if previous and leg_date < previous:
                raise KtemiaValidationError(
                    f"legs[{i}].date", "Legs must be in travel order, each on or after the one before."
                )
            previous = leg_date
            out_legs.append(
                {
                    "origin": check_place(leg.get("origin"), f"legs[{i}].origin"),
                    "destination": check_place(leg.get("destination"), f"legs[{i}].destination"),
                    "date": leg_date,
                }
            )
        body["legs"] = out_legs
    else:
        for name in ("origin", "destination", "departureDate"):
            if not params.get(name):
                raise KtemiaValidationError(
                    name,
                    f"A flight search needs origin, destination and departureDate ({name} is missing). "
                    "Ask the user rather than guessing.",
                )
        body["origin"] = check_place(params["origin"], "origin")
        body["destination"] = check_place(params["destination"], "destination")
        body["departureDate"] = check_date(params["departureDate"], "departureDate", now)
        if params.get("returnDate"):
            body["returnDate"] = check_date(params["returnDate"], "returnDate", now)
            if body["returnDate"] < body["departureDate"]:
                raise KtemiaValidationError("returnDate", "returnDate is before departureDate.")

    if params.get("passengers"):
        _check_passengers(dict(params["passengers"]))
    return body


def check_hotel_search(params: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    """Validates and normalises a hotel search body. Returns a new dict."""
    location = check_text(
        params.get("location"),
        "location",
        'Use the locationId from a lookup with kind "hotelLocation"; a city name is not accepted.',
    )
    checkin = check_date(params.get("checkin"), "checkin", now)
    checkout = check_date(params.get("checkout"), "checkout", now)
    nights = _days_between(checkin, checkout)
    if nights < 1:
        raise KtemiaValidationError("checkout", "checkout must be at least one day after checkin.")
    if nights > MAX_NIGHTS:
        raise KtemiaValidationError(
            "checkout",
            f"Stays are limited to {MAX_NIGHTS} nights (got {nights}). "
            "Split a longer stay into several searches.",
        )
    return {**params, "location": location, "checkin": checkin, "checkout": checkout}


def check_car_search(params: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    """Validates and normalises a car search body. Returns a new dict."""
    pickup_location = check_text(
        params.get("pickupLocation"),
        "pickupLocation",
        'Use the locationId from a lookup with kind "carLocation".',
    )
    pickup_date = check_date(params.get("pickupDate"), "pickupDate", now)
    dropoff_date = check_date(params.get("dropoffDate"), "dropoffDate", now)
    if dropoff_date < pickup_date:
        raise KtemiaValidationError("dropoffDate", "dropoffDate cannot be before pickupDate.")
    body = {
        **params,
        "pickupLocation": pickup_location,
        "pickupDate": pickup_date,
        "dropoffDate": dropoff_date,
    }
    if _present(params.get("dropoffLocation")):
        body["dropoffLocation"] = check_text(
            params["dropoffLocation"],
            "dropoffLocation",
            "Omit it to return the car where it was collected.",
        )
    if params.get("pickupTime"):
        body["pickupTime"] = _check_time(params["pickupTime"], "pickupTime")
    if params.get("dropoffTime"):
        body["dropoffTime"] = _check_time(params["dropoffTime"], "dropoffTime")
    return body
