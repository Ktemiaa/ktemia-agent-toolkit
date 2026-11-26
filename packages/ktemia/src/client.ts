/**
 * The Ktemia API client.
 *
 * Zero dependencies: it needs only the platform `fetch`, so it runs on Node
 * 20+, Bun, Deno, and edge runtimes. Keep it server-side: the API key must
 * not ship to a browser.
 *
 * @module
 */

import { EMPTY_RESULT_CODES, KtemiaError } from "./errors.js";
import type {
  ApiObject,
  CarSearchParams,
  FlightSearchParams,
  HotelReviewsParams,
  HotelSearchParams,
  KeyStatus,
  LookupParams,
  SearchPage,
  Vertical,
} from "./types.js";
import {
  checkCarSearch,
  checkFlightSearch,
  checkHotelSearch,
  checkText,
} from "./validate.js";

/** This package's version. Sent to the API as part of `X-Ktemia-Client`. */
export const VERSION = "0.1.2";
/** The production API, used when neither `baseUrl` nor `KTEMIA_API_URL` is set. */
export const DEFAULT_BASE_URL = "https://api.ktemia.com";
/** Where to create a free API key. Quoted in the missing-key error. */
export const API_KEYS_URL = "https://app.ktemia.com/api-keys";

const MAX_RETRY_AFTER_SECONDS = 30;
const SERVER_RETRY_DELAY_MS = 1000;

/** Options for `new Ktemia()`. Every field is optional. */
export interface KtemiaOptions {
  /** Defaults to the `KTEMIA_API_KEY` environment variable. */
  apiKey?: string;
  /** Defaults to `KTEMIA_API_URL`, then https://api.ktemia.com. Must be https. */
  baseUrl?: string;
  /** Per-request timeout. Searches are the slow path. Default 60 seconds. */
  timeoutMs?: number;
  /**
   * How many times to retry a rate-limited request (RATE_LIMIT_EXCEEDED),
   * waiting for Retry-After each time. Default 2. A spent monthly quota
   * (QUOTA_EXCEEDED) is never retried.
   */
  maxRetries?: number;
  /** A custom fetch, for tests or proxies. */
  fetch?: typeof fetch;
  /** Identifies the integration in Ktemia's request analytics, for example "ai-sdk/0.1.0". */
  userAgent?: string;
  /** @internal Replaces waiting, so tests do not sleep. */
  sleep?: (ms: number) => Promise<void>;
}

/** Options for `Ktemia.request()`, the low-level call behind every method. */
export interface RequestOptions {
  /** Query-string parameters. Undefined values are dropped and arrays are comma-joined. */
  query?: Record<string, unknown>;
  /** JSON request body, for POST. */
  body?: unknown;
  /** Cancels the request when aborted. */
  signal?: AbortSignal;
}

const LOOKUP_PATHS: Record<LookupParams["kind"], string> = {
  airport: "/flights/airports",
  airline: "/flights/airlines",
  hotelLocation: "/hotels/locations",
  carLocation: "/cars/locations",
};

function env(name: string): string | undefined {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.[name];
  return value && value.trim() ? value.trim() : undefined;
}

function resolveBaseUrl(explicit?: string): string {
  const raw = (explicit ?? env("KTEMIA_API_URL") ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const url = new URL(raw);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  // A key sent to the wrong host cannot be taken back, so overrides must be https.
  if (url.protocol !== "https:" && !local) {
    throw new KtemiaError({
      code: "INSECURE_API_URL",
      status: 0,
      message: `The Ktemia base URL must use https (got ${url.protocol}//${url.host}).`,
    });
  }
  return raw;
}

function parseErrorBody(body: unknown): { code: string; message: string; param?: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const { code, message, param } = error as Record<string, unknown>;
  if (typeof code !== "string" || typeof message !== "string") return null;
  return { code, message, ...(typeof param === "string" ? { param } : {}) };
}

/** Retry-After is seconds or an HTTP date. Clamped so a bad header cannot stall a caller. */
export function parseRetryAfter(header: string | null): number | undefined {
  if (header === null || header.trim() === "") return undefined;
  const value = header.trim();
  let seconds = Number(value);
  if (!Number.isFinite(seconds)) {
    const at = Date.parse(value);
    if (Number.isNaN(at)) return undefined;
    seconds = (at - Date.now()) / 1000;
  }
  return Math.min(Math.max(Math.ceil(seconds), 0), MAX_RETRY_AFTER_SECONDS);
}

function errorFromResponse(response: Response, body: unknown): KtemiaError {
  const parsed = parseErrorBody(body);
  const status = response.status;
  const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));

  if (status === 429) {
    const code = parsed?.code ?? "RATE_LIMIT_EXCEEDED";
    if (code === "QUOTA_EXCEEDED") {
      const limit = response.headers.get("X-Quota-Limit");
      return new KtemiaError({
        code,
        status,
        body,
        retryable: false,
        message:
          (parsed?.message ?? "The monthly request quota for this account is used up.") +
          " Retrying will not help, and another key on the same account shares the same quota." +
          (limit ? ` The plan allows ${limit} requests a month.` : "") +
          " Check the key status (free) for the reset date, or upgrade at https://www.ktemia.com/pricing/.",
      });
    }
    return new KtemiaError({
      code,
      status,
      body,
      retryable: true,
      ...(retryAfter !== undefined ? { retryAfter } : {}),
      message:
        (parsed?.message ?? "Too many requests per second.") +
        ` This is a speed limit, not the monthly quota: wait ${retryAfter ?? "a few"} seconds and retry.`,
    });
  }

  if (parsed) {
    return new KtemiaError({
      code: parsed.code,
      status,
      body,
      retryable: status >= 500,
      ...(parsed.param ? { param: parsed.param } : {}),
      message: parsed.message,
    });
  }
  return new KtemiaError({
    code: status >= 500 ? "UPSTREAM_ERROR" : "REQUEST_FAILED",
    status,
    body,
    retryable: status >= 500,
    message: `The Ktemia API returned HTTP ${status}.`,
  });
}

/** Drops undefined and null values so the API sees a clean body. */
function compact<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out as Partial<T>;
}

/** Search, paging and details for one vertical. */
export class VerticalResource<P> {
  /** Created by `Ktemia`; use `kt.flights`, `kt.hotels`, or `kt.cars` rather than constructing one. */
  constructor(
    private readonly client: Ktemia,
    readonly vertical: Vertical,
    private readonly check: (params: P) => P,
  ) {}

  /**
   * Starts a search and reads its first page. Costs two requests.
   * A search that matches nothing returns a page with `noResults` set.
   */
  async search(params: P, options: { signal?: AbortSignal } = {}): Promise<SearchPage> {
    const body = compact(this.check(params) as object);
    let started: { searchToken?: string };
    try {
      started = await this.client.request("POST", `/${this.vertical}/search`, {
        body,
        signal: options.signal,
      });
    } catch (error) {
      if (error instanceof KtemiaError && EMPTY_RESULT_CODES.has(error.code)) {
        return this.empty("", error);
      }
      throw error;
    }
    if (!started.searchToken) {
      throw new KtemiaError({
        code: "UPSTREAM_ERROR",
        status: 502,
        retryable: true,
        message: `Ktemia started a ${this.vertical} search but returned no search token.`,
      });
    }
    return this.page(started.searchToken, options);
  }

  /** Reads the page at `token`: a searchToken, or the nextToken of the previous page. Costs one request. */
  async page(token: string, options: { signal?: AbortSignal } = {}): Promise<SearchPage> {
    const t = checkText(token, "token", "Use the nextToken from the previous page.");
    try {
      const body = await this.client.request<ApiObject>("GET", `/${this.vertical}/results`, {
        query: { token: t },
        signal: options.signal,
      });
      return { ...body, vertical: this.vertical, token: t, hasMore: Boolean(body.hasMore) } as SearchPage;
    } catch (error) {
      if (error instanceof KtemiaError && EMPTY_RESULT_CODES.has(error.code)) {
        return this.empty(t, error);
      }
      throw error;
    }
  }

  /** Every price and booking link for one result. `token` is the token of the page it appeared on. */
  async details(token: string, resultId: string, options: { signal?: AbortSignal } = {}): Promise<ApiObject> {
    const query = {
      token: checkText(token, "token", "Use the token of the page the result appeared on."),
      resultId: checkText(resultId, "resultId", "Use the id of a result from a search page."),
    };
    return this.client.request<ApiObject>("GET", `/${this.vertical}/details`, {
      query,
      signal: options.signal,
    });
  }

  /** An empty page for a search that matched nothing, so callers get a page rather than an exception. */
  private empty(token: string, error: KtemiaError): SearchPage {
    return {
      vertical: this.vertical,
      token,
      hasMore: false,
      [this.vertical]: [],
      noResults: { code: error.code, message: error.message },
    };
  }
}

/** Hotel search, paging, and details, plus guest reviews. Use it as `kt.hotels`. */
export class HotelsResource extends VerticalResource<HotelSearchParams> {
  /** Created by `Ktemia`; use `kt.hotels` rather than constructing one. */
  constructor(private readonly kt: Ktemia) {
    super(kt, "hotels", (p) => checkHotelSearch(p));
  }

  /** Guest reviews for one hotel. Pages are numbered, starting at 1. Costs one request. */
  async reviews(params: HotelReviewsParams, options: { signal?: AbortSignal } = {}): Promise<ApiObject> {
    const hotelId = checkText(params.hotelId, "hotelId", "Use the id of a hotel from a search result.");
    return this.kt.request<ApiObject>("GET", "/hotels/reviews", {
      query: compact({ ...params, hotelId }),
      signal: options.signal,
    });
  }
}

/**
 * Ktemia travel search: flights, hotels, and rental cars across 100+
 * providers. Search only; booking links hand off to the provider.
 *
 * ```ts
 * const kt = new Ktemia(); // reads KTEMIA_API_KEY
 * const page = await kt.flights.search({ origin: "LAX", destination: "LON", departureDate: "2027-03-14" });
 * ```
 */
export class Ktemia {
  /** Flight search: one-way, round trip, and multi-city, across airlines and booking sites. */
  readonly flights: VerticalResource<FlightSearchParams>;
  /** Hotel search across booking sites, plus guest reviews. */
  readonly hotels: HotelsResource;
  /** Rental car search across rental companies and booking sites. */
  readonly cars: VerticalResource<CarSearchParams>;

  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly clientId: string;
  private readonly sleep: (ms: number) => Promise<void>;

  /**
   * Creates a client. Never throws: a missing key surfaces on the first call
   * as a `MISSING_API_KEY` error, so building a client at import time is safe.
   */
  constructor(options: KtemiaOptions = {}) {
    // Resolved now but checked per request, so constructing a client at
    // import time (as frameworks do) never fails a build that has no key.
    this.apiKey = options.apiKey?.trim() || env("KTEMIA_API_KEY");
    this.baseUrl = resolveBaseUrl(options.baseUrl);
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.clientId = options.userAgent ?? `ktemia-js/${VERSION}`;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

    this.flights = new VerticalResource(this, "flights", (p) => checkFlightSearch(p));
    this.hotels = new HotelsResource(this);
    this.cars = new VerticalResource(this, "cars", (p) => checkCarSearch(p));
  }

  /** Plan, rate limits, and remaining monthly quota. Free: never counts against the quota. */
  keyStatus(options: { signal?: AbortSignal } = {}): Promise<KeyStatus> {
    return this.request<KeyStatus>("GET", "/key", { signal: options.signal });
  }

  /**
   * Resolves a place or airline name to the codes searches need: IATA codes
   * for flights, a locationId for hotels and cars. Costs one request.
   */
  async lookup(params: LookupParams, options: { signal?: AbortSignal } = {}): Promise<ApiObject> {
    const path = LOOKUP_PATHS[params.kind];
    if (!path) {
      throw new KtemiaError({
        code: "INVALID_INPUT",
        status: 400,
        param: "kind",
        message: `kind must be one of ${Object.keys(LOOKUP_PATHS).join(", ")}.`,
      });
    }
    const query = checkText(params.query, "query", "Pass a place, airport, or airline name.");
    const body = await this.request<ApiObject>("GET", path, {
      query: compact({
        query,
        country: params.country,
        locale: params.locale,
        // Only the car endpoint takes a location type; others reject it.
        ...(params.kind === "carLocation" && params.type ? { type: params.type } : {}),
      }),
      signal: options.signal,
    });
    return { kind: params.kind, ...body };
  }

  /**
   * Low-level call to any Ktemia endpoint, with the same authentication,
   * error mapping, and retries as the typed methods.
   */
  async request<T = ApiObject>(
    method: "GET" | "POST",
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    if (!this.apiKey) {
      throw new KtemiaError({
        code: "MISSING_API_KEY",
        status: 401,
        message: `No Ktemia API key. Set the KTEMIA_API_KEY environment variable or pass apiKey. Create a free key at ${API_KEYS_URL}; the Free plan includes 100 requests a month.`,
      });
    }

    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null) continue;
      // The API reads a list as one comma-separated value; a repeated key keeps only the last.
      if (Array.isArray(value)) {
        if (value.length) url.searchParams.set(key, value.map(String).join(","));
      } else {
        url.searchParams.set(key, String(value));
      }
    }

    let rateLimitRetries = 0;
    let serverRetried = false;
    for (;;) {
      let error: KtemiaError;
      try {
        return await this.once<T>(method, url, options);
      } catch (caught) {
        if (!(caught instanceof KtemiaError)) throw caught;
        error = caught;
      }
      if (options.signal?.aborted) throw error;

      if (error.code === "RATE_LIMIT_EXCEEDED" && rateLimitRetries < this.maxRetries) {
        rateLimitRetries++;
        await this.sleep((error.retryAfter ?? 1) * 1000);
        continue;
      }
      if (error.retryable && error.code !== "RATE_LIMIT_EXCEEDED" && !serverRetried) {
        serverRetried = true;
        await this.sleep(SERVER_RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }
  }

  /** One HTTP attempt, with the timeout applied. Retries live in `request()`. */
  private async once<T>(method: "GET" | "POST", url: URL, options: RequestOptions): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          "X-API-Key": this.apiKey!,
          "X-Ktemia-Client": this.clientId,
          Accept: "application/json",
          ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: controller.signal,
        // The key must never follow a redirect to another host.
        redirect: "error",
      });
    } catch (cause) {
      if (options.signal?.aborted) {
        throw new KtemiaError({ code: "ABORTED", status: 0, message: "The request was cancelled." });
      }
      if (cause instanceof Error && cause.name === "AbortError") {
        throw new KtemiaError({
          code: "TIMEOUT",
          status: 0,
          retryable: true,
          message: `The Ktemia API did not answer within ${Math.round(this.timeoutMs / 1000)} seconds.`,
        });
      }
      throw new KtemiaError({
        code: "NETWORK_ERROR",
        status: 0,
        retryable: true,
        message: `Could not reach the Ktemia API: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }

    const text = await response.text();
    let body: unknown;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
    }

    if (response.ok) {
      if (body === undefined) {
        throw new KtemiaError({
          code: "UPSTREAM_ERROR",
          status: response.status,
          retryable: true,
          message: "The Ktemia API answered with something that was not JSON.",
        });
      }
      return body as T;
    }
    throw errorFromResponse(response, body);
  }
}
