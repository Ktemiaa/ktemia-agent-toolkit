import { generateText, isStepCount } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { Ktemia, KtemiaError, KtemiaValidationError, TOOL_NAMES } from "../packages/ktemia/src/index.js";
import { ktemiaTools, searchFlights, searchHotels, getDetails } from "../packages/ai-sdk/src/index.js";
import { apiError, daysFromNow, mockFetch, type Canned } from "./helpers.js";

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

function callTool(toolName: string, input: unknown) {
  return {
    content: [{ type: "tool-call" as const, toolCallId: `call-${toolName}`, toolName, input: JSON.stringify(input) }],
    finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
    usage,
    warnings: [],
  };
}

function answer(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage,
    warnings: [],
  };
}

function setup(responses: Canned[]) {
  const mock = mockFetch(responses);
  const client = new Ktemia({ apiKey: "k", fetch: mock.fetch, sleep: async () => {} });
  return { client, ...mock };
}

const options = { toolCallId: "t", messages: [] } as never;

async function exec<T>(t: { execute?: (input: never, opts: never) => T }, input: unknown): Promise<Awaited<T>> {
  return (await t.execute!(input as never, options)) as Awaited<T>;
}

describe("tool set", () => {
  it("exposes exactly the seven tools of the shared spec", () => {
    const tools = ktemiaTools({ apiKey: "k" });
    expect(Object.keys(tools).sort()).toEqual([...TOOL_NAMES].sort());
    for (const t of Object.values(tools)) {
      expect(t.description!.length).toBeGreaterThan(80);
      expect(t.inputSchema).toBeDefined();
    }
  });

  it("can be built without a key, so importing it never breaks a build", () => {
    const previous = process.env.KTEMIA_API_KEY;
    delete process.env.KTEMIA_API_KEY;
    try {
      expect(() => ktemiaTools()).not.toThrow();
    } finally {
      if (previous !== undefined) process.env.KTEMIA_API_KEY = previous;
    }
  });

  it("tags requests with the ai-sdk client id", async () => {
    const mock = mockFetch([{ body: { plan: {} } }]);
    const tools = ktemiaTools({ apiKey: "k", fetch: mock.fetch });
    await exec(tools.ktemia_key_status, {});
    expect(mock.sent[0].headers["X-Ktemia-Client"]).toMatch(/^ai-sdk\//);
  });
});

describe("tool execution", () => {
  it("searches flights and adds a paging hint", async () => {
    const { client, sent } = setup([{ body: { searchToken: "s1" } }, { body: { flights: [{ id: "a" }], hasMore: true, nextToken: "n2" } }]);
    const out = await exec(searchFlights({ client }), { origin: "LAX", destination: "LON", departureDate: daysFromNow(30) });
    expect(out).toMatchObject({ token: "s1", nextToken: "n2" });
    expect((out as { pagingHint: string }).pagingHint).toContain("nextToken only");
    expect(sent).toHaveLength(2);
  });

  it("reads the next page with nextToken alone (one request)", async () => {
    const { client, sent } = setup([{ body: { flights: [], hasMore: false } }]);
    const out = await exec(searchFlights({ client }), { nextToken: "n2" });
    expect(sent.map((r) => r.url.pathname)).toEqual(["/flights/results"]);
    expect((out as { pagingHint: string }).pagingHint).toBe("This is the last page of results.");
  });

  it("accepts a numeric hotel location id copied by the model", async () => {
    const { client, sent } = setup([{ body: { searchToken: "h" } }, { body: { hotels: [] } }]);
    await exec(searchHotels({ client }), { location: 29230, checkin: daysFromNow(20), checkout: daysFromNow(23) });
    expect(sent[0].body).toMatchObject({ location: "29230" });
  });

  it("returns validation problems to the model instead of throwing", async () => {
    const { client, sent } = setup([]);
    const out = await exec(searchFlights({ client }), { origin: "Los Angeles", destination: "LON", departureDate: daysFromNow(30) });
    expect(out).toMatchObject({ error: { code: "INVALID_INPUT", param: "origin", retryable: false } });
    expect(sent).toHaveLength(0);
  });

  it("returns QUOTA_EXCEEDED as a terminal error", async () => {
    const { client } = setup([{ status: 429, body: apiError("QUOTA_EXCEEDED", "Used up.") }]);
    const out = await exec(getDetails({ client }), { vertical: "hotels", token: "t", resultId: 7 });
    expect(out).toMatchObject({ error: { code: "QUOTA_EXCEEDED", retryable: false } });
  });

  it("marks an empty search with a helpful hint", async () => {
    const { client } = setup([{ status: 404, body: apiError("NO_RESULTS", "No flights") }]);
    const out = await exec(searchFlights({ client }), { origin: "LAX", destination: "LON", departureDate: daysFromNow(30) });
    expect(out).toMatchObject({ noResults: { code: "NO_RESULTS" }, flights: [] });
    expect((out as { pagingHint: string }).pagingHint).toContain("matched nothing");
  });

  it("returns a network failure to the model as NETWORK_ERROR", async () => {
    const client = new Ktemia({ apiKey: "k", fetch: (async () => { throw new RangeError("boom"); }) as never, sleep: async () => {}, maxRetries: 0 });
    const out = await exec(searchFlights({ client }), { nextToken: "x" });
    expect(out).toMatchObject({ error: { code: "NETWORK_ERROR", retryable: true } });
  });

  it("rethrows errors that are not Ktemia errors", async () => {
    const broken = { flights: { page: async () => { throw new RangeError("bug"); } } } as unknown as Ktemia;
    await expect(exec(searchFlights({ client: broken }), { nextToken: "x" })).rejects.toThrow(RangeError);
  });

  it("recognises a KtemiaError from another copy of the package", async () => {
    const foreign = Object.assign(new Error("x"), { code: "QUOTA_EXCEEDED" });
    Object.defineProperty(foreign, Symbol.for("ktemia.error"), { value: true });
    expect(foreign instanceof KtemiaError).toBe(true);
    expect(new Error("plain") instanceof KtemiaError).toBe(false);
    // Subclasses still use the normal prototype check.
    expect(foreign instanceof KtemiaValidationError).toBe(false);
  });
});

describe("inside generateText", () => {
  it("runs a full agent loop: lookup, search, answer", async () => {
    const { client, sent } = setup([
      { body: { airports: [{ code: "LON", name: "London (all airports)" }] } },
      { body: { searchToken: "s1" } },
      { body: { flights: [{ id: "f1", price: { amount: 412, currency: "USD" } }], hasMore: false } },
    ]);
    const date = daysFromNow(30);
    const model = new MockLanguageModelV4({
      doGenerate: [
        callTool("ktemia_lookup", { kind: "airport", query: "London" }),
        callTool("ktemia_search_flights", { origin: "LAX", destination: "LON", departureDate: date }),
        answer("The cheapest is $412."),
      ],
    });

    const result = await generateText({
      model,
      tools: ktemiaTools({ client }),
      stopWhen: isStepCount(5),
      prompt: "Cheapest flight from LAX to London?",
    });

    expect(result.text).toBe("The cheapest is $412.");
    expect(result.steps).toHaveLength(3);
    expect(sent.map((r) => `${r.method} ${r.url.pathname}`)).toEqual([
      "GET /flights/airports",
      "POST /flights/search",
      "GET /flights/results",
    ]);

    // The model saw every Ktemia tool, with its schema converted to JSON Schema.
    const offered = model.doGenerateCalls[0].tools?.map((t) => t.name).sort();
    expect(offered).toEqual([...TOOL_NAMES].sort());
    const flightTool = model.doGenerateCalls[0].tools?.find((t) => t.name === "ktemia_search_flights") as {
      inputSchema: { properties: Record<string, unknown> };
    };
    expect(Object.keys(flightTool.inputSchema.properties)).toContain("departureDate");

    // The search result reached the model on the final step.
    const lastPrompt = JSON.stringify(model.doGenerateCalls[2].prompt);
    expect(lastPrompt).toContain("412");
  });

  it("lets the model see and recover from a bad argument", async () => {
    const { client, sent } = setup([]);
    const model = new MockLanguageModelV4({
      doGenerate: [
        callTool("ktemia_search_flights", { origin: "LAX", destination: "LON", departureDate: "2020-01-01" }),
        answer("Which date would you like to fly?"),
      ],
    });
    const result = await generateText({ model, tools: ktemiaTools({ client }), stopWhen: isStepCount(3), prompt: "fly" });
    expect(sent).toHaveLength(0);
    expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain("in the past");
    expect(result.text).toContain("Which date");
  });
});
