import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

describe("Claude harness catalog", () => {
  it("returns the complete model list with every required AgentModelInfo field", async () => {
    const stdout = await new Promise<string>((resolveCatalog, rejectCatalog) => {
      const child = spawn(process.execPath, [
        resolve(projectRoot, "scripts/harness-bridge.mjs"),
        "--catalog=1",
        "--protocol=claude-stream-json",
        "--command=claude",
        "--args=[]",
        `--cwd=${projectRoot}`,
      ], {
        cwd: projectRoot,
        windowsHide: true,
      });
      let output = "";
      let errorOutput = "";
      const timeout = setTimeout(() => {
        child.kill();
        rejectCatalog(new Error("Claude catalog process did not produce a result"));
      }, 10_000);
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const newline = output.indexOf("\n");
        if (newline < 0) return;
        clearTimeout(timeout);
        child.kill();
        resolveCatalog(output.slice(0, newline));
      });
      child.stderr.on("data", (chunk: Buffer) => {
        errorOutput += chunk.toString();
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        rejectCatalog(error);
      });
      child.once("exit", (code) => {
        if (output.includes("\n")) return;
        clearTimeout(timeout);
        rejectCatalog(new Error(errorOutput || `Claude catalog process exited (${code})`));
      });
    });
    const catalog = JSON.parse(stdout) as {
      defaultModel: string;
      models: Array<Record<string, unknown>>;
    };

    expect(catalog.defaultModel).toBe("default");
    expect(catalog.models.map((model) => model.id)).toEqual([
      "default",
      "best",
      "fable",
      "claude-fable-5",
      "opus",
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-opus-4-5-20251101",
      "claude-opus-4-1-20250805",
      "opus[1m]",
      "sonnet",
      "claude-sonnet-5",
      "claude-sonnet-4-6",
      "claude-sonnet-4-5-20250929",
      "sonnet[1m]",
      "haiku",
      "claude-haiku-4-5-20251001",
      "opusplan",
    ]);
    for (const model of catalog.models) {
      expect(model).toEqual(expect.objectContaining({
        id: expect.any(String),
        label: expect.any(String),
        description: expect.any(String),
        reasoningEfforts: expect.any(Array),
        defaultReasoningEffort: expect.any(String),
        supportsFastMode: expect.any(Boolean),
        isDefault: expect.any(Boolean),
      }));
    }
    expect(catalog.models.filter((model) => model.isDefault).map((model) => model.id))
      .toEqual(["default"]);
  }, 15_000);
});
