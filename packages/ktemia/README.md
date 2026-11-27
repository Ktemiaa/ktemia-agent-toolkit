# ktemia

[![npm](https://img.shields.io/npm/v/ktemia)](https://www.npmjs.com/package/ktemia)
[![JSR](https://jsr.io/badges/@ktemia/ktemia)](https://jsr.io/@ktemia/ktemia)
[![CI](https://github.com/Ktemiaa/ktemia-agent-toolkit/actions/workflows/ci.yml/badge.svg)](https://github.com/Ktemiaa/ktemia-agent-toolkit/actions/workflows/ci.yml)

The official TypeScript client for the [Ktemia](https://www.ktemia.com/) travel search API. Search and compare flights, hotels, and rental cars across 100+ providers.

Ktemia searches and compares. It does not book: results carry links that hand off to the provider's own site.

- Zero dependencies. Runs on Node 20+, Bun, Deno, and edge runtimes.
- One call per search: starting a search and reading its first page happen together.
- Catches bad input before sending, so a past date or a city name in a code field never spends quota.
- Retries rate limits for you. Never retries a spent monthly quota.

[Get a free API key](https://app.ktemia.com/api-keys) · [API reference](https://www.ktemia.com/docs/api/) · [Getting started](https://www.ktemia.com/docs/getting-started/)

## Install

```bash
npm install ktemia
```

Or from [JSR](https://jsr.io/@ktemia/ktemia), for Deno, Bun, or Node:

```bash
deno add jsr:@ktemia/ktemia      # Deno
npx jsr add @ktemia/ktemia       # Node, Bun, pnpm, yarn
```

The JSR package is the same code. Import it as `@ktemia/ktemia` instead of `ktemia`.

## Usage

```ts
import { Ktemia } from 'ktemia';

const kt = new Ktemia(); // reads KTEMIA_API_KEY

// Flights: IATA airport or city codes
const flights = await kt.flights.search({
  origin: 'LAX',
  destination: 'LON',
  departureDate: '2027-03-14',
  passengers: { adults: 2 },
});

// Hotels and cars need a location id from a lookup
const [paris] = (await kt.lookup({ kind: 'hotelLocation', query: 'Paris' })).locations as { locationId: string }[];
const hotels = await kt.hotels.search({ location: paris.locationId, checkin: '2027-03-14', checkout: '2027-03-17' });

// Next page, details, reviews
if (flights.nextToken) await kt.flights.page(flights.nextToken);
await kt.hotels.details(hotels.token, 'result-id');
await kt.hotels.reviews({ hotelId: 'hotel-id', travelerTypes: ['couples'] });

// Plan and remaining quota (free)
const { usage } = await kt.keyStatus();
```

| Method | Cost |
|---|---|
| `kt.keyStatus()` | Free |
| `kt.lookup({ kind, query })` with kind `airport`, `airline`, `hotelLocation`, `carLocation` | 1 request |
| `kt.flights / hotels / cars.search(params)` | 2 requests (start, first page) |
| `.page(nextToken)` | 1 request |
| `.details(token, resultId)` | 1 request |
| `kt.hotels.reviews(params)` | 1 request |

A search that matches nothing returns a page with `noResults` set instead of throwing. Search tokens expire one hour after the search starts.

## Booking links

`details()` returns a `providerUrl` on each booking option. It is a Ktemia link, not the seller's own address: opening it resolves the seller at that moment and answers a `302` to their booking page, with the trip filled in.

Give it to the traveller unchanged. Don't unwrap it, rewrite it, or store it for later — a link works for an hour, after which it reports `BOOKING_LINK_EXPIRED` and the search has to be run again. `providerDomain`, when present, names the site the link lands on, so you can show where the traveller will end up before they click.

Ktemia compares prices and hands off; it never books, holds, or charges anything.

## Errors

Everything throws `KtemiaError` with a stable `code`:

```ts
import { KtemiaError } from 'ktemia';

try {
  await kt.flights.search({ origin: 'LAX', destination: 'LON', departureDate: '2027-03-14' });
} catch (error) {
  if (error instanceof KtemiaError && error.code === 'QUOTA_EXCEEDED') {
    // The monthly allowance is used up. kt.keyStatus() has the reset date.
  }
}
```

| Code | Meaning | Retried? |
|---|---|---|
| `INVALID_INPUT` | Rejected before sending; nothing was spent | No |
| `RATE_LIMIT_EXCEEDED` | Too many requests per second | Yes, after `Retry-After`, up to `maxRetries` |
| `QUOTA_EXCEEDED` | Monthly quota used up | Never |
| `MISSING_API_KEY`, `INVALID_API_KEY` | Key problem | No |
| `TIMEOUT`, `NETWORK_ERROR`, 5xx | Transient | Once |

## Options

```ts
new Ktemia({
  apiKey: '...',        // default KTEMIA_API_KEY
  timeoutMs: 60_000,    // per request
  maxRetries: 2,        // rate-limit retries
  fetch: customFetch,   // proxies, tests
});
```

Use it server-side: the API key must not ship to a browser.

## For AI agents

- Vercel AI SDK: [`@ktemia/ai-sdk`](https://www.npmjs.com/package/@ktemia/ai-sdk)
- MCP (Claude, Cursor, ChatGPT): [`@ktemia/mcp`](https://github.com/Ktemiaa/ktemia-mcp)

## License

MIT
