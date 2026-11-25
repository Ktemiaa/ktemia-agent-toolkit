# @ktemia/langchain

[![npm](https://img.shields.io/npm/v/@ktemia/langchain)](https://www.npmjs.com/package/@ktemia/langchain)

LangChain.js tools for the [Ktemia](https://www.ktemia.com/) travel search API. Give your agent flight, hotel, and rental car search across airlines, booking sites, and rental companies, with each seller's price and a booking link.

Ktemia searches and compares. It does not book: results carry links that hand off to the seller's own site.

[Get a free API key](https://app.ktemia.com/api-keys) · [LangChain guide](https://www.ktemia.com/docs/langchain/) · [API reference](https://www.ktemia.com/docs/api/) · [Pricing](https://www.ktemia.com/pricing/)

## Install

```bash
npm install @ktemia/langchain @langchain/core zod
export KTEMIA_API_KEY=your-key
```

## Use with an agent

```ts
import { createAgent } from "langchain";
import { ktemiaTools } from "@ktemia/langchain";

const agent = createAgent({ model: "openai:gpt-5-mini", tools: ktemiaTools() });

const result = await agent.invoke({
  messages: [{ role: "user", content: "What is the cheapest flight from Los Angeles to London on 2027-03-14?" }],
});
console.log(result.messages.at(-1)?.content);
```

Any chat model with tool calling works, and the tools also run in LangGraph. The agent looks up places, runs the search, and reads booking options on its own. Put today's date in the system prompt: models do not know it, and a search needs a future date.

## Tools

`ktemiaTools()` returns all seven tools, sharing one client. `new KtemiaToolkit()` returns the same tools as a LangChain toolkit (`toolkit.getTools()`).

| Tool | Factory | Use it for |
| ---- | ------- | ---------- |
| `ktemia_key_status` | `keyStatus()` | Plan, rate limits, and requests left this month. Costs no quota. |
| `ktemia_lookup` | `lookup()` | Airport, airline, hotel, and car rental location codes |
| `ktemia_search_flights` | `searchFlights()` | One-way, return, and multi-city fares |
| `ktemia_search_hotels` | `searchHotels()` | Hotels and stays by location id |
| `ktemia_search_cars` | `searchCars()` | Rental cars by pickup location id |
| `ktemia_get_details` | `getDetails()` | Every seller's price and booking link for one result |
| `ktemia_get_hotel_reviews` | `hotelReviews()` | Guest reviews for one hotel, with filters |

Tool names and descriptions are the same as the [Ktemia MCP server](https://www.ktemia.com/docs/mcp/), the [Vercel AI SDK tools](https://www.ktemia.com/docs/vercel-ai-sdk/), and the Python [`langchain-ktemia`](https://pypi.org/project/langchain-ktemia/), so an agent behaves the same way on every framework.

To give the model fewer tools, use the factories. Keep `ktemia_lookup` with the search tools: their descriptions tell the model to call it first.

```ts
import { hotelReviews, lookup, searchHotels } from "@ktemia/langchain";

const tools = [lookup(), searchHotels(), hotelReviews()];
```

## Paging, errors, and quota

- A search returns the first page and a `nextToken` when there are more. The model calls the same tool again with only `nextToken` to read the next page. Each result includes a `pagingHint` that says what to do next.
- Errors come back as `{"error": {"code", "message", "retryable"}}` JSON instead of throwing, so the model can react: ask for a missing date, or stop on `QUOTA_EXCEEDED`.
- Input that can only fail, such as a past date or a city name where an airport code belongs, is rejected before any request is sent, so it spends no quota.
- Rate limits are retried automatically using `Retry-After`. A spent monthly quota is never retried.
- Every call except `ktemia_key_status` counts against the account's monthly quota. A new search costs two requests: one to start it and one to read the first page.

## Options

```ts
ktemiaTools({
  apiKey: process.env.MY_KTEMIA_KEY, // default: KTEMIA_API_KEY
  timeoutMs: 60_000,                 // per request
  maxRetries: 2,                     // retries after a rate limit
});

// Or share a configured client with the rest of your app
import { Ktemia } from "ktemia";
const tools = ktemiaTools({ client: new Ktemia() });
```

Building the tools never fails, even without a key, so creating them at module scope is safe. A missing key shows up on the first call, as an error the model can read. Run the tools on the server so the key never reaches a browser.

## Related

- [`ktemia`](https://www.npmjs.com/package/ktemia): the dependency-free client these tools are built on
- [`@ktemia/ai-sdk`](https://www.npmjs.com/package/@ktemia/ai-sdk): the same tools for the Vercel AI SDK
- [`@ktemia/mcp`](https://www.npmjs.com/package/@ktemia/mcp): the same tools as an MCP server
- Source: [Ktemiaa/ktemia-agent-toolkit](https://github.com/Ktemiaa/ktemia-agent-toolkit)

Requires Node 20+, `@langchain/core` 1.x, and zod 3.25 or 4. MIT licensed.
