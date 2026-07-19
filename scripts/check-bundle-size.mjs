import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const limitKb = Number(process.env.GLYPHRA_JS_GZIP_LIMIT_KB ?? 300);
const assetsDir = join(process.cwd(), "dist", "assets");
const entry = readdirSync(assetsDir).find((name) => /^index-.*\.js$/.test(name));

if (!entry) {
  throw new Error("Could not find Vite index JS bundle in dist/assets");
}

const file = join(assetsDir, entry);
const gzipKb = gzipSync(readFileSync(file)).length / 1024;
console.log(`${entry}: ${gzipKb.toFixed(2)} KiB gzip (limit ${limitKb} KiB)`);

if (gzipKb > limitKb) {
  throw new Error(`Initial JS gzip size ${gzipKb.toFixed(2)} KiB exceeds ${limitKb} KiB`);
}
