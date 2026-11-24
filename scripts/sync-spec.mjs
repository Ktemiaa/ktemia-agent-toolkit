// Copies the shared tool spec from a ktemia-mcp checkout next to this repo,
// so tool descriptions stay identical to the MCP server's.
//
//   npm run sync-spec            (expects ../ktemia-mcp)
//   KTEMIA_MCP_DIR=/path npm run sync-spec
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mcp = resolve(process.env.KTEMIA_MCP_DIR ?? join(root, "..", "ktemia-mcp"));
const source = join(mcp, "spec", "tools.json");
const target = join(root, "packages", "ktemia", "src", "tools.json");

if (!existsSync(source)) {
  console.error(`No spec at ${source}. Set KTEMIA_MCP_DIR to a ktemia-mcp checkout.`);
  process.exit(1);
}
copyFileSync(source, target);
console.log(`Copied ${source} -> ${target}`);
