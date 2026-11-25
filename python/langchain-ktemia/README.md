# langchain-ktemia

[![PyPI](https://img.shields.io/pypi/v/langchain-ktemia)](https://pypi.org/project/langchain-ktemia/)

LangChain tools for the [Ktemia](https://www.ktemia.com/) travel search API. Give your agent flight, hotel, and rental car search across airlines, booking sites, and rental companies, with each seller's price and a booking link.

Ktemia searches and compares. It does not book: results carry links that hand off to the seller's own site.

[Get a free API key](https://app.ktemia.com/api-keys) · [LangChain guide](https://www.ktemia.com/docs/langchain/) · [API reference](https://www.ktemia.com/docs/api/) · [Pricing](https://www.ktemia.com/pricing/)

## Install

```bash
pip install langchain-ktemia
export KTEMIA_API_KEY=your-key
```

## Use with an agent

```python
from langchain.agents import create_agent
from langchain_ktemia import KtemiaToolkit

agent = create_agent("openai:gpt-5-mini", tools=KtemiaToolkit().get_tools())
result = agent.invoke(
    {"messages": [("user", "What is the cheapest flight from Los Angeles to London on 2027-03-14?")]}
)
print(result["messages"][-1].content)
```

Any chat model with tool calling works. The agent looks up places, runs the search, and reads booking options on its own.

## Tools

| Tool | Class | Use it for |
| ---- | ----- | ---------- |
| `ktemia_key_status` | `KtemiaKeyStatus` | Plan, rate limits, and requests left this month. Costs no quota. |
| `ktemia_lookup` | `KtemiaLookup` | Airport, airline, hotel, and car rental location codes |
| `ktemia_search_flights` | `KtemiaSearchFlights` | One-way, return, and multi-city fares |
| `ktemia_search_hotels` | `KtemiaSearchHotels` | Hotels and stays by location id |
| `ktemia_search_cars` | `KtemiaSearchCars` | Rental cars by pickup location id |
| `ktemia_get_details` | `KtemiaGetDetails` | Every seller's price and booking link for one result |
| `ktemia_get_hotel_reviews` | `KtemiaHotelReviews` | Guest reviews for one hotel, with filters |

Tool names and descriptions are the same as the [Ktemia MCP server](https://www.ktemia.com/docs/mcp/) and the [Vercel AI SDK tools](https://www.ktemia.com/docs/vercel-ai-sdk/), so an agent behaves the same way on every framework.

Use one tool on its own:

```python
from langchain_ktemia import KtemiaLookup

print(KtemiaLookup().invoke({"kind": "airport", "query": "London"}))
```

## Paging, errors, and quota

- A search returns the first page and a `nextToken` when there are more. Call the same tool again with only `nextToken` to read the next page. Each result includes a `pagingHint` that says what to do next.
- Errors come back as `{"error": {"code", "message", "retryable"}}` instead of raising, so the model can react: ask for a missing date, or stop on `QUOTA_EXCEEDED`.
- Input that can only fail, such as a past date or a city name where an airport code belongs, is rejected before any request is sent, so it spends no quota.
- Rate limits are retried automatically using `Retry-After`. A spent monthly quota is never retried.
- Every call except `ktemia_key_status` counts against the account's monthly quota. A new search costs two requests: one to start it and one to read the first page.

## Configuration

```python
KtemiaToolkit(api_key="...")          # instead of KTEMIA_API_KEY
KtemiaSearchFlights(client=my_ktemia) # reuse a configured ktemia.Ktemia client
```

Async agents work too: every tool implements `ainvoke`.

## Related

- [`ktemia`](https://pypi.org/project/ktemia/): the Python SDK these tools are built on
- [`ktemia-mcp`](https://pypi.org/project/ktemia-mcp/): the same tools as an MCP server
- Source: [Ktemiaa/ktemia-agent-toolkit](https://github.com/Ktemiaa/ktemia-agent-toolkit)

MIT licensed.
