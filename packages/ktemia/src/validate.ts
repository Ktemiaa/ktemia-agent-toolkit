/**
 * Input checks that run before any request is sent.
 *
 * Every search spends quota, so a request that can only fail is rejected
 * here instead. These mirror the API's own rules; the API stays the final
 * judge, so anything not checked here is still caught upstream.
 *
 * @module
 */

import { KtemiaValidationError } from "./errors.js";
import type {
  CarSearchParams,
  FlightSearchParams,
  HotelSearchParams,
  Passengers,
} from "./types.js";

/** Most passengers on one flight search, adults, children, and infants combined. */
export const MAX_PASSENGERS = 9;
/** Longest hotel stay in one search, in nights. */
export const MAX_NIGHTS = 30;
/** Fewest legs in a multi-city flight search. */
export const MIN_LEGS = 2;
/** Most legs in a multi-city flight search. */
export const MAX_LEGS = 6;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PLACE_RE = /^[A-Z]{3,4}$/;
const TIME_RE = /^([01]\d|2[0-3]):(00|30)$/;

/** Yesterday in UTC: one day of slack for callers in time zones behind UTC. */
function earliestDate(now: Date): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Checks a YYYY-MM-DD date is real and, unless allowed, not in the past. */
export function checkDate(
  value: unknown,
  param: string,
  now: Date = new Date(),
): string {
  const text = typeof value === "string" ? value.trim() : "";
  const match = DATE_RE.exec(text);
  if (!match) {
    throw new KtemiaValidationError(
      param,
      `${param} must be a date written YYYY-MM-DD, for example 2027-03-14.`,
    );
  }
  const [, y, m, d] = match;
  const parsed = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (parsed.toISOString().slice(0, 10) !== text) {
    throw new KtemiaValidationError(param, `${param} is not a real calendar date: ${text}.`);
  }
  if (text < earliestDate(now)) {
    throw new KtemiaValidationError(
      param,
      `${param} ${text} is in the past. Ask the user for a future date.`,
    );
  }
  return text;
}

/** IATA airport or city code, upper-cased: "lhr" becomes "LHR". */
export function checkPlace(value: unknown, param: string): string {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!PLACE_RE.test(code)) {
    throw new KtemiaValidationError(
      param,
      `${param} must be a 3 or 4 letter IATA airport or city code such as LHR or LON, not a place name. Resolve the name with a lookup (kind "airport") first.`,
    );
  }
  return code;
}

export function checkText(value: unknown, param: string, hint: string): string {
  const text =
    typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  if (!text) throw new KtemiaValidationError(param, `${param} is required. ${hint}`);
  return text;
}

function checkTime(value: unknown, param: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!TIME_RE.test(text)) {
    throw new KtemiaValidationError(
      param,
      `${param} must be HH:MM in 24-hour time, on the hour or half hour, for example 09:30.`,
    );
  }
  return text;
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

function checkPassengers(p: Passengers): void {
  const adults = p.adults ?? 1;
  const children = p.children ?? 0;
  const infants = p.infantsOnLap ?? 0;
  for (const [name, n] of Object.entries({ adults, children, infantsOnLap: infants })) {
    if (!Number.isInteger(n) || n < 0) {
      throw new KtemiaValidationError(`passengers.${name}`, `passengers.${name} must be a whole number of 0 or more.`);
    }
  }
  const total = adults + children + infants;
  if (total === 0) {
    throw new KtemiaValidationError("passengers", "A flight search needs at least one passenger.");
  }
  if (total > MAX_PASSENGERS) {
    throw new KtemiaValidationError(
      "passengers",
      `At most ${MAX_PASSENGERS} passengers fit in one search (got ${total}). Split the group into several searches.`,
    );
  }
  if (infants > adults) {
    throw new KtemiaValidationError(
      "passengers.infantsOnLap",
      "Each lap infant needs an adult. Count an infant with their own seat as a child instead.",
    );
  }
}

/** Validates and normalises a flight search body. Returns a new object. */
export function checkFlightSearch(
  params: FlightSearchParams,
  now: Date = new Date(),
): FlightSearchParams {
  const body: FlightSearchParams = { ...params };
  const flat = [params.origin, params.destination, params.departureDate, params.returnDate].some(
    (v) => v !== undefined && v !== null && v !== "",
  );
  const hasLegs = Array.isArray(params.legs) && params.legs.length > 0;

  if (flat && hasLegs) {
    throw new KtemiaValidationError(
      "legs",
      "Pass either origin, destination and departureDate (one-way or return), or legs (multi-city), not both.",
    );
  }

  if (hasLegs) {
    const legs = params.legs!;
    if (legs.length < MIN_LEGS || legs.length > MAX_LEGS) {
      throw new KtemiaValidationError(
        "legs",
        `A multi-city trip has ${MIN_LEGS} to ${MAX_LEGS} legs (got ${legs.length}). Use origin and destination for a one-way trip.`,
      );
    }
    let previous = "";
    body.legs = legs.map((leg, i) => {
      const date = checkDate(leg.date, `legs[${i}].date`, now);
      if (previous && date < previous) {
        throw new KtemiaValidationError(`legs[${i}].date`, "Legs must be in travel order, each on or after the one before.");
      }
      previous = date;
      return {
        origin: checkPlace(leg.origin, `legs[${i}].origin`),
        destination: checkPlace(leg.destination, `legs[${i}].destination`),
        date,
      };
    });
  } else {
    for (const name of ["origin", "destination", "departureDate"] as const) {
      if (!params[name]) {
        throw new KtemiaValidationError(
          name,
          `A flight search needs origin, destination and departureDate (${name} is missing). Ask the user rather than guessing.`,
        );
      }
    }
    body.origin = checkPlace(params.origin, "origin");
    body.destination = checkPlace(params.destination, "destination");
    body.departureDate = checkDate(params.departureDate, "departureDate", now);
    if (params.returnDate) {
      body.returnDate = checkDate(params.returnDate, "returnDate", now);
      if (body.returnDate < body.departureDate) {
        throw new KtemiaValidationError("returnDate", "returnDate is before departureDate.");
      }
    }
  }

  if (params.passengers) checkPassengers(params.passengers);
  return body;
}

/**
 * Checks a hotel search before it is sent and returns it normalised. Throws
 * `KtemiaValidationError` for input that can only fail, such as a past date,
 * a zero-night stay, or more than `MAX_NIGHTS` nights.
 */
export function checkHotelSearch(
  params: HotelSearchParams,
  now: Date = new Date(),
): HotelSearchParams {
  const location = checkText(
    params.location,
    "location",
    'Use the locationId from a lookup with kind "hotelLocation"; a city name is not accepted.',
  );
  const checkin = checkDate(params.checkin, "checkin", now);
  const checkout = checkDate(params.checkout, "checkout", now);
  const nights = daysBetween(checkin, checkout);
  if (nights < 1) {
    throw new KtemiaValidationError("checkout", "checkout must be at least one day after checkin.");
  }
  if (nights > MAX_NIGHTS) {
    throw new KtemiaValidationError(
      "checkout",
      `Stays are limited to ${MAX_NIGHTS} nights (got ${nights}). Split a longer stay into several searches.`,
    );
  }
  return { ...params, location, checkin, checkout };
}

/**
 * Checks a car search before it is sent and returns it normalised. Throws
 * `KtemiaValidationError` for input that can only fail, such as a past date,
 * a drop-off before pickup, or a time not on the hour or half hour.
 */
export function checkCarSearch(
  params: CarSearchParams,
  now: Date = new Date(),
): CarSearchParams {
  const pickupLocation = checkText(
    params.pickupLocation,
    "pickupLocation",
    'Use the locationId from a lookup with kind "carLocation".',
  );
  const pickupDate = checkDate(params.pickupDate, "pickupDate", now);
  const dropoffDate = checkDate(params.dropoffDate, "dropoffDate", now);
  if (dropoffDate < pickupDate) {
    throw new KtemiaValidationError("dropoffDate", "dropoffDate cannot be before pickupDate.");
  }
  const body: CarSearchParams = { ...params, pickupLocation, pickupDate, dropoffDate };
  if (params.dropoffLocation !== undefined && params.dropoffLocation !== "") {
    body.dropoffLocation = checkText(params.dropoffLocation, "dropoffLocation", "Omit it to return the car where it was collected.");
  }
  if (params.pickupTime) body.pickupTime = checkTime(params.pickupTime, "pickupTime");
  if (params.dropoffTime) body.dropoffTime = checkTime(params.dropoffTime, "dropoffTime");
  return body;
}
