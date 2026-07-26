import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertFrontendLicenses,
  frontendLicenseInventory,
} from "./check-frontend-licenses.mjs";

const root = resolve(import.meta.dirname, "..");
const outputPath = join(root, "THIRD-PARTY.md");
const checkOnly = process.argv.includes("--check");

function markdownText(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function frontendSection(packages) {
  const lines = [
    "# Frontend dependencies",
    "",
    "Generated from `pnpm-lock.yaml` by `pnpm licenses list --prod`.",
    "",
  ];
  for (const entry of packages) {
    const identity = `${entry.name} ${entry.version}`;
    const label = markdownText(identity);
    const packageLink = entry.homepage
      ? `[${label}](${entry.homepage})`
      : `\`${identity}\``;
    lines.push(`- ${packageLink} — \`${entry.license}\``);
  }
  return `${lines.join("\n")}\n`;
}

function rustSection() {
  const tempRoot = mkdtempSync(join(tmpdir(), "glyphra-third-party-"));
  const rustOutput = join(tempRoot, "rust-licenses.md");
  try {
    execFileSync(
      "cargo",
      [
        "about",
        "generate",
        "--manifest-path",
        join(root, "src-tauri", "Cargo.toml"),
        "--config",
        join(root, "src-tauri", "about.toml"),
        "--locked",
        "--fail",
        "--output-file",
        rustOutput,
        join(root, "src-tauri", "about.hbs"),
      ],
      { cwd: root, stdio: "inherit" },
    );
    return readFileSync(rustOutput, "utf8").replaceAll("\r\n", "\n").trimEnd();
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

const packages = frontendLicenseInventory();
assertFrontendLicenses(packages);

const generated = [
  "# Glyphra third-party software notices",
  "",
  "This file is generated. Run `pnpm licenses:generate` after dependency changes.",
  "",
  frontendSection(packages).trimEnd(),
  "",
  rustSection(),
  "",
].join("\n");

if (checkOnly) {
  const current = readFileSync(outputPath, "utf8").replaceAll("\r\n", "\n");
  if (current !== generated) {
    throw new Error(
      "THIRD-PARTY.md is stale. Run `pnpm licenses:generate` and commit the result.",
    );
  }
  console.log(
    `THIRD-PARTY.md is current (${packages.length} frontend package versions).`,
  );
} else {
  writeFileSync(outputPath, generated, "utf8");
  console.log(
    `Generated THIRD-PARTY.md (${packages.length} frontend package versions).`,
  );
}
