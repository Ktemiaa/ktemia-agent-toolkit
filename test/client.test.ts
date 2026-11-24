import { describe, expect, it } from "vitest";
import { Ktemia, KtemiaError, KtemiaValidationError } from "../packages/ktemia/src/index.js";
import { apiError, daysFromNow, mockFetch, noSleep, type Canned } from "./helpers.js";

function client(responses: Canned[], extra: Record<string, unknown> = {}) {
  const mock = mockFetch(responses);
  const sleeps: number[] = [];
  const kt = new Ktemia({
    apiKey: "test-key",
    fetch: mock.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...extra,
  });
  return { kt, ...mock, sleeps };
}

const flight = () => ({ origin: "lax", destination: "LON", departureDate: daysFromNow(30) });

describe("authentication and request shape", () => {
  it("sends the key, a client id, and never follows redirects", async () => {
    const { kt, sent } = client([{ body: { plan: {} } }]);
    await kt.keyStatus();
    expect(sent[0].url.toString()).toBe("https://api.ktemia.com/key");
    expect(sent[0].headers["X-API-Key"]).toBe("test-key");
    expect(sent[0].headers["X-Ktemia-Client"]).toMatch(/^ktemia-js\//);
  });

  it("fails with MISSING_API_KEY at call time, not construction time", async () => {
    const previous = process.env.KTEMIA_API_KEY;
    delete process.env.KTEMIA_API_KEY;
    try {
      const kt = new Ktemia({ fetch: mockFetch([]).fetch });
      await expect(kt.keyStatus()).rejects.toMatchObject({ code: "MISSING_API_KEY" });
    } finally {
      if (previous !== undefined) process.env.KTEMIA_API_KEY = previous;
    }
  });

  it("refuses a non-https base URL", () => {
    expect(() => new Ktemia({ apiKey: "k", baseUrl: "http://evil.example" })).toThrow(KtemiaError);
    expect(() => new Ktemia({ apiKey: "k", baseUrl: "http://localhost:8000" })).not.toThrow();
  });

  it("joins list query values with commas", async () => {
    const { kt, sent } = client([{ body: { reviews: [] } }]);
    await kt.hotels.reviews({ hotelId: "1", sources: ["booking", "agoda"], months: [6, 7] });
    expect(sent[0].url.searchParams.get("sources")).toBe("booking,agoda");
    expect(sent[0].url.searchParams.get("months")).toBe("6,7");
  });
});

describe("search flow", () => {
  it("starts a search and reads its first page", async () => {
    const { kt, sent } = client([
      { body: { searchToken: "tok1" } },
      { body: { flights: [{ id: "f1" }], hasMore: true, nextToken: "tok2" } },
    ]);
    const page = await kt.flights.search(flight());
    expect(sent.map((r) => `${r.method} ${r.url.pathname}`)).toEqual(["POST /flights/search", "GET /flights/results"]);
    expect(sent[0].body).toMatchObject({ origin: "LAX", destination: "LON" });
    expect(sent[1].url.searchParams.get("token")).toBe("tok1");
    expect(page).toMatchObject({ vertical: "flights", token: "tok1", nextToken: "tok2", hasMore: true });
  });

  it("drops undefined fields from the body", async () => {
    const { kt, sent } = client([{ body: { searchToken: "t" } }, { body: { flights: [] } }]);
    await kt.flights.search({ ...flight(), cabin: undefined, maxStops: 0 });
    expect(sent[0].body).not.toHaveProperty("cabin");
    expect(sent[0].body).toHaveProperty("maxStops", 0);
  });

  it("turns NO_RESULTS into an empty page", async () => {
    const { kt } = client([{ status: 404, body: apiError("NO_RESULTS", "Nothing found") }]);
    const page = await kt.flights.search(flight());
    expect(page).toMatchObject({ flights: [], hasMore: false, noResults: { code: "NO_RESULTS" } });
  });

  it("turns NO_MORE_RESULTS on a later page into an empty page", async () => {
    const { kt } = client([{ status: 404, body: apiError("NO_MORE_RESULTS") }]);
    const page = await kt.hotels.page("tok");
    expect(page).toMatchObject({ hotels: [], token: "tok", noResults: { code: "NO_MORE_RESULTS" } });
  });

  it("reads details with the page token and result id", async () => {
    const { kt, sent } = client([{ body: { offers: [] } }]);
    await kt.cars.details("tok", "car-9");
    expect(sent[0].url.pathname).toBe("/cars/details");
    expect(Object.fromEntries(sent[0].url.searchParams)).toEqual({ token: "tok", resultId: "car-9" });
  });

  it("only sends a location type to the car lookup", async () => {
    const { kt, sent } = client([{ body: { locations: [] } }, { body: { locations: [] } }]);
    await kt.lookup({ kind: "carLocation", query: "Rome", type: "airport" });
    await kt.lookup({ kind: "hotelLocation", query: "Rome", type: "airport" });
    expect(sent[0].url.searchParams.get("type")).toBe("airport");
    expect(sent[1].url.searchParams.has("type")).toBe(false);
  });
});

describe("errors and retries", () => {
  it("never retries QUOTA_EXCEEDED", async () => {
    const { kt, sent } = client([{ status: 429, body: apiError("QUOTA_EXCEEDED", "Quota used up."), headers: { "X-Quota-Limit": "100" } }]);
    const error = await kt.keyStatus().catch((e) => e);
    expect(error).toBeInstanceOf(KtemiaError);
    expect(error).toMatchObject({ code: "QUOTA_EXCEEDED", retryable: false });
    expect(error.message).toContain("100 requests a month");
    expect(sent).toHaveLength(1);
  });

  it("retries RATE_LIMIT_EXCEEDED after Retry-After, then succeeds", async () => {
    const { kt, sent, sleeps } = client([
      { status: 429, body: apiError("RATE_LIMIT_EXCEEDED"), headers: { "Retry-After": "3" } },
      { body: { ok: true } },
    ]);
    await expect(kt.request("GET", "/key")).resolves.toEqual({ ok: true });
    expect(sent).toHaveLength(2);
    expect(sleeps).toEqual([3000]);
  });

  it("gives up after maxRetries rate limits and reports retryAfter", async () => {
    const limited = { status: 429, body: apiError("RATE_LIMIT_EXCEEDED"), headers: { "Retry-After": "2" } };
    const { kt, sent } = client([limited, limited, limited], { maxRetries: 2 });
    await expect(kt.keyStatus()).rejects.toMatchObject({ code: "RATE_LIMIT_EXCEEDED", retryable: true, retryAfter: 2 });
    expect(sent).toHaveLength(3);
  });

  it("caps a huge Retry-After", async () => {
    const { kt, sleeps } = client([
      { status: 429, body: apiError("RATE_LIMIT_EXCEEDED"), headers: { "Retry-After": "9999" } },
      { body: {} },
    ]);
    await kt.keyStatus();
    expect(sleeps[0]).toBe(30_000);
  });

  it("retries a 5xx once", async () => {
    const { kt, sent } = client([{ status: 502, body: apiError("UPSTREAM_ERROR") }, { body: { ok: 1 } }]);
    await expect(kt.keyStatus()).resolves.toEqual({ ok: 1 });
    expect(sent).toHaveLength(2);
  });

  it("does not retry a 400 and keeps the API's code and param", async () => {
    const { kt, sent } = client([{ status: 400, body: apiError("INVALID_ORIGIN", "Unknown airport", "origin") }]);
    await expect(kt.flights.search(flight())).rejects.toMatchObject({ code: "INVALID_ORIGIN", param: "origin", retryable: false });
    expect(sent).toHaveLength(1);
  });

  it("maps a network failure to a retryable NETWORK_ERROR", async () => {
    const { kt } = client([{ throws: new TypeError("fetch failed") }, { throws: new TypeError("fetch failed") }]);
    await expect(kt.keyStatus()).rejects.toMatchObject({ code: "NETWORK_ERROR", retryable: true });
  });

  it("serialises errors without the API key", async () => {
    const { kt } = client([{ status: 401, body: apiError("INVALID_API_KEY", "Bad key") }]);
    const error = (await kt.keyStatus().catch((e) => e)) as KtemiaError;
    expect(JSON.stringify(error.toJSON())).not.toContain("test-key");
  });
});

describe("validation before sending (no quota spent)", () => {
  const rejects = async (fn: (kt: Ktemia) => Promise<unknown>, param: string) => {
    const { kt, sent } = client([]);
    const error = await fn(kt).catch((e) => e);
    expect(error).toBeInstanceOf(KtemiaValidationError);
    expect(error.param).toBe(param);
    expect(error.message).toContain("no quota was used");
    expect(sent).toHaveLength(0);
  };

  it("rejects a past date", () =>
    rejects((kt) => kt.flights.search({ ...flight(), departureDate: "2020-01-01" }), "departureDate"));
  it("rejects an impossible date", () =>
    rejects((kt) => kt.flights.search({ ...flight(), departureDate: "2027-02-30" }), "departureDate"));
  it("rejects a city name where a code is needed", () =>
    rejects((kt) => kt.flights.search({ ...flight(), origin: "Los Angeles" }), "origin"));
  it("rejects a return before departure", () =>
    rejects((kt) => kt.flights.search({ ...flight(), returnDate: daysFromNow(10) }), "returnDate"));
  it("rejects mixing legs with a one-way trip", () =>
    rejects(
      (kt) => kt.flights.search({ ...flight(), legs: [{ origin: "LAX", destination: "JFK", date: daysFromNow(5) }] }),
      "legs",
    ));
  it("rejects legs out of order", () =>
    rejects(
      (kt) =>
        kt.flights.search({
          legs: [
            { origin: "LAX", destination: "JFK", date: daysFromNow(20) },
            { origin: "JFK", destination: "LHR", date: daysFromNow(10) },
          ],
        }),
      "legs[1].date",
    ));
  it("rejects more lap infants than adults", () =>
    rejects((kt) => kt.flights.search({ ...flight(), passengers: { adults: 1, infantsOnLap: 2 } }), "passengers.infantsOnLap"));
  it("rejects more than 9 passengers", () =>
    rejects((kt) => kt.flights.search({ ...flight(), passengers: { adults: 8, children: 2 } }), "passengers"));
  it("rejects a hotel stay over 30 nights", () =>
    rejects((kt) => kt.hotels.search({ location: "1", checkin: daysFromNow(10), checkout: daysFromNow(45) }), "checkout"));
  it("rejects a zero-night stay", () =>
    rejects((kt) => kt.hotels.search({ location: "1", checkin: daysFromNow(10), checkout: daysFromNow(10) }), "checkout"));
  it("rejects a hotel search without a location", () =>
    rejects((kt) => kt.hotels.search({ location: " ", checkin: daysFromNow(10), checkout: daysFromNow(12) }), "location"));
  it("rejects a car dropoff before pickup", () =>
    rejects(
      (kt) => kt.cars.search({ pickupLocation: "5", pickupDate: daysFromNow(10), dropoffDate: daysFromNow(9) }),
      "dropoffDate",
    ));
  it("rejects a car time off the half hour", () =>
    rejects(
      (kt) => kt.cars.search({ pickupLocation: "5", pickupDate: daysFromNow(10), dropoffDate: daysFromNow(12), pickupTime: "10:15" }),
      "pickupTime",
    ));
  it("rejects an empty page token", () => rejects((kt) => kt.flights.page(""), "token"));
});

it("allows a same-day car rental and a multi-city trip", async () => {
  const { kt, sent } = client([
    { body: { searchToken: "c" } },
    { body: { cars: [] } },
    { body: { searchToken: "f" } },
    { body: { flights: [] } },
  ]);
  await kt.cars.search({ pickupLocation: "5", pickupDate: daysFromNow(10), dropoffDate: daysFromNow(10) });
  await kt.flights.search({
    legs: [
      { origin: "lax", destination: "jfk", date: daysFromNow(10) },
      { origin: "JFK", destination: "LHR", date: daysFromNow(14) },
    ],
  });
  expect(sent[2].body).toEqual({
    legs: [
      { origin: "LAX", destination: "JFK", date: daysFromNow(10) },
      { origin: "JFK", destination: "LHR", date: daysFromNow(14) },
    ],
  });
});

it("noSleep helper is a no-op", async () => {
  await expect(noSleep()).resolves.toBeUndefined();
});
