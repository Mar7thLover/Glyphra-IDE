import { describe, expect, it } from "vitest";
import * as acp from "@agentclientprotocol/sdk";

import { applySessionUpdate } from "./sessionUpdates";

/**
 * In-process ACP client↔agent roundtrip (no Tauri / no subprocess).
 * Proves initialize → session/new → prompt → updates → permission.
 */
describe("ACP SDK in-process roundtrip", () => {
  it("runs initialize, session, prompt with permission", async () => {
    const agentApp = acp
      .agent({ name: "fixture-inprocess" })
      .onRequest(acp.methods.agent.initialize, async () => ({
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: { loadSession: false },
        agentInfo: { name: "fixture-inprocess", version: "0" },
        authMethods: [],
      }))
      .onRequest(acp.methods.agent.session.new, async () => ({
        sessionId: "s-test",
      }))
      .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
        await ctx.client.notify(acp.methods.client.session.update, {
          sessionId: ctx.params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hi " },
          },
        });
        await ctx.client.notify(acp.methods.client.session.update, {
          sessionId: ctx.params.sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "t1",
            title: "Demo edit",
            kind: "edit",
            status: "pending",
          },
        });
        const permission = await ctx.client.request(
          acp.methods.client.session.requestPermission,
          {
            sessionId: ctx.params.sessionId,
            toolCall: { toolCallId: "t1", title: "Demo edit" },
            options: [
              { kind: "allow_once", name: "Allow", optionId: "allow" },
              { kind: "reject_once", name: "Reject", optionId: "reject" },
            ],
          },
        );
        expect(permission.outcome.outcome).toBe("selected");
        await ctx.client.notify(acp.methods.client.session.update, {
          sessionId: ctx.params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "done" },
          },
        });
        return { stopReason: "end_turn" };
      });

    let timeline = applySessionUpdate([], {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "" },
    });
    // reset by replacing
    timeline = [];

    const stopReason = await acp
      .client({ name: "glyphra-test" })
      .onRequest(acp.methods.client.session.requestPermission, async () => ({
        outcome: { outcome: "selected" as const, optionId: "allow" },
      }))
      .onRequest(acp.methods.client.fs.readTextFile, async () => ({ content: "" }))
      .onRequest(acp.methods.client.fs.writeTextFile, async () => ({}))
      .connectWith(agentApp, async (ctx) => {
        await ctx.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
          clientInfo: { name: "glyphra-test", version: "0" },
        });

        return ctx.buildSession("/tmp").withSession(async (session) => {
          expect(session.sessionId).toBe("s-test");
          void session.prompt("ping");
          for (;;) {
            const message = await session.nextUpdate();
            if (message.kind === "stop") return message.stopReason;
            timeline = applySessionUpdate(timeline, message.update);
          }
        });
      });

    expect(stopReason).toBe("end_turn");
    const assistant = timeline.filter((item) => item.kind === "assistant");
    expect(assistant.some((item) => item.kind === "assistant" && item.text.includes("hi"))).toBe(
      true,
    );
    expect(timeline.some((item) => item.kind === "tool")).toBe(true);
  });
});
