/**
 * The shared agent tool contract: names, descriptions, enums, and defaults.
 *
 * `tools.json` is copied from ktemia-mcp's `spec/tools.json` (run
 * `npm run sync-spec`), so every adapter, and the MCP server, describe the
 * tools to a model in the same words. Framework adapters build their own
 * schemas and read only the prose and enum values from here.
 */

import raw from "./tools.json" with { type: "json" };

export interface ToolParamSpec {
  description: string;
  enum?: string;
  default?: unknown;
  required?: boolean;
}

export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  params: Record<string, ToolParamSpec>;
}

interface Spec {
  specVersion: number;
  shared: Record<string, string>;
  enums: Record<string, string[]>;
  limits: Record<string, number>;
  tools: ToolSpec[];
}

const spec = raw as unknown as Spec;

export type ToolName =
  | "ktemia_key_status"
  | "ktemia_lookup"
  | "ktemia_search_flights"
  | "ktemia_search_hotels"
  | "ktemia_search_cars"
  | "ktemia_get_details"
  | "ktemia_get_hotel_reviews";

export const TOOL_NAMES = spec.tools.map((t) => t.name) as ToolName[];

export function toolSpec(name: ToolName): ToolSpec {
  const found = spec.tools.find((t) => t.name === name);
  if (!found) throw new Error(`No Ktemia tool named "${name}" in the tool spec.`);
  return found;
}

/** A tool's description plus the shared notes that apply to it. */
export function toolDescription(name: ToolName, notes: string[] = []): string {
  return [toolSpec(name).description, ...notes.map((n) => sharedNote(n))].join(" ");
}

export function paramDescription(name: ToolName, param: string): string {
  const found = toolSpec(name).params[param];
  if (!found) throw new Error(`Ktemia tool "${name}" has no parameter "${param}".`);
  return found.description;
}

/** An enum's values as a non-empty tuple, the shape schema libraries expect. */
export function enumValues(name: string): [string, ...string[]] {
  const found = spec.enums[name];
  if (!found || found.length === 0) throw new Error(`No Ktemia enum named "${name}".`);
  return found as [string, ...string[]];
}

export function sharedNote(name: string): string {
  const found = spec.shared[name];
  if (!found) throw new Error(`No shared note named "${name}" in the tool spec.`);
  return found;
}
