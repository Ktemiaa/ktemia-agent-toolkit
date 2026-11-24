/**
 * A scripted fetch for tests: each call takes the next canned response and
 * records what was sent, so tests assert on real request shapes.
 */

export interface Canned {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Throw instead of answering, to simulate a network failure. */
  throws?: Error;
}

export interface SentRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: unknown;
}

export function mockFetch(responses: Canned[]) {
  const queue = [...responses];
  const sent: SentRequest[] = [];
  const fetchImpl = async (input: URL | RequestInfo, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    sent.push({
      method: init.method ?? "GET",
      url,
      headers: init.headers as Record<string, string>,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected request: ${init.method} ${url}`);
    if (next.throws) throw next.throws;
    return new Response(next.body === undefined ? "" : JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "Content-Type": "application/json", ...next.headers },
    });
  };
  return { fetch: fetchImpl as typeof fetch, sent, remaining: () => queue.length };
}

export function apiError(code: string, message = code, param?: string) {
  return { success: false, error: { code, message, ...(param ? { param } : {}) }, data: null };
}

/** A date `days` from today, as YYYY-MM-DD. */
export function daysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const noSleep = async () => {};
