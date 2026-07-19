#!/usr/bin/env node
/**
 * Minimal NDJSON agent fixture for Glyphra M1.
 * Speaks a tiny subset of ACP-shaped JSON-RPC over stdio.
 */
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

send({
  jsonrpc: "2.0",
  method: "session/update",
  params: {
    sessionId: "fixture",
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Glyphra fixture agent ready.\n" },
    },
  },
});

rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "fixture",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `ignored non-JSON: ${line}\n` },
        },
      },
    });
    return;
  }

  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: false },
        agentInfo: { name: "glyphra-fixture", version: "0.1.0" },
      },
    });
    return;
  }

  if (msg.method === "session/new") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: { sessionId: "fixture-session" },
    });
    return;
  }

  if (msg.method === "session/prompt") {
    const text =
      Array.isArray(msg.params?.prompt) && msg.params.prompt[0]?.text
        ? msg.params.prompt[0].text
        : "hello";
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "fixture-session",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `Echo: ${text}\n` },
        },
      },
    });
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: { stopReason: "end_turn" },
    });
    return;
  }

  if (msg.id != null) {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: `Method not found: ${msg.method}` },
    });
  }
});
