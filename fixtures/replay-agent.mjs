#!/usr/bin/env node
/**
 * Glyphra M1 fixture agent — real ACP via @agentclientprotocol/sdk.
 *
 * Default: synthetic demo turn (plan / tool / permission).
 * Tape mode: `node fixtures/replay-agent.mjs --tape=fixtures/tapes/demo-edit-turn.jsonl`
 *   or env `GLYPHRA_TAPE=<path>` — replay UI event tape with relative delays.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const sessions = new Map();

function sleep(ms, signal) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(resolvePromise, ms);
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

function resolveTapePath() {
  const arg = process.argv.find((value) => value.startsWith("--tape="));
  if (arg) return resolve(arg.slice("--tape=".length));
  if (process.env.GLYPHRA_TAPE) return resolve(process.env.GLYPHRA_TAPE);
  return null;
}

function loadUiTape(path) {
  const text = readFileSync(path, "utf8");
  const events = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const event = JSON.parse(line);
    if (event.kind === "meta") continue;
    events.push(event);
  }
  return events;
}

function substitutePrompt(value, userText) {
  if (typeof value === "string") {
    return value.replaceAll("{{prompt}}", userText);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => substitutePrompt(entry, userText));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = substitutePrompt(child, userText);
    }
    return out;
  }
  return value;
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

async function promptFromTape(params, cx, tapeEvents) {
  const session = sessions.get(params.sessionId);
  if (!session) throw new Error(`unknown session ${params.sessionId}`);
  session.pending?.abort();
  session.pending = new AbortController();
  const signal = session.pending.signal;

  const userText =
    Array.isArray(params.prompt) && params.prompt[0]?.type === "text"
      ? params.prompt[0].text
      : "hello";

  let lastT = 0;
  let stopReason = "end_turn";
  let skipAllowPath = false;

  for (const event of tapeEvents) {
    const delay = Math.max(0, (event.t ?? 0) - lastT);
    lastT = event.t ?? lastT;
    if (delay > 0) await sleep(delay, signal);

    if (event.kind === "update") {
      if (skipAllowPath) continue;
      const update = substitutePrompt(event.update, userText);
      await cx.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId,
        update,
      });
      continue;
    }

    if (event.kind === "permission") {
      const permission = await cx.request(acp.methods.client.session.requestPermission, {
        sessionId: params.sessionId,
        toolCall: event.toolCall,
        options: event.options,
      });
      if (permission.outcome.outcome === "cancelled") {
        stopReason = "cancelled";
        break;
      }
      const optionId = permission.outcome.optionId;
      const allowed = optionId === "allow" || optionId === "allow_always";
      if (!allowed) {
        skipAllowPath = true;
        await cx.notify(acp.methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: event.toolCall.toolCallId,
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
      continue;
    }

    if (event.kind === "stop") {
      stopReason = event.stopReason ?? "end_turn";
      break;
    }
  }

  session.pending = null;
  return { stopReason };
}

async function promptSynthetic(params, cx) {
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
      { kind: "allow_always", name: "Allow always", optionId: "allow_always" },
    ],
  });

  if (permission.outcome.outcome === "cancelled") {
    return { stopReason: "cancelled" };
  }

  const allowed =
    permission.outcome.optionId === "allow" ||
    permission.outcome.optionId === "allow_always";

  if (allowed) {
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

const tapePath = resolveTapePath();
const tapeEvents = tapePath ? loadUiTape(tapePath) : null;
if (tapePath) {
  console.error(`[glyphra-fixture] replaying tape ${tapePath} (${tapeEvents.length} events)`);
}

const output = Writable.toWeb(process.stdout);
const input = Readable.toWeb(process.stdin);
const stream = acp.ndJsonStream(output, input);

acp
  .agent({ name: "glyphra-fixture" })
  .onRequest(acp.methods.agent.initialize, (ctx) => initialize(ctx.params))
  .onRequest(acp.methods.agent.session.new, (ctx) => newSession(ctx.params))
  .onRequest(acp.methods.agent.authenticate, async () => ({}))
  .onRequest(acp.methods.agent.session.prompt, (ctx) =>
    tapeEvents
      ? promptFromTape(ctx.params, ctx.client, tapeEvents)
      : promptSynthetic(ctx.params, ctx.client),
  )
  .onNotification(acp.methods.agent.session.cancel, (ctx) => cancel(ctx.params))
  .connect(stream);
