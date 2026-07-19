/**
 * Headless UI preview for the Agent workspace layout (mocked Tauri IPC).
 * Usage: node scripts/capture-ui-preview.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = "/opt/cursor/artifacts/screenshots";
const port = 1420;
const url = `http://127.0.0.1:${port}/`;

mkdirSync(outDir, { recursive: true });

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 200) return;
    } catch {
      // not up yet
    }
    await wait(200);
  }
  throw new Error("Vite did not become ready");
}

const mockInit = () => {
  const callbacks = new Map();
  let nextId = 1;

  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main" },
    },
    transformCallback(callback, once = false) {
      const id = nextId++;
      callbacks.set(id, { callback, once });
      return id;
    },
    unregisterCallback(id) {
      callbacks.delete(id);
    },
    runCallback(id, data) {
      const entry = callbacks.get(id);
      if (!entry) return;
      entry.callback(data);
      if (entry.once) callbacks.delete(id);
    },
    convertFileSrc(filePath) {
      return filePath;
    },
    async invoke(cmd) {
      switch (cmd) {
        case "settings_get":
          return {
            theme: localStorage.getItem("glyphra.theme") === "light" ? "light" : "dark",
            language: localStorage.getItem("glyphra.lang") || "zh-CN",
          };
        case "settings_set":
          return null;
        case "app_ready":
          return { mica: false, os: "linux" };
        case "perf_mark":
          return null;
        case "project_recent":
          return [];
        case "agent_detect":
          return [
            { backend: "fixture", installed: true, detail: "bundled" },
            { backend: "codex-acp", installed: false, detail: null },
            { backend: "claude-acp", installed: false, detail: null },
            { backend: "pi-agent", installed: false, detail: null },
          ];
        case "runtime_detect":
          return {
            os: "linux",
            node: { installed: true, version: "v22.14.0", path: "/usr/bin/node" },
            git: { installed: true, version: "2.43.0", path: "/usr/bin/git" },
          };
        case "providers_list":
          return [];
        case "plugin:window|is_maximized":
          return false;
        case "plugin:window|inner_size":
          return { width: 1440, height: 900 };
        case "plugin:window|outer_size":
          return { width: 1440, height: 900 };
        case "plugin:window|scale_factor":
          return 1;
        case "plugin:window|theme":
          return "dark";
        case "plugin:window|is_fullscreen":
        case "plugin:window|is_minimized":
        case "plugin:window|is_focused":
        case "plugin:window|is_decorated":
        case "plugin:window|is_resizable":
        case "plugin:window|is_maximizable":
        case "plugin:window|is_minimizable":
        case "plugin:window|is_closable":
        case "plugin:window|is_visible":
        case "plugin:window|is_always_on_top":
          return false;
        case "plugin:window|title":
          return "Glyphra";
        case "plugin:window|minimize":
        case "plugin:window|toggle_maximize":
        case "plugin:window|close":
          return null;
        case "plugin:event|listen":
          return nextId++;
        case "plugin:event|unlisten":
          return null;
        default:
          console.warn("[preview mock] unhandled invoke:", cmd);
          return null;
      }
    },
  };
};

async function main() {
  const require = createRequire(import.meta.url);
  let puppeteer;
  try {
    puppeteer = require("puppeteer-core");
  } catch {
    const { execSync } = await import("node:child_process");
    const tmp = "/tmp/glyphra-preview-deps";
    execSync(`mkdir -p ${tmp} && cd ${tmp} && npm init -y >/dev/null 2>&1 && npm i puppeteer-core@24.15.0 --silent`, {
      stdio: "inherit",
    });
    puppeteer = require("/tmp/glyphra-preview-deps/node_modules/puppeteer-core");
  }

  const vite = spawn("pnpm", ["exec", "vite", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    stdio: "pipe",
    env: { ...process.env, BROWSER: "none" },
  });

  let viteLog = "";
  vite.stdout.on("data", (d) => {
    viteLog += d.toString();
  });
  vite.stderr.on("data", (d) => {
    viteLog += d.toString();
  });

  try {
    await waitForServer();

    const browser = await puppeteer.launch({
      executablePath: "/usr/local/bin/google-chrome",
      headless: true,
      args: ["--no-sandbox", "--disable-gpu", "--window-size=1440,900"],
      defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    });

    const page = await browser.newPage();
    await page.evaluateOnNewDocument(mockInit);
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem("glyphra.onboarding.done", "1");
      localStorage.setItem("glyphra.theme", "dark");
      localStorage.setItem("glyphra.agentOpen", "1");
      localStorage.setItem("glyphra.lang", "zh-CN");
    });

    await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
    await wait(800);

    const openPath = path.join(outDir, "agent-workspace-open.png");
    await page.screenshot({ path: openPath, fullPage: false });
    console.log("wrote", openPath);

    // Toggle via titlebar Agent button
    const buttons = await page.$$("button");
    for (const btn of buttons) {
      const title = await page.evaluate((el) => el.getAttribute("title") || el.textContent || "", btn);
      if (title.includes("隐藏") || title.includes("Hide") || title.trim() === "Agent") {
        await btn.click();
        break;
      }
    }
    await wait(700);

    const closedPath = path.join(outDir, "agent-workspace-closed.png");
    await page.screenshot({ path: closedPath, fullPage: false });
    console.log("wrote", closedPath);

    // Re-open and capture light theme too
    await page.evaluate(() => {
      localStorage.setItem("glyphra.theme", "light");
      localStorage.setItem("glyphra.agentOpen", "1");
      document.documentElement.dataset.theme = "light";
      document.documentElement.dataset.mica = "false";
    });
    await page.reload({ waitUntil: "networkidle0" });
    await wait(800);
    const lightPath = path.join(outDir, "agent-workspace-light.png");
    await page.screenshot({ path: lightPath, fullPage: false });
    console.log("wrote", lightPath);

    await browser.close();
  } finally {
    vite.kill("SIGTERM");
    await wait(300);
    if (!vite.killed) vite.kill("SIGKILL");
    if (viteLog.includes("error")) console.error(viteLog.slice(-2000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
