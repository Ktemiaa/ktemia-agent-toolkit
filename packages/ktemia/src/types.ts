/**
 * Request and response shapes for the Ktemia API.
 *
 * Responses are typed loosely on purpose: providers add fields often, and a
 * strict type would turn a harmless new field into a compile error for every
 * user. The fields typed here are the ones the API documents as stable.
 */

export type Vertical = "flights" | "hotels" | "cars";
export type LookupKind = "airport" | "airline" | "hotelLocation" | "carLocation";
export type SortOrder = "asc" | "desc";
export type Cabin = "economy" | "premiumEconomy" | "business" | "first";
export type Alliance = "oneworld" | "skyteam" | "starAlliance";

export interface Passengers {
  /** Age 12 and over. Defaults to 1. */
  adults?: number;
  /** Age 2 to 11. */
  children?: number;
  /** Under 2, on an adult's lap. */
  infantsOnLap?: number;
}

export interface FlightLeg {
  origin: string;
  destination: string;
  /** YYYY-MM-DD */
  date: string;
}

export interface FlightSearchParams {
  /** IATA airport or city code, for example "LAX" or "LON". */
  origin?: string;
  destination?: string;
  /** YYYY-MM-DD */
  departureDate?: string;
  /** YYYY-MM-DD. Omit for one-way. */
  returnDate?: string;
  /** Multi-city, 2 to 6 legs. Mutually exclusive with origin/destination/dates. */
  legs?: FlightLeg[];
  cabin?: Cabin;
  passengers?: Passengers;
  maxStops?: number;
  airlines?: string[];
  alliances?: Alliance[];
  maxPrice?: number;
  sortBy?: "bestValue" | "price" | "duration" | "departure" | "arrival";
  sortOrder?: SortOrder;
  /** Two-letter market code. Prices come back in that market's currency. */
  country?: string;
}

export interface HotelSearchParams {
  /** locationId from `lookup({ kind: "hotelLocation" })`. Not a city name. */
  location: string;
  /** YYYY-MM-DD */
  checkin: string;
  /** YYYY-MM-DD, 1 to 30 nights after checkin. */
  checkout: string;
  adults?: number;
  rooms?: number;
  childAges?: number[];
  minStars?: number;
  minRating?: number;
  maxPrice?: number;
  freeCancellation?: boolean;
  amenities?: string[];
  providers?: string[];
  sortBy?: "bestValue" | "price" | "rating" | "stars" | "distance";
  sortOrder?: SortOrder;
  country?: string;
}

export interface CarSearchParams {
  /** locationId from `lookup({ kind: "carLocation" })`. */
  pickupLocation: string;
  /** Omit to return the car where it was collected. */
  dropoffLocation?: string;
  /** YYYY-MM-DD */
  pickupDate: string;
  /** YYYY-MM-DD, on or after pickupDate. */
  dropoffDate: string;
  /** HH:MM on the hour or half hour. Defaults to 12:00. */
  pickupTime?: string;
  dropoffTime?: string;
  driverAge?: number;
  carClass?: "small" | "medium" | "large" | "suv" | "van" | "pickup" | "luxury" | "convertible";
  transmission?: "automatic" | "manual";
  maxPrice?: number;
  providers?: string[];
  agencies?: string[];
  sortBy?: "bestValue" | "price" | "rating" | "distance";
  sortOrder?: SortOrder;
  priceMode?: "total" | "perDay";
  country?: string;
}

export interface LookupParams {
  kind: LookupKind;
  /** Place, airport, or airline name, for example "London" or "Delta". */
  query: string;
  /** For kind "carLocation" only. */
  type?: "city" | "airport" | "all";
  country?: string;
  locale?: string;
}

export interface HotelReviewsParams {
  hotelId: string;
  sortBy?: "recent" | "oldest" | "highestScore" | "lowestScore";
  travelerTypes?: Array<"families" | "couples" | "solo" | "friends" | "business">;
  /** Calendar months of the stay, 1 to 12. */
  months?: number[];
  sources?: Array<"booking" | "agoda" | "priceline">;
  search?: string;
  page?: number;
}

/**
 * One page of search results.
 *
 * `token` is the token this page was read with: pass it to `details()` for a
 * result on this page. `nextToken` reads the following page. Tokens expire
 * one hour after the search started.
 */
export interface SearchPage {
  vertical: Vertical;
  token: string;
  hasMore: boolean;
  nextToken?: string;
  page?: number;
  totalResults?: number;
  /** Set when the search matched nothing; the page has no results then. */
  noResults?: { code: string; message: string };
  [field: string]: unknown;
}

export interface KeyStatus {
  key: { fingerprint: string; status: string; createdAt?: string | null };
  plan: { name: string; monthlyQuota: number; requestsPerSecond: number; burst: number };
  usage: { month: string; used: number; remaining: number; resetsAt: string; scope: string };
  metered: boolean;
  [field: string]: unknown;
}

export type ApiObject = Record<string, unknown>;
