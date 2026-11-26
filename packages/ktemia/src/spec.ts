/**
 * The shared agent tool contract: names, descriptions, enums, and defaults.
 *
 * `tools.json` is copied from ktemia-mcp's `spec/tools.json` (run
 * `npm run sync-spec`), so every adapter, and the MCP server, describe the
 * tools to a model in the same words. Framework adapters build their own
 * schemas and read only the prose and enum values from here.
 *
 * @module
 */

import raw from "./tools.json" with { type: "json" };

/** How the shared tool spec describes one tool parameter. */
export interface ToolParamSpec {
  /** The description a model sees for this parameter. */
  description: string;
  /** The name of the shared enum this parameter's values come from, when it has one. */
  enum?: string;
  /** The value used when the parameter is omitted. */
  default?: unknown;
  /** Whether the tool cannot be called without it. */
  required?: boolean;
}

/** One agent tool from the shared spec: its name, description, hints, and parameters. */
export interface ToolSpec {
  /** The tool name a model calls, for example "ktemia_search_flights". */
  name: string;
  /** A short human-readable title. */
  title: string;
  /** The description a model sees for this tool. */
  description: string;
  /** MCP tool hints. Every Ktemia tool is read-only and non-destructive. */
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  /** The tool's parameters, by name. */
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

/** The seven Ktemia agent tools, identical across the MCP server and every framework adapter. */
export type ToolName =
  | "ktemia_key_status"
  | "ktemia_lookup"
  | "ktemia_search_flights"
  | "ktemia_search_hotels"
  | "ktemia_search_cars"
  | "ktemia_get_details"
  | "ktemia_get_hotel_reviews";

/** Every tool name in the shared spec, in spec order. */
export const TOOL_NAMES = spec.tools.map((t) => t.name) as ToolName[];

/** The full spec for one tool. Throws if the name is not in the spec. */
export function toolSpec(name: ToolName): ToolSpec {
  const found = spec.tools.find((t) => t.name === name);
  if (!found) throw new Error(`No Ktemia tool named "${name}" in the tool spec.`);
  return found;
}

/** A tool's description plus the shared notes that apply to it. */
export function toolDescription(name: ToolName, notes: string[] = []): string {
  return [toolSpec(name).description, ...notes.map((n) => sharedNote(n))].join(" ");
}

/** The description a model sees for one parameter of one tool. Throws if either is unknown. */
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

/** A shared note from the spec (for example "quotaNote"), appended to several tool descriptions. */
export function sharedNote(name: string): string {
  const found = spec.shared[name];
  if (!found) throw new Error(`No shared note named "${name}" in the tool spec.`);
  return found;
}
