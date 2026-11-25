# ktemia

[![PyPI](https://img.shields.io/pypi/v/ktemia)](https://pypi.org/project/ktemia/)

The official Python client for the [Ktemia](https://www.ktemia.com/) travel search API. Search and compare flights, hotels, and rental cars across airlines, booking sites, and rental companies.

Ktemia searches and compares. It does not book: results carry links that hand off to the seller's own site.

- Sync (`Ktemia`) and async (`AsyncKtemia`) clients with the same methods.
- One call per search: starting a search and reading its first page happen together.
- Catches bad input before sending, so a past date or a city name in a code field never spends quota.
- Retries rate limits for you. Never retries a spent monthly quota.

[Get a free API key](https://app.ktemia.com/api-keys) · [API reference](https://www.ktemia.com/docs/api/) · [Getting started](https://www.ktemia.com/docs/getting-started/)

## Install

```bash
pip install ktemia
export KTEMIA_API_KEY=your-key
```

## Usage

```python
from ktemia import Ktemia

kt = Ktemia()  # reads KTEMIA_API_KEY

# Flights: IATA airport or city codes
page = kt.flights.search(origin="LAX", destination="LON", departureDate="2027-03-14")
for flight in page["flights"]:
    print(flight["id"], flight["bookingOptions"][0]["totalPrice"])

# Next page, then every seller and booking link for one result
more = kt.flights.page(page["nextToken"])
details = kt.flights.details(page["token"], page["flights"][0]["id"])

# Hotels and cars take a locationId from a lookup
loc = kt.lookup("hotelLocation", "Lisbon")
hotels = kt.hotels.search(location=loc["locations"][0]["locationId"], checkin="2027-03-14", checkout="2027-03-16")
reviews = kt.hotels.reviews(hotels["hotels"][0]["id"], sources=["booking"])

# Plan and remaining quota (free)
print(kt.key_status()["usage"])
```

Field names are the API's own (`departureDate`, `pickupLocation`, `infantsOnLap`); see the [API reference](https://www.ktemia.com/docs/api/) for every field.

Async:

```python
from ktemia import AsyncKtemia

async with AsyncKtemia() as kt:
    page = await kt.cars.search(pickupLocation="28501", pickupDate="2027-03-14", dropoffDate="2027-03-17")
```

## Errors

Every failure raises `KtemiaError` with a stable `code` from the API (`INVALID_ORIGIN`, `SEARCH_EXPIRED`, `QUOTA_EXCEEDED` and so on), plus `status`, `param`, and `retryable`. Input rejected before sending raises `KtemiaValidationError` (`code="INVALID_INPUT"`), and no quota is spent. A search that matches nothing returns a page with `noResults` set instead of raising.

```python
from ktemia import KtemiaError

try:
    kt.flights.search(origin="LAX", destination="LON", departureDate="2027-03-14")
except KtemiaError as error:
    if error.code == "QUOTA_EXCEEDED":
        ...  # the month's allowance is gone; retrying will not help
```

## Agent frameworks

- LangChain: [`langchain-ktemia`](https://pypi.org/project/langchain-ktemia/)
- MCP clients (Claude, Cursor, Codex): [`ktemia-mcp`](https://pypi.org/project/ktemia-mcp/)

Source: [Ktemiaa/ktemia-agent-toolkit](https://github.com/Ktemiaa/ktemia-agent-toolkit). MIT licensed.
