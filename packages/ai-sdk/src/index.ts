/**
 * Ktemia tools for the Vercel AI SDK.
 *
 * Each factory returns an AI SDK `tool()`. Descriptions come from the shared
 * Ktemia tool spec, so a model sees the same guidance here as through the
 * Ktemia MCP server.
 *
 * Errors the model can act on (a past date, a spent quota, a rate limit) are
 * returned as `{ error }` instead of thrown, so the model reads the reason and
 * decides what to do next, for example asking the user for a date.
 */

import { tool, type Tool } from "ai";
import { z } from "zod";
import {
  Ktemia,
  KtemiaError,
  enumValues,
  paramDescription as p,
  toolDescription,
  type ApiObject,
  type CarSearchParams,
  type KeyStatus,
  type KtemiaOptions,
  type SearchPage,
  type ToolName,
} from "ktemia";

export const VERSION = "0.1.1";

export interface KtemiaToolOptions extends KtemiaOptions {
  /** Reuse an existing client instead of creating one from the options above. */
  client?: Ktemia;
}

/** What a tool returns when Ktemia refuses the call. The model reads it and decides what to do. */
export interface KtemiaToolError {
  error: { code: string; message: string; retryable: boolean; param?: string; retryAfter?: number };
}

/** A search page plus a plain-language hint about what to call next. */
export type SearchToolResult = (SearchPage & { pagingHint: string }) | KtemiaToolError;
export type ObjectToolResult = ApiObject | KtemiaToolError;

const NAME = {
  keyStatus: "ktemia_key_status",
  lookup: "ktemia_lookup",
  searchFlights: "ktemia_search_flights",
  searchHotels: "ktemia_search_hotels",
  searchCars: "ktemia_search_cars",
  getDetails: "ktemia_get_details",
  hotelReviews: "ktemia_get_hotel_reviews",
} as const satisfies Record<string, ToolName>;

const SEARCH_NOTES = ["askDoNotGuessNote", "tokenLifetimeNote", "quotaNote", "searchNotBookNote"];

// ── Schemas ──────────────────────────────────────────────────────────────────

/** Accepts ids a model copies as numbers: "29230" or 29230. */
const id = () => z.union([z.string().min(1), z.number()]);
const country = (n: ToolName) => z.string().length(2).optional().describe(p(n, "country"));
const sortOrder = (n: ToolName) => z.enum(["asc", "desc"]).optional().describe(p(n, "sortOrder"));
const nextToken = (n: ToolName) => z.string().optional().describe(p(n, "nextToken"));

const keyStatusSchema = z.object({});

const lookupSchema = z.object({
  kind: z.enum(["airport", "airline", "hotelLocation", "carLocation"]).describe(p(NAME.lookup, "kind")),
  query: z.string().min(1).describe(p(NAME.lookup, "query")),
  type: z.enum(["city", "airport", "all"]).optional().describe(p(NAME.lookup, "type")),
  country: country(NAME.lookup),
  locale: z.string().optional().describe(p(NAME.lookup, "locale")),
});

const F = NAME.searchFlights;
const flightSchema = z.object({
  nextToken: nextToken(F),
  origin: z.string().optional().describe(p(F, "origin")),
  destination: z.string().optional().describe(p(F, "destination")),
  departureDate: z.string().optional().describe(p(F, "departureDate")),
  returnDate: z.string().optional().describe(p(F, "returnDate")),
  legs: z
    .array(z.object({ origin: z.string(), destination: z.string(), date: z.string() }))
    .optional()
    .describe(p(F, "legs")),
  cabin: z.enum(["economy", "premiumEconomy", "business", "first"]).optional().describe(p(F, "cabin")),
  passengers: z
    .object({
      adults: z.number().int().min(0).max(9).optional(),
      children: z.number().int().min(0).max(9).optional(),
      infantsOnLap: z.number().int().min(0).max(9).optional(),
    })
    .optional()
    .describe(p(F, "passengers")),
  maxStops: z.number().int().min(0).max(3).optional().describe(p(F, "maxStops")),
  airlines: z.array(z.string()).optional().describe(p(F, "airlines")),
  alliances: z.array(z.enum(["oneworld", "skyteam", "starAlliance"])).optional().describe(p(F, "alliances")),
  maxPrice: z.number().positive().optional().describe(p(F, "maxPrice")),
  sortBy: z.enum(["bestValue", "price", "duration", "departure", "arrival"]).optional().describe(p(F, "sortBy")),
  sortOrder: sortOrder(F),
  country: country(F),
});

const H = NAME.searchHotels;
const hotelSchema = z.object({
  nextToken: nextToken(H),
  location: id().optional().describe(p(H, "location")),
  checkin: z.string().optional().describe(p(H, "checkin")),
  checkout: z.string().optional().describe(p(H, "checkout")),
  adults: z.number().int().min(1).max(16).optional().describe(p(H, "adults")),
  rooms: z.number().int().min(1).max(8).optional().describe(p(H, "rooms")),
  childAges: z.array(z.number().int().min(0).max(17)).optional().describe(p(H, "childAges")),
  minStars: z.number().min(1).max(5).optional().describe(p(H, "minStars")),
  minRating: z.number().optional().describe(p(H, "minRating")),
  maxPrice: z.number().positive().optional().describe(p(H, "maxPrice")),
  freeCancellation: z.boolean().optional().describe(p(H, "freeCancellation")),
  amenities: z.array(z.string()).optional().describe(p(H, "amenities")),
  providers: z.array(z.string()).optional().describe(p(H, "providers")),
  sortBy: z.enum(["bestValue", "price", "rating", "stars", "distance"]).optional().describe(p(H, "sortBy")),
  sortOrder: sortOrder(H),
  country: country(H),
});

const C = NAME.searchCars;
const carClasses = enumValues("carClass") as [
  NonNullable<CarSearchParams["carClass"]>,
  ...NonNullable<CarSearchParams["carClass"]>[],
];
const carSchema = z.object({
  nextToken: nextToken(C),
  pickupLocation: id().optional().describe(p(C, "pickupLocation")),
  dropoffLocation: id().optional().describe(p(C, "dropoffLocation")),
  pickupDate: z.string().optional().describe(p(C, "pickupDate")),
  dropoffDate: z.string().optional().describe(p(C, "dropoffDate")),
  pickupTime: z.string().optional().describe(p(C, "pickupTime")),
  dropoffTime: z.string().optional().describe(p(C, "dropoffTime")),
  driverAge: z.number().int().min(18).max(99).optional().describe(p(C, "driverAge")),
  carClass: z.enum(carClasses).optional().describe(p(C, "carClass")),
  transmission: z.enum(["automatic", "manual"]).optional().describe(p(C, "transmission")),
  maxPrice: z.number().positive().optional().describe(p(C, "maxPrice")),
  providers: z.array(z.string()).optional().describe(p(C, "providers")),
  agencies: z.array(z.string()).optional().describe(p(C, "agencies")),
  sortBy: z.enum(["bestValue", "price", "rating", "distance"]).optional().describe(p(C, "sortBy")),
  sortOrder: sortOrder(C),
  priceMode: z.enum(["total", "perDay"]).optional().describe(p(C, "priceMode")),
  country: country(C),
});

const D = NAME.getDetails;
const detailsSchema = z.object({
  vertical: z.enum(["flights", "hotels", "cars"]).describe(p(D, "vertical")),
  token: z.string().min(1).describe(p(D, "token")),
  resultId: id().describe(p(D, "resultId")),
});

const R = NAME.hotelReviews;
const reviewsSchema = z.object({
  hotelId: id().describe(p(R, "hotelId")),
  sortBy: z.enum(["recent", "oldest", "highestScore", "lowestScore"]).optional().describe(p(R, "sortBy")),
  travelerTypes: z
    .array(z.enum(["families", "couples", "solo", "friends", "business"]))
    .optional()
    .describe(p(R, "travelerTypes")),
  months: z.array(z.number().int().min(1).max(12)).optional().describe(p(R, "months")),
  sources: z.array(z.enum(["booking", "agoda", "priceline"])).optional().describe(p(R, "sources")),
  search: z.string().optional().describe(p(R, "search")),
  page: z.number().int().min(1).max(1000).optional().describe(p(R, "page")),
});

export type LookupInput = z.infer<typeof lookupSchema>;
export type SearchFlightsInput = z.infer<typeof flightSchema>;
export type SearchHotelsInput = z.infer<typeof hotelSchema>;
export type SearchCarsInput = z.infer<typeof carSchema>;
export type GetDetailsInput = z.infer<typeof detailsSchema>;
export type HotelReviewsInput = z.infer<typeof reviewsSchema>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveClient(options: KtemiaToolOptions): Ktemia {
  const { client, ...rest } = options;
  return client ?? new Ktemia({ userAgent: `ai-sdk/${VERSION}`, ...rest });
}

async function run<T>(fn: () => Promise<T>): Promise<T | KtemiaToolError> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof KtemiaError) return { error: error.toJSON() };
    throw error;
  }
}

function withHint(name: ToolName, page: SearchPage): SearchPage & { pagingHint: string } {
  const pagingHint = page.noResults
    ? "The search matched nothing. Suggest other dates, a nearby airport, or fewer filters."
    : page.nextToken
      ? `More results are available. To read the next page, call ${name} with nextToken only.`
      : "This is the last page of results.";
  return { ...page, pagingHint };
}

const str = (value: string | number | undefined): string => (value === undefined ? "" : String(value));

// ── Tools ────────────────────────────────────────────────────────────────────

/** Plan, rate limits, and remaining monthly quota. Free: never counts against the quota. */
export function keyStatus(
  options: KtemiaToolOptions = {},
): Tool<Record<string, never>, KeyStatus | KtemiaToolError> {
  const kt = resolveClient(options);
  return tool({
    description: toolDescription(NAME.keyStatus),
    inputSchema: keyStatusSchema,
    execute: async (_input, { abortSignal }) => run(() => kt.keyStatus({ signal: abortSignal })),
  });
}

/** Resolves place and airline names to the codes and location ids searches need. */
export function lookup(options: KtemiaToolOptions = {}): Tool<LookupInput, ObjectToolResult> {
  const kt = resolveClient(options);
  return tool({
    description: toolDescription(NAME.lookup, ["quotaNote"]),
    inputSchema: lookupSchema,
    execute: async (input, { abortSignal }) => run(() => kt.lookup(input, { signal: abortSignal })),
  });
}

/** Searches flights. Pass nextToken alone to read the next page. */
export function searchFlights(options: KtemiaToolOptions = {}): Tool<SearchFlightsInput, SearchToolResult> {
  const kt = resolveClient(options);
  return tool({
    description: toolDescription(F, SEARCH_NOTES),
    inputSchema: flightSchema,
    execute: async ({ nextToken, ...params }, { abortSignal }) =>
      run(async () =>
        withHint(
          F,
          nextToken
            ? await kt.flights.page(nextToken, { signal: abortSignal })
            : await kt.flights.search(params, { signal: abortSignal }),
        ),
      ),
  });
}

/** Searches hotels by locationId. Pass nextToken alone to read the next page. */
export function searchHotels(options: KtemiaToolOptions = {}): Tool<SearchHotelsInput, SearchToolResult> {
  const kt = resolveClient(options);
  return tool({
    description: toolDescription(H, SEARCH_NOTES),
    inputSchema: hotelSchema,
    execute: async ({ nextToken, location, checkin, checkout, ...rest }, { abortSignal }) =>
      run(async () =>
        withHint(
          H,
          nextToken
            ? await kt.hotels.page(nextToken, { signal: abortSignal })
            : await kt.hotels.search(
                { ...rest, location: str(location), checkin: str(checkin), checkout: str(checkout) },
                { signal: abortSignal },
              ),
        ),
      ),
  });
}

/** Searches rental cars by locationId. Pass nextToken alone to read the next page. */
export function searchCars(options: KtemiaToolOptions = {}): Tool<SearchCarsInput, SearchToolResult> {
  const kt = resolveClient(options);
  return tool({
    description: toolDescription(C, SEARCH_NOTES),
    inputSchema: carSchema,
    execute: async ({ nextToken, pickupLocation, dropoffLocation, pickupDate, dropoffDate, ...rest }, { abortSignal }) =>
      run(async () =>
        withHint(
          C,
          nextToken
            ? await kt.cars.page(nextToken, { signal: abortSignal })
            : await kt.cars.search(
                {
                  ...rest,
                  pickupLocation: str(pickupLocation),
                  ...(dropoffLocation !== undefined ? { dropoffLocation: String(dropoffLocation) } : {}),
                  pickupDate: str(pickupDate),
                  dropoffDate: str(dropoffDate),
                },
                { signal: abortSignal },
              ),
        ),
      ),
  });
}

/** Every price and booking link for one chosen result. */
export function getDetails(options: KtemiaToolOptions = {}): Tool<GetDetailsInput, ObjectToolResult> {
  const kt = resolveClient(options);
  return tool({
    description: toolDescription(D, ["tokenLifetimeNote", "quotaNote", "searchNotBookNote"]),
    inputSchema: detailsSchema,
    execute: async ({ vertical, token, resultId }, { abortSignal }): Promise<ObjectToolResult> =>
      run(async (): Promise<ApiObject> => ({
        vertical,
        ...(await kt[vertical].details(token, String(resultId), { signal: abortSignal })),
      })),
  });
}

/** Guest reviews for one hotel, with filters and numbered pages. */
export function hotelReviews(options: KtemiaToolOptions = {}): Tool<HotelReviewsInput, ObjectToolResult> {
  const kt = resolveClient(options);
  return tool({
    description: toolDescription(R, ["quotaNote"]),
    inputSchema: reviewsSchema,
    execute: async ({ hotelId, ...rest }, { abortSignal }) =>
      run(() => kt.hotels.reviews({ ...rest, hotelId: String(hotelId) }, { signal: abortSignal })),
  });
}

// A type alias, not an interface: AI SDK's ToolSet needs an index signature,
// which TypeScript infers for type aliases only.
export type KtemiaTools = {
  ktemia_lookup: ReturnType<typeof lookup>;
  ktemia_search_flights: ReturnType<typeof searchFlights>;
  ktemia_search_hotels: ReturnType<typeof searchHotels>;
  ktemia_search_cars: ReturnType<typeof searchCars>;
  ktemia_get_details: ReturnType<typeof getDetails>;
  ktemia_get_hotel_reviews: ReturnType<typeof hotelReviews>;
  ktemia_key_status: ReturnType<typeof keyStatus>;
};

/**
 * All seven Ktemia tools, keyed by the names the model sees. They share one client.
 *
 * ```ts
 * const { text } = await generateText({
 *   model: "openai/gpt-5-mini",
 *   tools: ktemiaTools(),
 *   stopWhen: isStepCount(5),
 *   prompt: "Cheapest flight from LAX to London on March 14?",
 * });
 * ```
 */
export function ktemiaTools(options: KtemiaToolOptions = {}): KtemiaTools {
  const shared = { client: resolveClient(options) };
  return {
    ktemia_lookup: lookup(shared),
    ktemia_search_flights: searchFlights(shared),
    ktemia_search_hotels: searchHotels(shared),
    ktemia_search_cars: searchCars(shared),
    ktemia_get_details: getDetails(shared),
    ktemia_get_hotel_reviews: hotelReviews(shared),
    ktemia_key_status: keyStatus(shared),
  };
}

export { Ktemia, KtemiaError } from "ktemia";
