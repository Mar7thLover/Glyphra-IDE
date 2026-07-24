#!/usr/bin/env node
/**
 * Fail if app versions diverge or the numeric WiX prerelease version drifts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tauri = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
const cargoToml = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
const cargoMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);

if (!cargoMatch) {
  console.error("Could not parse version from src-tauri/Cargo.toml");
  process.exit(1);
}

const versions = {
  "package.json": pkg.version,
  "src-tauri/tauri.conf.json": tauri.version,
  "src-tauri/Cargo.toml": cargoMatch[1],
};

const unique = new Set(Object.values(versions));
for (const [file, version] of Object.entries(versions)) {
  console.log(`${file}: ${version}`);
}

if (unique.size !== 1) {
  console.error("Version mismatch — keep package.json, tauri.conf.json, and Cargo.toml in sync.");
  process.exit(1);
}

const appVersion = pkg.version;
const prerelease = appVersion.match(/^(\d+)\.(\d+)\.(\d+)-(?:beta|rc)\.(\d+)$/);
if (prerelease) {
  const wixVersion = tauri.bundle?.windows?.wix?.version;
  const expectedWixVersion = prerelease.slice(1).join(".");
  if (Number(prerelease[4]) > 65535 || wixVersion !== expectedWixVersion) {
    console.error(
      `WiX version mismatch: expected ${expectedWixVersion} for ${appVersion}, got ${wixVersion ?? "<missing>"}.`,
    );
    process.exit(1);
  }
  console.log(`src-tauri/tauri.conf.json (WiX): ${wixVersion}`);
}

console.log(`OK — Glyphra ${[...unique][0]}`);
