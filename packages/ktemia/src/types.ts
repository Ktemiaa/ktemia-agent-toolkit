/**
 * Request and response shapes for the Ktemia API.
 *
 * Responses are typed loosely on purpose: providers add fields often, and a
 * strict type would turn a harmless new field into a compile error for every
 * user. The fields typed here are the ones the API documents as stable.
 *
 * @module
 */

/** A searchable travel vertical. Each has its own search, results, and details endpoints. */
export type Vertical = "flights" | "hotels" | "cars";
/** What `lookup()` resolves: airport or city codes, airline codes, or hotel and car location ids. */
export type LookupKind = "airport" | "airline" | "hotelLocation" | "carLocation";
/** Sort direction for `sortBy`. */
export type SortOrder = "asc" | "desc";
/** Flight cabin class. */
export type Cabin = "economy" | "premiumEconomy" | "business" | "first";
/** Airline alliance, used to filter flight results. */
export type Alliance = "oneworld" | "skyteam" | "starAlliance";

/** Who is flying. At most 9 passengers in total. */
export interface Passengers {
  /** Age 12 and over. Defaults to 1. */
  adults?: number;
  /** Age 2 to 11. */
  children?: number;
  /** Under 2, on an adult's lap. At most one per adult. */
  infantsOnLap?: number;
}

/** One leg of a multi-city trip. */
export interface FlightLeg {
  /** IATA airport or city code the leg departs from, for example "LAX". */
  origin: string;
  /** IATA airport or city code the leg arrives at, for example "LON". */
  destination: string;
  /** Departure date, YYYY-MM-DD. Each leg must be on or after the previous one. */
  date: string;
}

/** Input to `flights.search()`. Send origin, destination, and dates, or `legs` for multi-city. */
export interface FlightSearchParams {
  /** IATA airport or city code, for example "LAX" or "LON". Resolve names with `lookup({ kind: "airport" })`. */
  origin?: string;
  /** IATA airport or city code, for example "JFK" or "NYC". */
  destination?: string;
  /** Departure date, YYYY-MM-DD. Cannot be in the past. */
  departureDate?: string;
  /** Return date, YYYY-MM-DD. Omit for one-way. */
  returnDate?: string;
  /** Multi-city, 2 to 6 legs. Mutually exclusive with origin/destination/dates. */
  legs?: FlightLeg[];
  /** Cabin class. Defaults to economy. */
  cabin?: Cabin;
  /** Who is flying. Defaults to one adult. */
  passengers?: Passengers;
  /** Maximum stops per leg, 0 to 2. 0 means non-stop only. */
  maxStops?: number;
  /** Two-letter IATA airline codes to keep, for example ["DL", "AA"]. */
  airlines?: string[];
  /** Keep only flights on these alliances. */
  alliances?: Alliance[];
  /** Maximum total price, in the market's currency. */
  maxPrice?: number;
  /** Result order. Defaults to bestValue. */
  sortBy?: "bestValue" | "price" | "duration" | "departure" | "arrival";
  /** Direction for `sortBy`. */
  sortOrder?: SortOrder;
  /** Two-letter market code. Prices come back in that market's currency. Omit for the US market. */
  country?: string;
}

/** Input to `hotels.search()`. */
export interface HotelSearchParams {
  /** locationId from `lookup({ kind: "hotelLocation" })`. Not a city name. */
  location: string;
  /** Check-in date, YYYY-MM-DD. Cannot be in the past. */
  checkin: string;
  /** Check-out date, YYYY-MM-DD, 1 to 30 nights after checkin. */
  checkout: string;
  /** Adult guests, 1 to 16. Defaults to 2. */
  adults?: number;
  /** Rooms, 1 to 8. Defaults to 1. */
  rooms?: number;
  /** Age of each child, 0 to 17. */
  childAges?: number[];
  /** Minimum star rating, 2 to 5. */
  minStars?: number;
  /** Minimum guest rating, on the 0 to 10 scale results use. */
  minRating?: number;
  /** Maximum price, in the market's currency. */
  maxPrice?: number;
  /** Only stays with a free-cancellation rate. */
  freeCancellation?: boolean;
  /** Amenity ids every result must have. */
  amenities?: string[];
  /** Booking-site ids to keep, from a results page. */
  providers?: string[];
  /** Result order. Defaults to bestValue. */
  sortBy?: "bestValue" | "price" | "rating" | "stars" | "distance";
  /** Direction for `sortBy`. */
  sortOrder?: SortOrder;
  /** Two-letter market code. Prices come back in that market's currency. Omit for the US market. */
  country?: string;
}

/** Input to `cars.search()`. */
export interface CarSearchParams {
  /** locationId from `lookup({ kind: "carLocation" })`. */
  pickupLocation: string;
  /** locationId to return the car to. Omit to return it where it was collected. */
  dropoffLocation?: string;
  /** Pickup date, YYYY-MM-DD. Cannot be in the past. */
  pickupDate: string;
  /** Drop-off date, YYYY-MM-DD, on or after pickupDate. */
  dropoffDate: string;
  /** HH:MM on the hour or half hour. Defaults to 12:00. */
  pickupTime?: string;
  /** HH:MM on the hour or half hour. Defaults to 12:00. */
  dropoffTime?: string;
  /** Driver's age, 18 to 99. Some rental companies charge young or senior driver fees. */
  driverAge?: number;
  /** Vehicle size or type to keep. */
  carClass?: "small" | "medium" | "large" | "suv" | "van" | "pickup" | "luxury" | "convertible";
  /** Gearbox to keep. */
  transmission?: "automatic" | "manual";
  /** Maximum price, in the market's currency. */
  maxPrice?: number;
  /** Booking-site ids to keep, from a results page. */
  providers?: string[];
  /** Rental company ids to keep, from a results page. */
  agencies?: string[];
  /** Result order. Defaults to bestValue. */
  sortBy?: "bestValue" | "price" | "rating" | "distance";
  /** Direction for `sortBy`. */
  sortOrder?: SortOrder;
  /** Whether prices are for the whole rental or per day. Defaults to total. */
  priceMode?: "total" | "perDay";
  /** Two-letter market code. Prices come back in that market's currency. Omit for the US market. */
  country?: string;
}

/** Input to `lookup()`. */
export interface LookupParams {
  /** What to look up. */
  kind: LookupKind;
  /** Place, airport, or airline name, for example "London" or "Delta". */
  query: string;
  /** For kind "carLocation" only. */
  type?: "city" | "airport" | "all";
  /** Two-letter market code that ranks and names matches. Omit for the US. */
  country?: string;
  /** Two-letter language code for names, for example "en". */
  locale?: string;
}

/** Input to `hotels.reviews()`. */
export interface HotelReviewsParams {
  /** The hotel's id from a hotels results page. */
  hotelId: string;
  /** Review order. Defaults to recent. */
  sortBy?: "recent" | "oldest" | "highestScore" | "lowestScore";
  /** Keep reviews from these kinds of travellers. */
  travelerTypes?: Array<"families" | "couples" | "solo" | "friends" | "business">;
  /** Calendar months of the stay, 1 to 12. */
  months?: number[];
  /** Keep reviews from these booking sites. */
  sources?: Array<"booking" | "agoda" | "priceline">;
  /** A word or phrase the review must contain, for example "breakfast". */
  search?: string;
  /** Page number, starting at 1. */
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
  /** The vertical these results belong to. */
  vertical: Vertical;
  /** The token this page was read with. Pass it to `details()` with a result id from this page. */
  token: string;
  /** Whether another page exists. */
  hasMore: boolean;
  /** Pass to `page()` to read the next page. Absent on the last page. */
  nextToken?: string;
  /** This page's number, starting at 1. */
  page?: number;
  /** How many results the search found in total, when upstream reports it. */
  totalResults?: number;
  /** Set when the search matched nothing; the page has no results then. */
  noResults?: { code: string; message: string };
  /** The results themselves, under `flights`, `hotels`, or `cars`, plus any other fields the API returns. */
  [field: string]: unknown;
}

/** What `keyStatus()` returns: the key's plan, limits, and the month's usage. */
export interface KeyStatus {
  /** The key itself. `fingerprint` identifies it without revealing it. */
  key: { fingerprint: string; status: string; createdAt?: string | null };
  /** The plan the key belongs to and its limits. */
  plan: { name: string; monthlyQuota: number; requestsPerSecond: number; burst: number };
  /** This month's usage. With `scope` "account", every key on the account shares `remaining`. */
  usage: { month: string; used: number; remaining: number; resetsAt: string; scope: string };
  /** Always false: checking the key never counts against the quota. */
  metered: boolean;
  /** Any other fields the API returns. */
  [field: string]: unknown;
}

/** A response object typed loosely, for endpoints whose fields vary by provider. */
export type ApiObject = Record<string, unknown>;
