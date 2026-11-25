/**
 * Ktemia tools for LangChain.js.
 *
 * Each factory returns a LangChain `tool()`. Names and descriptions come from
 * the shared Ktemia tool spec, so a model sees the same guidance here as
 * through the Ktemia MCP server, the Vercel AI SDK tools, and the Python
 * `langchain-ktemia` package.
 *
 * Errors the model can act on (a past date, a spent quota, a rate limit) are
 * returned as `{"error": {...}}` JSON instead of thrown, so the model reads the
 * reason and decides what to do next, for example asking the user for a date.
 */

import { BaseToolkit, tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import {
  Ktemia,
  KtemiaError,
  enumValues,
  paramDescription as p,
  toolDescription,
  type CarSearchParams,
  type KtemiaOptions,
  type SearchPage,
  type ToolName,
} from "ktemia";

export const VERSION = "0.1.1";

export interface KtemiaToolOptions extends KtemiaOptions {
  /** Reuse an existing client instead of creating one from the options above. */
  client?: Ktemia;
}

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

// ── Schemas (limits match the live API) ──────────────────────────────────────

/** Accepts ids a model copies as numbers: "29230" or 29230. */
const id = () => z.union([z.string().min(1), z.number()]);
/**
 * A price above zero. Checked with refine, not `.positive()`: `.positive()`
 * emits `exclusiveMinimum`, which Gemini's API rejects outright ("Unknown
 * name exclusiveMinimum"), and @langchain/google-genai passes it through.
 */
const price = (n: ToolName, field: string) =>
  z
    .number()
    .refine((v) => v > 0, { message: "Must be greater than 0" })
    .optional()
    .describe(p(n, field));
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
  maxStops: z.number().int().min(0).max(2).optional().describe(p(F, "maxStops")),
  airlines: z.array(z.string()).optional().describe(p(F, "airlines")),
  alliances: z.array(z.enum(["oneworld", "skyteam", "starAlliance"])).optional().describe(p(F, "alliances")),
  maxPrice: price(F, "maxPrice"),
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
  minStars: z.number().int().min(2).max(5).optional().describe(p(H, "minStars")),
  minRating: z.number().optional().describe(p(H, "minRating")),
  maxPrice: price(H, "maxPrice"),
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
  maxPrice: price(C, "maxPrice"),
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
  return client ?? new Ktemia({ userAgent: `langchain-js/${VERSION}`, ...rest });
}

/** Runs a call and returns JSON for the model: the result, or the error it can act on. */
async function run(fn: () => Promise<unknown>): Promise<string> {
  try {
    return JSON.stringify(await fn());
  } catch (error) {
    if (error instanceof KtemiaError) return JSON.stringify({ error: error.toJSON() });
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
export function keyStatus(options: KtemiaToolOptions = {}) {
  const kt = resolveClient(options);
  return tool(async (_input, config) => run(() => kt.keyStatus({ signal: config?.signal })), {
    name: NAME.keyStatus,
    description: toolDescription(NAME.keyStatus),
    schema: keyStatusSchema,
  });
}

/** Resolves place and airline names to the codes and location ids searches need. */
export function lookup(options: KtemiaToolOptions = {}) {
  const kt = resolveClient(options);
  return tool(async (input, config) => run(() => kt.lookup(input, { signal: config?.signal })), {
    name: NAME.lookup,
    description: toolDescription(NAME.lookup, ["quotaNote"]),
    schema: lookupSchema,
  });
}

/** Searches flights. Pass nextToken alone to read the next page. */
export function searchFlights(options: KtemiaToolOptions = {}) {
  const kt = resolveClient(options);
  return tool(
    async ({ nextToken, ...params }, config) =>
      run(async () => {
        const signal = config?.signal;
        return withHint(
          F,
          nextToken ? await kt.flights.page(nextToken, { signal }) : await kt.flights.search(params, { signal }),
        );
      }),
    { name: F, description: toolDescription(F, SEARCH_NOTES), schema: flightSchema },
  );
}

/** Searches hotels by locationId. Pass nextToken alone to read the next page. */
export function searchHotels(options: KtemiaToolOptions = {}) {
  const kt = resolveClient(options);
  return tool(
    async ({ nextToken, location, checkin, checkout, ...rest }, config) =>
      run(async () => {
        const signal = config?.signal;
        return withHint(
          H,
          nextToken
            ? await kt.hotels.page(nextToken, { signal })
            : await kt.hotels.search(
                { ...rest, location: str(location), checkin: str(checkin), checkout: str(checkout) },
                { signal },
              ),
        );
      }),
    { name: H, description: toolDescription(H, SEARCH_NOTES), schema: hotelSchema },
  );
}

/** Searches rental cars by locationId. Pass nextToken alone to read the next page. */
export function searchCars(options: KtemiaToolOptions = {}) {
  const kt = resolveClient(options);
  return tool(
    async ({ nextToken, pickupLocation, dropoffLocation, pickupDate, dropoffDate, ...rest }, config) =>
      run(async () => {
        const signal = config?.signal;
        return withHint(
          C,
          nextToken
            ? await kt.cars.page(nextToken, { signal })
            : await kt.cars.search(
                {
                  ...rest,
                  pickupLocation: str(pickupLocation),
                  ...(dropoffLocation !== undefined ? { dropoffLocation: String(dropoffLocation) } : {}),
                  pickupDate: str(pickupDate),
                  dropoffDate: str(dropoffDate),
                },
                { signal },
              ),
        );
      }),
    { name: C, description: toolDescription(C, SEARCH_NOTES), schema: carSchema },
  );
}

/** Every price and booking link for one chosen result. */
export function getDetails(options: KtemiaToolOptions = {}) {
  const kt = resolveClient(options);
  return tool(
    async ({ vertical, token, resultId }, config) =>
      run(async () => ({
        vertical,
        ...(await kt[vertical].details(token, String(resultId), { signal: config?.signal })),
      })),
    {
      name: D,
      description: toolDescription(D, ["tokenLifetimeNote", "quotaNote", "searchNotBookNote"]),
      schema: detailsSchema,
    },
  );
}

/** Guest reviews for one hotel, with filters and numbered pages. */
export function hotelReviews(options: KtemiaToolOptions = {}) {
  const kt = resolveClient(options);
  return tool(
    async ({ hotelId, ...rest }, config) =>
      run(() => kt.hotels.reviews({ ...rest, hotelId: String(hotelId) }, { signal: config?.signal })),
    { name: R, description: toolDescription(R, ["quotaNote"]), schema: reviewsSchema },
  );
}

/**
 * All seven Ktemia tools, sharing one client.
 *
 * ```ts
 * import { createAgent } from "langchain";
 * import { ktemiaTools } from "@ktemia/langchain";
 *
 * const agent = createAgent({ model: "openai:gpt-5-mini", tools: ktemiaTools() });
 * ```
 */
export function ktemiaTools(options: KtemiaToolOptions = {}): StructuredToolInterface[] {
  const shared = { client: resolveClient(options) };
  return [
    keyStatus(shared),
    lookup(shared),
    searchFlights(shared),
    searchHotels(shared),
    searchCars(shared),
    getDetails(shared),
    hotelReviews(shared),
  ];
}

/** The seven Ktemia tools as a LangChain toolkit. Same tools as {@link ktemiaTools}. */
export class KtemiaToolkit extends BaseToolkit {
  tools: StructuredToolInterface[];

  constructor(options: KtemiaToolOptions = {}) {
    super();
    this.tools = ktemiaTools(options);
  }
}

export { Ktemia, KtemiaError } from "ktemia";
