# @ktemia/ai-sdk

[![npm](https://img.shields.io/npm/v/@ktemia/ai-sdk)](https://www.npmjs.com/package/@ktemia/ai-sdk)
[![CI](https://github.com/Ktemiaa/ktemia-agent-toolkit/actions/workflows/ci.yml/badge.svg)](https://github.com/Ktemiaa/ktemia-agent-toolkit/actions/workflows/ci.yml)

[Ktemia](https://www.ktemia.com/) travel search tools for the [Vercel AI SDK](https://ai-sdk.dev/). Give your agent live flight, hotel, and rental car prices from 100+ providers in a few lines of code.

Ktemia searches and compares. It does not book: results carry links that hand off to the provider's own site.

**[Full guide](https://www.ktemia.com/docs/vercel-ai-sdk/)** · [Get a free API key](https://app.ktemia.com/api-keys) · [API reference](https://www.ktemia.com/docs/api/)

## Install

```bash
npm install @ktemia/ai-sdk ai zod
```

Create a key at [app.ktemia.com/api-keys](https://app.ktemia.com/api-keys) (free, no card; the Free plan includes 100 requests a month) and set it:

```bash
KTEMIA_API_KEY=your-key
```

## Usage

```ts
import { generateText, isStepCount } from 'ai';
import { ktemiaTools } from '@ktemia/ai-sdk';

const { text } = await generateText({
  model: 'openai/gpt-5-mini',
  tools: ktemiaTools(),
  stopWhen: isStepCount(5),
  prompt: 'What is the cheapest flight from Los Angeles to London on March 14?',
});

console.log(text);
```

The model looks up the airport codes, runs the search, and answers from live prices. It works the same with `streamText`, `ToolLoopAgent`, and any model that supports tool calls.

## Tools

`ktemiaTools()` returns all seven, sharing one client. The keys are the tool names the model sees.

| Tool | Factory | What it does | Cost |
|---|---|---|---|
| `ktemia_lookup` | `lookup()` | Place or airline name to IATA codes and hotel/car location ids | 1 request |
| `ktemia_search_flights` | `searchFlights()` | One-way, return, or multi-city flights | 2 requests, then 1 per extra page |
| `ktemia_search_hotels` | `searchHotels()` | Hotels and stays for a location id and dates | 2 requests, then 1 per extra page |
| `ktemia_search_cars` | `searchCars()` | Rental cars for a pickup location id and dates | 2 requests, then 1 per extra page |
| `ktemia_get_details` | `getDetails()` | Every price and booking link for one result | 1 request |
| `ktemia_get_hotel_reviews` | `hotelReviews()` | Guest reviews with filters | 1 request |
| `ktemia_key_status` | `keyStatus()` | Plan and remaining quota | Free |

Pick only what you need:

```ts
import { lookup, searchFlights, getDetails } from '@ktemia/ai-sdk';

const tools = {
  ktemia_lookup: lookup(),
  ktemia_search_flights: searchFlights(),
  ktemia_get_details: getDetails(),
};
```

Keep the `ktemia_*` names: the tool descriptions refer to each other by them, for example "use ktemia_lookup first".

## Options

Every factory takes the same options:

```ts
ktemiaTools({
  apiKey: process.env.MY_KTEMIA_KEY, // default: KTEMIA_API_KEY
  timeoutMs: 60_000,                 // per request
  maxRetries: 2,                     // rate-limit retries
});

// Or share a client you already have:
import { Ktemia } from 'ktemia';
const client = new Ktemia({ apiKey: '...' });
ktemiaTools({ client });
```

Keep the tools server-side (route handlers, server actions, scripts). The API key must not reach a browser.

## Errors the model can act on

Ktemia refusals come back to the model as `{ error: { code, message, retryable } }` instead of being thrown, so it can respond sensibly, for example by asking the user for a date:

- **Bad input** (`INVALID_INPUT`): a past date, a city name where an airport code is needed, a 40-night stay. Caught before sending, so no quota is spent.
- **`RATE_LIMIT_EXCEEDED`**: retried automatically after `Retry-After`, up to `maxRetries`.
- **`QUOTA_EXCEEDED`**: never retried. The monthly allowance is gone; `ktemia_key_status` shows the reset date.
- **No results**: an empty page with a hint to try other dates or fewer filters.

Errors that are not Ktemia's (a bug, a crash) are still thrown.

## Without the AI SDK

The client underneath is [`ktemia`](https://www.npmjs.com/package/ktemia), usable on its own:

```ts
import { Ktemia } from 'ktemia';

const kt = new Ktemia();
const page = await kt.flights.search({ origin: 'LAX', destination: 'LON', departureDate: '2027-03-14' });
```

## Learn more

- [Ktemia with the Vercel AI SDK: full guide](https://www.ktemia.com/docs/vercel-ai-sdk/)
- [Build an AI travel deal finder](https://www.ktemia.com/blog/ai-travel-deal-finder/)
- [Flight Search API: Compare Fares for a Route](https://www.ktemia.com/blog/flight-search-api/)
- [Hotel Price API: Every Booking Site in One Call](https://www.ktemia.com/blog/hotel-price-api/)
- [Car Rental API: Compare Vehicles](https://www.ktemia.com/blog/car-rental-api/)
- [Best Travel API in 2026](https://www.ktemia.com/blog/best-travel-api/)
- [Ktemia MCP server](https://github.com/Ktemiaa/ktemia-mcp), for Claude, Cursor, and other MCP clients

## License

MIT
