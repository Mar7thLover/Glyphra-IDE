import { describe, expect, it } from "vitest";

import { agentGuides, runtimeGuides } from "./installGuides";

describe("installGuides", () => {
  it("offers winget/irm commands on Windows", () => {
    const runtime = runtimeGuides("windows");
    const agents = agentGuides("windows");
    expect(runtime.some((g) => g.commands.some((c) => c.command.includes("winget")))).toBe(true);
    expect(
      agents
        .find((g) => g.id === "claude-acp")
        ?.commands.some((c) => c.command.includes("claude.ai/install.ps1")),
    ).toBe(true);
  });

  it("offers non-Windows installers elsewhere", () => {
    const agents = agentGuides("linux");
    expect(
      agents
        .find((g) => g.id === "claude-acp")
        ?.commands.some((c) => c.command.includes("install.sh")),
    ).toBe(true);
    expect(runtimeGuides("linux").every((g) => g.required)).toBe(true);
  });
});
