import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const genDir = join(process.cwd(), "src/lib/ipc/gen");
const snapshotDir = join(process.cwd(), ".tmp/ipc-gen-snapshot");

function hashTree(dir) {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".ts"))
    .sort();
  const hash = createHash("sha256");
  for (const name of files) {
    hash.update(name);
    hash.update("\0");
    hash.update(readFileSync(join(dir, name)));
    hash.update("\0");
  }
  return { hash: hash.digest("hex"), files };
}

if (!existsSync(genDir)) {
  throw new Error(`Missing generated bindings directory: ${genDir}`);
}

rmSync(snapshotDir, { recursive: true, force: true });
mkdirSync(snapshotDir, { recursive: true });
cpSync(genDir, snapshotDir, { recursive: true });

const before = hashTree(genDir);

execFileSync("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml", "--quiet", "export_bindings"], {
  stdio: "inherit",
  env: { ...process.env, TS_RS_EXPORT_DIR: undefined },
});

const after = hashTree(genDir);

if (before.hash !== after.hash) {
  console.error("ts-rs bindings drifted. Commit the regenerated files under src/lib/ipc/gen/");
  console.error("before files:", before.files.join(", "));
  console.error("after files:", after.files.join(", "));
  // Restore snapshot so the working tree is not left dirty mid-CI unexpectedly
  // (CI still fails; local runs can re-run cargo test to regenerate).
  rmSync(genDir, { recursive: true, force: true });
  cpSync(snapshotDir, genDir, { recursive: true });
  process.exit(1);
}

rmSync(snapshotDir, { recursive: true, force: true });
console.log(`Bindings OK (${after.files.length} files)`);
