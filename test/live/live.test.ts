/**
 * Live check against the real Ktemia API and a real model.
 *
 *   KTEMIA_API_KEY=... GOOGLE_GENERATIVE_AI_API_KEY=... npm run test:live
 *
 * Or put both in a .env file in the repo root (git ignores it).
 * Spends about 6 Ktemia requests. Skips itself when the keys are missing.
 */

import { generateText, isStepCount } from "ai";
import { google } from "@ai-sdk/google";
import { describe, expect, it } from "vitest";
import { Ktemia } from "../../packages/ktemia/src/index.js";
import { ktemiaTools } from "../../packages/ai-sdk/src/index.js";

const ktemiaKey = process.env.KTEMIA_API_KEY;
const modelKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
// gemini-2.5-flash is closed to new API keys, and the full flash models are
// often overloaded on the free tier. 3.5-flash-lite runs the whole loop in
// about 13 seconds; override with KTEMIA_LIVE_MODEL.
const MODEL = process.env.KTEMIA_LIVE_MODEL ?? "gemini-3.5-flash-lite";

function inDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe.skipIf(!ktemiaKey)("live Ktemia API", () => {
  const kt = new Ktemia();

  it("reads the key status for free", async () => {
    const status = await kt.keyStatus();
    console.log(`plan ${status.plan.name}: ${status.usage.remaining} requests left, resets ${status.usage.resetsAt}`);
    expect(status.usage.remaining).toBeGreaterThanOrEqual(0);
  });

  it("looks up London and searches LAX to London", async () => {
    const airports = await kt.lookup({ kind: "airport", query: "London" });
    expect(JSON.stringify(airports)).toContain("LON");

    const page = await kt.flights.search({ origin: "LAX", destination: "LON", departureDate: inDays(45) });
    const flights = (page.flights as unknown[]) ?? [];
    console.log(`${flights.length} flights on the first page, more: ${page.hasMore}`);
    expect(page.token).toBeTruthy();
    expect(flights.length).toBeGreaterThan(0);
  }, 90_000);
});

describe.skipIf(!ktemiaKey || !modelKey)("live agent loop", () => {
  it("answers a flight question with real prices", async () => {
    const result = await generateText({
      model: google(MODEL),
      tools: ktemiaTools(),
      stopWhen: isStepCount(6),
      system: `Today is ${inDays(0)}. Use the Ktemia tools for live prices. Be brief.`,
      prompt: `What is the cheapest one-way flight from Los Angeles to London on ${inDays(45)}? Give the price and airline.`,
    });

    const calls = result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
    console.log("tool calls:", calls.join(" -> "));
    console.log("answer:", result.text);
    expect(calls).toContain("ktemia_search_flights");
    expect(result.text).toMatch(/\d/);
  }, 180_000);
});
