/**
 * Errors raised by the Ktemia client.
 *
 * Every failure is a `KtemiaError` with a stable `code`, so callers (and
 * agents reading a tool result) can branch on the code instead of parsing
 * the message.
 *
 * @module
 */

/** Fields for constructing a `KtemiaError`. */
export interface KtemiaErrorOptions {
  /** Stable, uppercase error code, for example "QUOTA_EXCEEDED". */
  code: string;
  /** Human-readable explanation, safe to show to a user. */
  message: string;
  /** HTTP status, or 0 when the request never reached the API. */
  status: number;
  /** The request field the error is about, when the API names one. */
  param?: string;
  /** True when the same call can succeed later without changing anything. */
  retryable?: boolean;
  /** Seconds the API asked us to wait, from `Retry-After`. */
  retryAfter?: number;
  /** The parsed response body, when there was one. */
  body?: unknown;
}

/**
 * Marks Ktemia errors across copies of this package. `instanceof` fails when
 * an app ends up with two copies (ESM and CJS, or two versions), and a missed
 * check would turn a readable error into a crash.
 */
const BRAND = Symbol.for("ktemia.error");

/**
 * Every failure the client raises. Branch on `code`, which is stable, rather
 * than on `message`.
 */
export class KtemiaError extends Error {
  /** Stable, uppercase error code from the API, for example "INVALID_ORIGIN" or "SEARCH_EXPIRED". */
  readonly code: string;
  /** HTTP status, or 0 when the request never reached the API. */
  readonly status: number;
  /** The request field the error is about, when the API names one. */
  readonly param?: string;
  /** True when the same call can succeed later without changing anything. Never true for QUOTA_EXCEEDED. */
  readonly retryable: boolean;
  /** Seconds the API asked us to wait, from `Retry-After`. */
  readonly retryAfter?: number;
  /** The parsed response body, when there was one. */
  readonly body?: unknown;

  /** Usually created by the client; construct one yourself only in tests. */
  constructor(options: KtemiaErrorOptions) {
    super(options.message);
    this.name = "KtemiaError";
    this.code = options.code;
    this.status = options.status;
    this.param = options.param;
    this.retryable = options.retryable ?? false;
    this.retryAfter = options.retryAfter;
    this.body = options.body;
    Object.defineProperty(this, BRAND, { value: true });
  }

  /** Makes `instanceof KtemiaError` work across duplicate copies of this package (ESM and CJS, or two versions). */
  static [Symbol.hasInstance](value: unknown): boolean {
    // Subclasses keep the normal prototype check.
    if (this !== KtemiaError) return Function.prototype[Symbol.hasInstance].call(this, value);
    return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[BRAND] === true;
  }

  /** A plain object safe to hand to a model or a log line. Never holds the key. */
  toJSON(): {
    code: string;
    message: string;
    retryable: boolean;
    param?: string;
    retryAfter?: number;
  } {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.param ? { param: this.param } : {}),
      ...(this.retryAfter !== undefined ? { retryAfter: this.retryAfter } : {}),
    };
  }
}

/**
 * Raised before any request is sent, when the input cannot be valid.
 * Nothing reached the API, so no quota was spent.
 */
export class KtemiaValidationError extends KtemiaError {
  /** `param` is the field at fault; `message` explains what to change. */
  constructor(param: string, message: string) {
    super({
      code: "INVALID_INPUT",
      status: 400,
      param,
      message: `${message} Nothing was sent to Ktemia, so no quota was used.`,
    });
    this.name = "KtemiaValidationError";
  }
}

/** Codes that mean "the search found nothing", not "the request was wrong". */
export const EMPTY_RESULT_CODES: ReadonlySet<string> = new Set(["NO_RESULTS", "NO_MORE_RESULTS"]);

/** True for any `KtemiaError`, including `KtemiaValidationError`. */
export function isKtemiaError(error: unknown): error is KtemiaError {
  return error instanceof KtemiaError;
}
