/**
 * Release parity: the version lives in four places and they must agree.
 *
 * `VERSION` is not decoration. The core sends it as `X-Ktemia-Client`, which
 * is how Ktemia attributes traffic, so a stale constant quietly misreports
 * every request made by a release. The publish workflow only checks the tag
 * against the two package.json files, so nothing else catches drift here.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERSION as CORE_VERSION } from "../packages/ktemia/src/index.js";
import { VERSION as AI_SDK_VERSION } from "../packages/ai-sdk/src/index.js";

function read(path: string): { version: string; dependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"));
}

const core = read("../packages/ktemia/package.json");
const aiSdk = read("../packages/ai-sdk/package.json");

describe("version parity", () => {
  it("both packages carry the same version", () => {
    expect(aiSdk.version).toBe(core.version);
  });

  it("the exported constants match their package.json", () => {
    expect(CORE_VERSION).toBe(core.version);
    expect(AI_SDK_VERSION).toBe(aiSdk.version);
  });

  it("@ktemia/ai-sdk depends on the core version being released", () => {
    const range = aiSdk.dependencies?.ktemia;
    expect(range).toBeDefined();
    // A caret range on the version in this commit: ^0.1.0 for 0.1.0. Anything
    // else means the adapter would resolve a core it was never tested against.
    expect(range).toBe(`^${core.version}`);
  });
});
