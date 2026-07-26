import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const allowedTokens = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MPL-2.0",
  "Unlicense",
  "Unicode-3.0",
  "Zlib",
]);

const knownMetadataExceptions = new Map([
  // khroma ships an MIT `license` file but omits package.json#license.
  ["khroma@2.1.0", "MIT"],
]);

export function isAllowedLicense(expression) {
  const tokens = expression.match(/[A-Za-z0-9.-]+/g) ?? [];
  const operators = new Set(["AND", "OR", "WITH"]);
  const licenseTokens = tokens.filter((token) => !operators.has(token));
  return licenseTokens.length > 0 && licenseTokens.every((token) => allowedTokens.has(token));
}

export function frontendLicenseInventory() {
  const output =
    process.platform === "win32"
      ? execFileSync(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", "pnpm licenses list --prod --json"],
          { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
        )
      : execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], {
          encoding: "utf8",
          maxBuffer: 32 * 1024 * 1024,
        });
  const grouped = JSON.parse(output);
  const packages = [];
  for (const [reportedLicense, entries] of Object.entries(grouped)) {
    for (const entry of entries) {
      for (const version of entry.versions) {
        const identity = `${entry.name}@${version}`;
        const license =
          reportedLicense === "Unknown"
            ? knownMetadataExceptions.get(identity) ?? "Unknown"
            : reportedLicense;
        packages.push({
          name: entry.name,
          version,
          license,
          homepage: entry.homepage ?? "",
        });
      }
    }
  }
  packages.sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
  );
  return packages;
}

export function assertFrontendLicenses(packages) {
  const rejected = packages.filter(
    (entry) => entry.license === "Unknown" || !isAllowedLicense(entry.license),
  );
  if (rejected.length > 0) {
    throw new Error(
      `Unapproved frontend licenses:\n${rejected
        .map((entry) => `- ${entry.name}@${entry.version}: ${entry.license}`)
        .join("\n")}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const packages = frontendLicenseInventory();
  assertFrontendLicenses(packages);
  const licenses = [...new Set(packages.map((entry) => entry.license))].sort();
  console.log(
    `Frontend license policy passed: ${packages.length} package versions (${licenses.join(", ")}).`,
  );
}
