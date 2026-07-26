import { describe, expect, it } from "vitest";

import type { McpServerRecord } from "@/lib/ipc/ipc";

import { toAcpMcpServers } from "./mcpStore";

const base: Pick<McpServerRecord, "createdAt" | "updatedAt"> = {
  createdAt: 1,
  updatedAt: 1,
};

describe("toAcpMcpServers", () => {
  it("maps only enabled and valid persisted servers", () => {
    expect(toAcpMcpServers([
      {
        ...base,
        id: "stdio",
        name: "Files",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
        url: null,
        enabled: true,
      },
      {
        ...base,
        id: "remote",
        name: "Remote",
        transport: "http",
        command: null,
        args: [],
        url: "https://example.com/mcp",
        enabled: true,
      },
      {
        ...base,
        id: "off",
        name: "Off",
        transport: "sse",
        command: null,
        args: [],
        url: "https://example.com/sse",
        enabled: false,
      },
    ])).toEqual([
      {
        name: "Files",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
        env: [],
      },
      {
        type: "http",
        name: "Remote",
        url: "https://example.com/mcp",
        headers: [],
      },
    ]);
  });
});
