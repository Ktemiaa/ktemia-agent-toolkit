/**
 * The official client for the Ktemia travel search API: search and compare
 * flights, hotels, and rental cars across 100+ providers, with each seller's
 * price and booking link. Zero dependencies.
 *
 * ```ts
 * import { Ktemia } from "@ktemia/ktemia";
 *
 * const kt = new Ktemia(); // reads KTEMIA_API_KEY
 * const page = await kt.flights.search({ origin: "LAX", destination: "LON", departureDate: "2027-03-14" });
 * ```
 *
 * Get a free API key at https://app.ktemia.com/api-keys.
 *
 * @module
 */
export { Ktemia, VerticalResource, HotelsResource, VERSION, DEFAULT_BASE_URL, API_KEYS_URL, parseRetryAfter } from "./client.js";
export type { KtemiaOptions, RequestOptions } from "./client.js";
export { KtemiaError, KtemiaValidationError, isKtemiaError, EMPTY_RESULT_CODES } from "./errors.js";
export type { KtemiaErrorOptions } from "./errors.js";
export {
  checkCarSearch,
  checkDate,
  checkFlightSearch,
  checkHotelSearch,
  checkPlace,
  MAX_LEGS,
  MAX_NIGHTS,
  MAX_PASSENGERS,
  MIN_LEGS,
} from "./validate.js";
export {
  TOOL_NAMES,
  enumValues,
  paramDescription,
  sharedNote,
  toolDescription,
  toolSpec,
} from "./spec.js";
export type { ToolName, ToolParamSpec, ToolSpec } from "./spec.js";
export type * from "./types.js";
