import { ToolMessage } from "@langchain/core/messages";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { describe, expect, it } from "vitest";
import { Ktemia, TOOL_NAMES, toolDescription } from "../packages/ktemia/src/index.js";
import {
  KtemiaToolkit,
  getDetails,
  hotelReviews,
  ktemiaTools,
  searchFlights,
  searchHotels,
} from "../packages/langchain/src/index.js";
import { apiError, daysFromNow, mockFetch, type Canned } from "./helpers.js";

function setup(responses: Canned[]) {
  const mock = mockFetch(responses);
  const client = new Ktemia({ apiKey: "k", fetch: mock.fetch, sleep: async () => {} });
  return { client, ...mock };
}

const parse = (out: unknown) => JSON.parse(out as string);

describe("tool set", () => {
  it("exposes exactly the seven tools of the shared spec, with the spec's descriptions", () => {
    const tools = ktemiaTools({ apiKey: "k" });
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    const flights = tools.find((t) => t.name === "ktemia_search_flights")!;
    expect(flights.description.startsWith(toolDescription("ktemia_search_flights"))).toBe(true);
  });

  it("KtemiaToolkit returns the same tools", () => {
    const toolkit = new KtemiaToolkit({ apiKey: "k" });
    expect(toolkit.getTools().map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
  });

  // @langchain/google-genai sends tool schemas to Gemini as they are, and
  // Gemini rejects the whole request on keywords it does not know.
  it("emits no JSON Schema keywords Gemini rejects", () => {
    const rejected = ["exclusiveMinimum", "exclusiveMaximum"];
    for (const t of ktemiaTools({ apiKey: "k" })) {
      const schema = JSON.stringify(toJsonSchema(t.schema));
      for (const keyword of rejected) expect(schema, `${t.name} uses ${keyword}`).not.toContain(`"${keyword}"`);
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

  it("tags requests with the langchain-js client id", async () => {
    const mock = mockFetch([{ body: { plan: {} } }]);
    const [keyStatus] = ktemiaTools({ apiKey: "k", fetch: mock.fetch });
    await keyStatus.invoke({});
    expect(mock.sent[0].headers["X-Ktemia-Client"]).toMatch(/^langchain-js\//);
  });
});

describe("tool execution", () => {
  it("searches flights and adds a paging hint", async () => {
    const { client, sent } = setup([
      { body: { searchToken: "s1" } },
      { body: { flights: [{ id: "a" }], hasMore: true, nextToken: "n2" } },
    ]);
    const out = parse(
      await searchFlights({ client }).invoke({ origin: "LAX", destination: "LON", departureDate: daysFromNow(30) }),
    );
    expect(out).toMatchObject({ token: "s1", nextToken: "n2" });
    expect(out.pagingHint).toContain("nextToken only");
    expect(sent.map((s) => s.method)).toEqual(["POST", "GET"]);
  });

  it("reads the next page with nextToken alone (one request)", async () => {
    const { client, sent } = setup([{ body: { hotels: [{ id: "h" }], hasMore: false } }]);
    const out = parse(await searchHotels({ client }).invoke({ nextToken: "n2" }));
    expect(out.pagingHint).toBe("This is the last page of results.");
    expect(sent).toHaveLength(1);
    expect(sent[0].url.searchParams.get("token")).toBe("n2");
  });

  it("sends numeric ids as strings", async () => {
    const { client, sent } = setup([{ body: { reviews: [] } }]);
    await hotelReviews({ client }).invoke({ hotelId: 12345, sources: ["booking"] });
    expect(sent[0].url.searchParams.get("hotelId")).toBe("12345");
  });

  it("tags details with the vertical", async () => {
    const { client } = setup([{ body: { id: "a", bookingOptions: [] } }]);
    const out = parse(await getDetails({ client }).invoke({ vertical: "flights", token: "s1", resultId: "a" }));
    expect(out).toMatchObject({ vertical: "flights", id: "a" });
  });
});

describe("errors the model can act on", () => {
  it("returns a past date as an error without sending anything", async () => {
    const { client, sent } = setup([]);
    const out = parse(
      await searchFlights({ client }).invoke({ origin: "LAX", destination: "LON", departureDate: "2020-01-01" }),
    );
    expect(out.error).toMatchObject({ code: "INVALID_INPUT", param: "departureDate", retryable: false });
    expect(sent).toHaveLength(0);
  });

  it("returns QUOTA_EXCEEDED once, without retrying", async () => {
    const { client, sent } = setup([{ status: 429, body: apiError("QUOTA_EXCEEDED", "Quota used") }]);
    const out = parse(await hotelReviews({ client }).invoke({ hotelId: "1" }));
    expect(out.error).toMatchObject({ code: "QUOTA_EXCEEDED", retryable: false });
    expect(sent).toHaveLength(1);
  });

  it("rejects arguments outside the API's limits before running", async () => {
    const { client, sent } = setup([]);
    await expect(
      searchFlights({ client }).invoke({ origin: "LAX", destination: "LON", departureDate: daysFromNow(30), maxStops: 3 }),
    ).rejects.toThrow();
    await expect(searchHotels({ client }).invoke({ location: "1", minStars: 1 })).rejects.toThrow();
    await expect(
      searchFlights({ client }).invoke({ origin: "LAX", destination: "LON", departureDate: daysFromNow(30), maxPrice: 0 }),
    ).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });

  it("answers a model's tool call with a ToolMessage", async () => {
    const { client } = setup([{ body: { plan: { name: "free" } } }]);
    const [keyStatus] = ktemiaTools({ client });
    const message = await keyStatus.invoke({ id: "call_1", name: "ktemia_key_status", args: {}, type: "tool_call" });
    expect(message).toBeInstanceOf(ToolMessage);
    expect(message.tool_call_id).toBe("call_1");
    expect(parse(message.content)).toEqual({ plan: { name: "free" } });
  });
});
