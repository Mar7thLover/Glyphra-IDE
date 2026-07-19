#!/usr/bin/env node
/**
 * Glyphra M1 fixture agent — real ACP via @agentclientprotocol/sdk.
 * Exercises initialize → session/new → prompt, plus plan / tool / permission.
 */
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const sessions = new Map();

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function initialize() {
  return {
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false },
    agentInfo: {
      name: "glyphra-fixture",
      title: "Glyphra Fixture Agent",
      version: "0.1.0",
    },
    authMethods: [],
  };
}

async function newSession() {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { pending: null });
  return { sessionId };
}

async function prompt(params, cx) {
  const session = sessions.get(params.sessionId);
  if (!session) throw new Error(`unknown session ${params.sessionId}`);
  session.pending?.abort();
  session.pending = new AbortController();
  const signal = session.pending.signal;

  const userText =
    Array.isArray(params.prompt) && params.prompt[0]?.type === "text"
      ? params.prompt[0].text
      : "hello";

  await cx.notify(acp.methods.client.session.update, {
    sessionId: params.sessionId,
    update: {
      sessionUpdate: "plan",
      entries: [
        { content: "Understand the request", status: "completed", priority: "high" },
        { content: "Echo a reply", status: "in_progress", priority: "medium" },
        { content: "Demo a permissioned edit", status: "pending", priority: "low" },
      ],
    },
  });

  await sleep(20, signal);
  await cx.notify(acp.methods.client.session.update, {
    sessionId: params.sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `Echo: **${userText}**\n\n` },
    },
  });

  await sleep(20, signal);
  await cx.notify(acp.methods.client.session.update, {
    sessionId: params.sessionId,
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "call_read",
      title: "Reading workspace",
      kind: "read",
      status: "pending",
      locations: [{ path: "/tmp" }],
    },
  });
  await sleep(20, signal);
  await cx.notify(acp.methods.client.session.update, {
    sessionId: params.sessionId,
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "call_read",
      status: "completed",
      content: [
        {
          type: "content",
          content: { type: "text", text: "Fixture workspace snapshot OK." },
        },
      ],
    },
  });

  await sleep(20, signal);
  await cx.notify(acp.methods.client.session.update, {
    sessionId: params.sessionId,
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "call_edit",
      title: "Propose a demo edit",
      kind: "edit",
      status: "pending",
      locations: [{ path: "/tmp/glyphra-fixture.txt" }],
    },
  });

  const permission = await cx.request(acp.methods.client.session.requestPermission, {
    sessionId: params.sessionId,
    toolCall: {
      toolCallId: "call_edit",
      title: "Propose a demo edit",
      kind: "edit",
      status: "pending",
      locations: [{ path: "/tmp/glyphra-fixture.txt" }],
    },
    options: [
      { kind: "allow_once", name: "Allow", optionId: "allow" },
      { kind: "reject_once", name: "Reject", optionId: "reject" },
    ],
  });

  if (permission.outcome.outcome === "cancelled") {
    return { stopReason: "cancelled" };
  }

  if (permission.outcome.optionId === "allow") {
    await cx.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call_edit",
        status: "completed",
        rawOutput: { ok: true },
      },
    });
    await cx.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Edit allowed — fixture turn complete." },
      },
    });
  } else {
    await cx.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call_edit",
        status: "failed",
      },
    });
    await cx.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Edit rejected — fixture turn complete." },
      },
    });
  }

  session.pending = null;
  return { stopReason: "end_turn" };
}

async function cancel(params) {
  sessions.get(params.sessionId)?.pending?.abort();
}

const output = Writable.toWeb(process.stdout);
const input = Readable.toWeb(process.stdin);
const stream = acp.ndJsonStream(output, input);

acp
  .agent({ name: "glyphra-fixture" })
  .onRequest(acp.methods.agent.initialize, (ctx) => initialize(ctx.params))
  .onRequest(acp.methods.agent.session.new, (ctx) => newSession(ctx.params))
  .onRequest(acp.methods.agent.authenticate, async () => ({}))
  .onRequest(acp.methods.agent.session.prompt, (ctx) => prompt(ctx.params, ctx.client))
  .onNotification(acp.methods.agent.session.cancel, (ctx) => cancel(ctx.params))
  .connect(stream);
