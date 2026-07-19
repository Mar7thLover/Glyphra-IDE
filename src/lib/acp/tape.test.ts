import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";
import * as acp from "@agentclientprotocol/sdk";

import { applySessionUpdate, resetTimelineIds } from "./sessionUpdates";
import {
  parseUiTape,
  replayUiTape,
  sessionUpdatesFromWireTape,
} from "./tape";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("UI tape replay", () => {
  beforeEach(() => {
    resetTimelineIds();
  });

  it("replays demo-edit-turn into a full timeline", () => {
    const text = readFileSync(
      join(root, "fixtures/tapes/demo-edit-turn.jsonl"),
      "utf8",
    );
    const events = parseUiTape(text);
    const { items, stopReason, permissions } = replayUiTape(events, {
      promptText: "ship it",
      permissionChoice: "allow",
    });

    expect(permissions).toBe(1);
    expect(stopReason).toBe("end_turn");
    expect(items.some((item) => item.kind === "plan")).toBe(true);
    expect(items.some((item) => item.kind === "assistant" && item.text.includes("ship it"))).toBe(
      true,
    );
    const edit = items.find(
      (item) => item.kind === "tool" && item.toolCallId === "call_edit",
    );
    expect(edit).toMatchObject({ kind: "tool", status: "completed" });
    expect(
      items.some(
        (item) =>
          item.kind === "assistant" && item.text.includes("Edit allowed"),
      ),
    ).toBe(true);
  });

  it("handles reject permission choice", () => {
    const text = readFileSync(
      join(root, "fixtures/tapes/demo-edit-turn.jsonl"),
      "utf8",
    );
    const { items, stopReason } = replayUiTape(parseUiTape(text), {
      permissionChoice: "reject",
    });
    expect(stopReason).toBe("end_turn");
    const edit = items.find(
      (item) => item.kind === "tool" && item.toolCallId === "call_edit",
    );
    expect(edit).toMatchObject({ status: "failed" });
    expect(
      items.some(
        (item) =>
          item.kind === "assistant" && item.text.includes("Edit rejected"),
      ),
    ).toBe(true);
  });
});

describe("wire tape → session updates", () => {
  beforeEach(() => {
    resetTimelineIds();
  });

  it("extracts updates from recorder sample and folds timeline", () => {
    const text = readFileSync(
      join(root, "fixtures/tapes/wire-framing-sample.jsonl"),
      "utf8",
    );
    const updates = sessionUpdatesFromWireTape(text);
    expect(updates).toHaveLength(1);
    let items = applySessionUpdate([], updates[0]!);
    expect(items).toMatchObject([{ kind: "assistant", text: "Hello from tape" }]);
  });
});

describe("ACP in-process feed from UI tape", () => {
  it("streams tape updates through the SDK client", async () => {
    const text = readFileSync(
      join(root, "fixtures/tapes/demo-edit-turn.jsonl"),
      "utf8",
    );
    const events = parseUiTape(text).filter((event) => event.kind === "update");

    const agentApp = acp
      .agent({ name: "tape-agent" })
      .onRequest(acp.methods.agent.initialize, async () => ({
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: { loadSession: false },
        agentInfo: { name: "tape-agent", version: "0" },
        authMethods: [],
      }))
      .onRequest(acp.methods.agent.session.new, async () => ({
        sessionId: "tape-session",
      }))
      .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
        for (const event of events) {
          if (event.kind !== "update") continue;
          await ctx.client.notify(acp.methods.client.session.update, {
            sessionId: ctx.params.sessionId,
            update: event.update,
          });
        }
        return { stopReason: "end_turn" as const };
      });

    resetTimelineIds();
    let items = applySessionUpdate([], {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "" },
    });
    items = [];

    await acp
      .client({ name: "glyphra-tape-test" })
      .onRequest(acp.methods.client.session.requestPermission, async () => ({
        outcome: { outcome: "selected" as const, optionId: "allow" },
      }))
      .onRequest(acp.methods.client.fs.readTextFile, async () => ({ content: "" }))
      .onRequest(acp.methods.client.fs.writeTextFile, async () => ({}))
      .connectWith(agentApp, async (ctx) => {
        await ctx.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
        });
        const session = await ctx.buildSession("/tmp").start();
        const promptPromise = session.prompt("from tape");
        for (;;) {
          const message = await session.nextUpdate();
          if (message.kind === "stop") {
            await promptPromise;
            break;
          }
          items = applySessionUpdate(items, message.update);
        }
        session.dispose();
      });

    expect(items.some((item) => item.kind === "plan")).toBe(true);
    expect(items.some((item) => item.kind === "tool")).toBe(true);
    expect(items.some((item) => item.kind === "assistant")).toBe(true);
  });
});
