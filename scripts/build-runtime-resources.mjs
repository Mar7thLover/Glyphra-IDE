import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "src-tauri/resources/runtime");

await mkdir(output, { recursive: true });

for (const entry of [
  "scripts/harness-bridge.mjs",
  "scripts/codex-app-server-daemon.mjs",
]) {
  await build({
    entryPoints: [resolve(root, entry)],
    outfile: resolve(output, entry.split("/").at(-1)),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    legalComments: "none",
    sourcemap: false,
  });
}
