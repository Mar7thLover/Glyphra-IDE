#!/usr/bin/env node
/**
 * Normalizes native harness protocols to ACP so the Glyphra frontend has one
 * interaction model. Stdout is reserved for ACP NDJSON; diagnostics use stderr.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

function option(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const protocol = option("protocol", "shell-command");
const command = option("command");
const commandArgs = JSON.parse(option("args", "[]"));
const endpoint = option("endpoint");
const initialModel = option("model");
const initialReasoningEffort = option("reasoning-effort");
const contextWindow = Number(option("context-window", "0")) || null;
const initialFastMode = option("fast-mode") === "1";
const prewarmedSessionId = option("prewarmed-session-id") || null;
const approvalReviewer = option("approval-reviewer", "user");
let mode = process.env.INITIAL_AGENT_MODE ?? "agent";
const sessions = new Map();

function childOptions(executable = command) {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(executable),
  };
}

function launch(args, executable = command) {
  const child = spawn(executable, args, childOptions(executable));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

function runNative(args) {
  return new Promise((resolve, reject) => {
    const child = launch(args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `${command} exited (${code})`));
    });
  });
}

function userText(params) {
  return params.prompt?.filter((part) => part.type === "text").map((part) => part.text).join("\n") ?? "";
}

async function update(cx, sessionId, value) {
  if (process.env.GLYPHRA_BRIDGE_DEBUG === "1") {
    process.stderr.write(`[acp update] ${JSON.stringify({ sessionId, update: value })}\n`);
  }
  await cx.notify(acp.methods.client.session.update, { sessionId, update: value });
}

function toolDescriptor(item) {
  if (item.type === "commandExecution") {
    return { title: item.command || "Run command", kind: "execute", locations: item.cwd ? [{ path: item.cwd }] : [] };
  }
  if (item.type === "fileChange") {
    return {
      title: `Change ${item.changes?.length ?? 0} file(s)`,
      kind: "edit",
      locations: (item.changes ?? []).map((change) => ({ path: change.path })),
    };
  }
  if (item.type === "mcpToolCall") return { title: `${item.server}: ${item.tool}`, kind: "other", locations: [] };
  if (item.type === "dynamicToolCall") return { title: item.tool, kind: "other", locations: [] };
  if (item.type === "webSearch") return { title: "Web search", kind: "search", locations: [] };
  return null;
}

class JsonRpcPeer {
  constructor(args, onNotification, onRequest, executable = command) {
    this.child = launch(args, executable);
    this.nextId = 1;
    this.pending = new Map();
    this.notificationQueue = Promise.resolve();
    this.onNotification = onNotification;
    this.onRequest = onRequest;
    createInterface({ input: this.child.stdout }).on("line", (line) => this.receive(line));
    this.child.on("exit", (code) => {
      const error = new Error(`native harness exited (${code ?? "signal"})`);
      for (const waiter of this.pending.values()) waiter.reject(error);
      this.pending.clear();
    });
  }

  receive(line) {
    if (process.env.GLYPHRA_BRIDGE_DEBUG === "1") {
      process.stderr.write(`[native stdout] ${line}\n`);
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      process.stderr.write(`[harness-bridge] ignored non-JSON output: ${line}\n`);
      return;
    }
    if (message.id != null && ("result" in message || "error" in message) && !message.method) {
      const waiter = this.pending.get(String(message.id));
      if (!waiter) return;
      this.pending.delete(String(message.id));
      if (message.error) {
        const detail = message.error.data == null
          ? ""
          : `: ${typeof message.error.data === "string" ? message.error.data : JSON.stringify(message.error.data)}`;
        waiter.reject(new Error(`${message.error.message ?? "JSON-RPC error"}${detail}`));
      }
      else waiter.resolve(message.result);
      return;
    }
    if (message.id != null && message.method) {
      Promise.resolve(this.onRequest?.(message))
        .then((result) => this.send({ id: message.id, result: result ?? {} }))
        .catch((error) => this.send({ id: message.id, error: { code: -32603, message: String(error?.message ?? error) } }));
      return;
    }
    if (message.method) {
      // Preserve native notification order. In particular, token usage must be
      // delivered before turn/completed resolves the ACP prompt response.
      this.notificationQueue = this.notificationQueue
        .then(() => this.onNotification?.(message))
        .catch((error) => {
          process.stderr.write(`[harness-bridge] notification failed: ${error?.stack ?? error}\n`);
        });
    }
  }

  send(message) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params) {
    const id = String(this.nextId++);
    this.send({ id, method, params });
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  notify(method, params) {
    this.send(params === undefined ? { method } : { method, params });
  }
}

let codexPeer;
const codexTurns = new Map();

async function codexServerRequest(message) {
  const params = message.params ?? {};
  const turn = codexTurns.get(params.threadId);
  if (!turn) return { decision: "decline" };
  if (message.method === "item/commandExecution/requestApproval" || message.method === "item/fileChange/requestApproval") {
    const title = params.command || params.reason || (message.method.includes("fileChange") ? "Apply file changes" : "Run command");
    const permission = await turn.cx.request(acp.methods.client.session.requestPermission, {
      sessionId: params.threadId,
      toolCall: {
        toolCallId: params.itemId,
        title,
        kind: message.method.includes("fileChange") ? "edit" : "execute",
        status: "pending",
        locations: [params.cwd, params.grantRoot].filter(Boolean).map((path) => ({ path })),
      },
      options: [
        { optionId: "accept", name: "Allow", kind: "allow_once" },
        { optionId: "decline", name: "Reject", kind: "reject_once" },
        { optionId: "acceptForSession", name: "Allow for session", kind: "allow_always" },
      ],
    });
    const decision = permission.outcome.outcome === "selected" ? permission.outcome.optionId : "cancel";
    return { decision };
  }
  return {};
}

async function codexNotification(message) {
  const params = message.params ?? {};
  const turn = codexTurns.get(params.threadId);
  if (!turn) return;
  if (message.method === "thread/tokenUsage/updated") {
    const usage = params.tokenUsage ?? {};
    const used = Number(usage.last?.totalTokens ?? usage.total?.totalTokens ?? 0);
    const size = Number(usage.modelContextWindow ?? 0);
    const session = sessions.get(params.threadId);
    if (session) session.contextUsage = usage;
    if (size > 0) {
      await update(turn.cx, params.threadId, {
        sessionUpdate: "usage_update",
        used: Math.max(0, used),
        size,
      });
    }
  } else if (message.method === "item/agentMessage/delta") {
    await update(turn.cx, params.threadId, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: params.delta ?? "" },
    });
  } else if (message.method === "turn/plan/updated") {
    await update(turn.cx, params.threadId, {
      sessionUpdate: "plan",
      entries: (params.plan ?? []).map((entry) => ({ content: entry.step, status: entry.status })),
    });
  } else if (message.method === "item/started") {
    const descriptor = toolDescriptor(params.item);
    if (descriptor) {
      await update(turn.cx, params.threadId, {
        sessionUpdate: "tool_call",
        toolCallId: params.item.id,
        status: "in_progress",
        ...descriptor,
      });
    }
  } else if (message.method === "item/completed") {
    const descriptor = toolDescriptor(params.item);
    if (descriptor) {
      const failed = ["failed", "declined"].includes(params.item.status);
      await update(turn.cx, params.threadId, {
        sessionUpdate: "tool_call_update",
        toolCallId: params.item.id,
        status: failed ? "failed" : "completed",
        rawOutput: params.item.aggregatedOutput ?? params.item.result ?? params.item.error ?? null,
      });
    }
  } else if (message.method === "turn/completed") {
    codexTurns.delete(params.threadId);
    turn.resolve(params.turn?.status === "interrupted" ? "cancelled" : params.turn?.status === "failed" ? "refusal" : "end_turn");
  } else if (message.method === "error") {
    await update(turn.cx, params.threadId, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `\n\nHarness error: ${params.error?.message ?? params.message ?? "unknown error"}` },
    });
  }
}

async function ensureCodex() {
  if (codexPeer) return codexPeer;
  const configArgs = [];
  if (process.env.CODEX_CONFIG) {
    try {
      const config = JSON.parse(process.env.CODEX_CONFIG);
      for (const key of ["model_provider", "model"]) {
        if (config[key] != null) configArgs.push("-c", `${key}=${JSON.stringify(config[key])}`);
      }
      for (const [providerId, provider] of Object.entries(config.model_providers ?? {})) {
        for (const key of ["base_url", "env_key", "wire_api"]) {
          if (provider[key] != null) {
            configArgs.push(
              "-c",
              `model_providers.${providerId}.${key}=${JSON.stringify(provider[key])}`,
            );
          }
        }
      }
    } catch (error) {
      process.stderr.write(`[harness-bridge] invalid CODEX_CONFIG: ${error?.message ?? error}\n`);
    }
  }
  // Codex currently spends ~15s attempting a PowerShell snapshot and then
  // reports that PowerShell snapshots are unsupported. Keep the user's native
  // configuration untouched and disable it only for this Windows bridge.
  if (process.platform === "win32") {
    configArgs.push("-c", "features.shell_snapshot=false");
  }
  let nativeArgs = [...commandArgs, ...configArgs, "app-server", "--stdio"];
  let nativeExecutable = command;
  if (process.platform === "win32" && process.env.GLYPHRA_CODEX_DAEMON !== "0") {
    const daemonScript = new URL("./codex-app-server-daemon.mjs", import.meta.url).pathname.replace(
      /^\/(.:\/)/,
      "$1",
    );
    const daemonKey = createHash("sha256")
      .update(JSON.stringify([command, nativeArgs, process.env.CODEX_CONFIG ?? ""]))
      .digest("hex")
      .slice(0, 16);
    nativeExecutable = process.execPath;
    nativeArgs = [
      daemonScript,
      `--pipe=\\\\.\\pipe\\glyphra-codex-${daemonKey}`,
      `--command=${command}`,
      `--args=${JSON.stringify(nativeArgs)}`,
    ];
  }
  if (
    process.platform !== "win32" &&
    !process.env.CODEX_CONFIG &&
    process.env.GLYPHRA_CODEX_DAEMON !== "0"
  ) {
    try {
      await runNative([...commandArgs, "app-server", "daemon", "start"]);
      nativeArgs = [...commandArgs, "app-server", "proxy"];
    } catch (error) {
      process.stderr.write(`[harness-bridge] daemon unavailable, using stdio: ${error?.message ?? error}\n`);
    }
  }
  codexPeer = new JsonRpcPeer(
    nativeArgs,
    codexNotification,
    codexServerRequest,
    nativeExecutable,
  );
  await codexPeer.request("initialize", {
    clientInfo: { name: "glyphra", title: "Glyphra", version: "0.1.0" },
    capabilities: null,
  });
  codexPeer.notify("initialized");
  return codexPeer;
}

async function codexNewSession(cwd) {
  const peer = await ensureCodex();
  const permission = permissionConfig();
  if (process.platform === "win32" && permission.sandbox !== "danger-full-access") {
    await ensureWindowsSandbox(peer, cwd);
  }
  const result = await peer.request("thread/start", {
    cwd,
    model: initialModel || null,
    serviceTier: initialFastMode ? "fast" : null,
    approvalPolicy: permission.approvalPolicy,
    approvalsReviewer: permission.approvalsReviewer,
    sandbox: permission.sandbox,
    config: {
      ...(initialReasoningEffort
        ? { model_reasoning_effort: initialReasoningEffort }
        : {}),
      ...(contextWindow
        ? {
            model_context_window: contextWindow,
            model_auto_compact_token_limit: Math.floor(contextWindow * 0.9),
          }
        : {}),
    },
    ephemeral: false,
  });
  return result.thread.id;
}

async function codexResumeSession(sessionId, cwd) {
  const peer = await ensureCodex();
  const permission = permissionConfig();
  if (process.platform === "win32" && permission.sandbox !== "danger-full-access") {
    await ensureWindowsSandbox(peer, cwd);
  }
  const result = await peer.request("thread/resume", {
    threadId: sessionId,
    cwd,
    model: initialModel || null,
    serviceTier: initialFastMode ? "fast" : null,
    approvalPolicy: permission.approvalPolicy,
    approvalsReviewer: permission.approvalsReviewer,
    sandbox: permission.sandbox,
    config: {
      ...(initialReasoningEffort
        ? { model_reasoning_effort: initialReasoningEffort }
        : {}),
      ...(contextWindow
        ? {
            model_context_window: contextWindow,
            model_auto_compact_token_limit: Math.floor(contextWindow * 0.9),
          }
        : {}),
    },
  });
  return result.thread?.id ?? sessionId;
}

function permissionConfig() {
  const full = ["full-access", "agent-full-access", "unleashed"].includes(mode);
  const request = ["request-approval", "read-only", "safe"].includes(mode);
  return {
    approvalPolicy: full ? "never" : "on-request",
    approvalsReviewer: full || request ? "user" : "auto_review",
    sandbox: full ? "danger-full-access" : "workspace-write",
    sandboxPolicy: full ? { type: "dangerFullAccess" } : { type: "workspaceWrite" },
  };
}

async function ensureWindowsSandbox(peer, cwd) {
  let readiness;
  try {
    readiness = await peer.request("windowsSandbox/readiness", {});
  } catch {
    // Older Codex builds do not expose readiness; let thread/start use their
    // native sandbox path instead of converting protocol age into a hard fail.
    return "unsupported";
  }
  if (readiness.status === "ready") return "ready";

  // Use Codex's own setup flow; unelevated setup avoids surprising UAC prompts.
  await peer
    .request("windowsSandbox/setupStart", { mode: "unelevated", cwd })
    .catch((error) => {
      throw new Error(
        `Codex Windows sandbox setup failed (${readiness.status}): ${error?.message ?? error}`,
      );
    });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    readiness = await peer.request("windowsSandbox/readiness", {});
    if (readiness.status === "ready") return "ready";
  }
  throw new Error(
    `Codex Windows sandbox is ${readiness.status}; complete the official elevated sandbox setup or select Full access`,
  );
}

async function codexPrompt(params, cx) {
  const peer = await ensureCodex();
  const session = sessions.get(params.sessionId);
  const permission = permissionConfig();
  const completion = new Promise((resolve, reject) => codexTurns.set(params.sessionId, { cx, resolve, reject, turnId: null }));
  try {
    const result = await peer.request("turn/start", {
      threadId: params.sessionId,
      input: [{ type: "text", text: userText(params), text_elements: [] }],
      model: session?.model || null,
      serviceTier: session?.fastMode ? "fast" : null,
      effort: session?.reasoningEffort || null,
      approvalPolicy: permission.approvalPolicy,
      approvalsReviewer: permission.approvalsReviewer,
      sandboxPolicy: permission.sandboxPolicy,
    });
    const active = codexTurns.get(params.sessionId);
    if (active) active.turnId = result.turn.id;
    const stopReason = await completion;
    const usage = session?.contextUsage;
    const total = usage?.total;
    return {
      stopReason,
      ...(total
        ? {
            usage: {
              totalTokens: Number(total.totalTokens ?? 0),
              inputTokens: Number(total.inputTokens ?? 0),
              outputTokens: Number(total.outputTokens ?? 0),
              thoughtTokens: Number(total.reasoningOutputTokens ?? 0),
              cachedReadTokens: Number(total.cachedInputTokens ?? 0),
            },
          }
        : {}),
      _meta: {
        glyphraContext: {
          used: Number(usage?.last?.totalTokens ?? total?.totalTokens ?? 0),
          size: Number(usage?.modelContextWindow ?? 0),
        },
      },
    };
  } catch (error) {
    codexTurns.delete(params.sessionId);
    throw error;
  }
}

async function streamProcess(args, params, cx, parser) {
  const child = launch(args);
  const state = { child, textSeen: false, tools: new Set(), sessionId: null };
  sessions.get(params.sessionId).active = state;
  const lines = createInterface({ input: child.stdout });
  for await (const line of lines) {
    let event;
    try { event = JSON.parse(line); } catch { event = { type: "text", text: line }; }
    await parser(event, state, params, cx);
  }
  const code = await new Promise((resolve) => child.once("exit", resolve));
  sessions.get(params.sessionId).active = null;
  if (code !== 0) throw new Error(`${protocol} harness exited (${code})`);
  const usage = sessions.get(params.sessionId)?.contextUsage;
  return {
    stopReason: "end_turn",
    _meta: {
      glyphraContext: {
        used: Number(usage?.used ?? 0),
        size: Number(usage?.size ?? 0),
      },
    },
  };
}

async function claudePrompt(params, cx) {
  const session = sessions.get(params.sessionId);
  const nativePermission = permissionConfig();
  const permission = nativePermission.sandbox === "danger-full-access"
    ? "bypassPermissions"
    : nativePermission.approvalsReviewer === "auto_review"
      ? "auto"
      : "manual";
  const args = [...commandArgs, "-p", "--output-format", "stream-json", "--include-partial-messages", "--verbose", "--permission-mode", permission];
  if (nativePermission.sandbox === "danger-full-access") args.push("--dangerously-skip-permissions");
  if (session.model) args.push("--model", session.model);
  if (session.reasoningEffort) args.push("--effort", session.reasoningEffort);
  if (session.fastMode) args.push("--settings", JSON.stringify({ fastMode: true }));
  if (session.nativeSessionId) args.push("--resume", session.nativeSessionId);
  args.push(userText(params));
  return streamProcess(args, params, cx, async (event, state) => {
    if (event.session_id) session.nativeSessionId = event.session_id;
    const streamEvent = event.type === "stream_event" ? event.event : event;
    const delta = streamEvent?.delta?.text ?? (streamEvent?.type === "content_block_delta" ? streamEvent.delta?.text : null);
    if (delta) {
      state.textSeen = true;
      await update(cx, params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: delta } });
    }
    const blocks = event.message?.content ?? [];
    for (const block of blocks) {
      if (block.type === "text" && block.text && !state.textSeen) {
        state.textSeen = true;
        await update(cx, params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: block.text } });
      } else if (block.type === "tool_use" && !state.tools.has(block.id)) {
        state.tools.add(block.id);
        await update(cx, params.sessionId, { sessionUpdate: "tool_call", toolCallId: block.id, title: block.name, kind: "other", status: "in_progress", rawInput: block.input });
      } else if (block.type === "tool_result") {
        await update(cx, params.sessionId, { sessionUpdate: "tool_call_update", toolCallId: block.tool_use_id, status: block.is_error ? "failed" : "completed", rawOutput: block.content });
      }
    }
    if (event.type === "result" && event.result && !state.textSeen) {
      await update(cx, params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: event.result } });
    }
    if (event.type === "result") {
      const modelUsages = Object.values(event.modelUsage ?? {});
      const measured = modelUsages
        .map((entry) => ({
          used: Number(entry.inputTokens ?? 0)
            + Number(entry.cacheReadInputTokens ?? 0)
            + Number(entry.cacheCreationInputTokens ?? 0)
            + Number(entry.outputTokens ?? 0),
          size: Number(entry.contextWindow ?? 0),
        }))
        .filter((entry) => entry.size > 0)
        .sort((a, b) => b.used - a.used)[0];
      if (measured) {
        session.contextUsage = measured;
        await update(cx, params.sessionId, {
          sessionUpdate: "usage_update",
          used: measured.used,
          size: measured.size,
        });
      }
    }
  });
}

async function piPrompt(params, cx) {
  const session = sessions.get(params.sessionId);
  const args = [...commandArgs, "-p", "--mode", "json"];
  if (session.model) args.push("--model", session.model);
  args.push(userText(params));
  return streamProcess(args, params, cx, async (event, state) => {
    const delta = event.delta ?? event.textDelta ?? event.assistantMessageEvent?.delta;
    if (typeof delta === "string") {
      state.textSeen = true;
      await update(cx, params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: delta } });
    } else if ((event.type === "message_end" || event.type === "assistant") && event.message?.content && !state.textSeen) {
      const text = event.message.content.filter((part) => part.type === "text").map((part) => part.text).join("");
      if (text) await update(cx, params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
    } else if (event.type === "tool_execution_start") {
      await update(cx, params.sessionId, { sessionUpdate: "tool_call", toolCallId: event.toolCallId, title: event.toolName, kind: "other", status: "in_progress", rawInput: event.args });
    } else if (event.type === "tool_execution_end") {
      await update(cx, params.sessionId, { sessionUpdate: "tool_call_update", toolCallId: event.toolCallId, status: event.isError ? "failed" : "completed", rawOutput: event.result });
    }
  });
}

async function shellPrompt(params, cx) {
  const prompt = userText(params);
  let replaced = false;
  const args = commandArgs.map((arg) => {
    if (arg.includes("{prompt}")) replaced = true;
    return arg.replaceAll("{prompt}", prompt).replaceAll("{cwd}", process.cwd());
  });
  if (!replaced) args.push(prompt);
  const child = launch(args);
  sessions.get(params.sessionId).active = { child };
  for await (const chunk of child.stdout) {
    await update(cx, params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: chunk.toString() } });
  }
  const code = await new Promise((resolve) => child.once("exit", resolve));
  sessions.get(params.sessionId).active = null;
  if (code !== 0) throw new Error(`shell harness exited (${code})`);
  return { stopReason: "end_turn" };
}

function apiUrl(suffix) {
  const trimmed = endpoint.replace(/\/$/, "");
  return trimmed.endsWith(suffix) ? trimmed : `${trimmed}${suffix}`;
}

async function httpPrompt(params, cx) {
  if (!endpoint) throw new Error(`${protocol} requires an endpoint`);
  const prompt = userText(params);
  const session = sessions.get(params.sessionId);
  session.history.push({ role: "user", content: prompt });
  let url;
  let body;
  const headers = { "content-type": "application/json" };
  if (protocol === "anthropic-messages") {
    url = apiUrl("/messages");
    body = { model: session.model || "claude-sonnet-4-20250514", max_tokens: 4096, messages: session.history };
    const key = process.env.ANTHROPIC_API_KEY || process.env.GLYPHRA_API_KEY;
    if (key) headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
  } else if (protocol === "openai-chat") {
    url = apiUrl("/chat/completions");
    body = { model: session.model || "gpt-4.1", messages: session.history };
    const key = process.env.OPENAI_API_KEY || process.env.GLYPHRA_API_KEY;
    if (key) headers.authorization = `Bearer ${key}`;
  } else {
    url = apiUrl("/responses");
    body = { model: session.model || "gpt-5", input: session.history };
    const key = process.env.OPENAI_API_KEY || process.env.GLYPHRA_API_KEY;
    if (key) headers.authorization = `Bearer ${key}`;
  }
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? `${response.status} ${response.statusText}`);
  const text = protocol === "anthropic-messages"
    ? data.content?.filter((part) => part.type === "text").map((part) => part.text).join("")
    : protocol === "openai-chat"
      ? data.choices?.[0]?.message?.content
      : data.output_text ?? data.output?.flatMap((item) => item.content ?? []).filter((part) => part.type === "output_text").map((part) => part.text).join("");
  session.history.push({ role: "assistant", content: text || "" });
  await update(cx, params.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: text || "(empty response)" } });
  return { stopReason: "end_turn" };
}

let jsonlChild;
const jsonlPending = new Map();
function ensureJsonl() {
  if (jsonlChild) return;
  jsonlChild = launch(commandArgs);
  createInterface({ input: jsonlChild.stdout }).on("line", async (line) => {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    const pending = jsonlPending.get(event.sessionId);
    if (!pending) return;
    if (["message", "assistant", "message.delta"].includes(event.type)) {
      await update(pending.cx, event.sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: event.delta ?? event.text ?? "" } });
    } else if (event.type === "plan") {
      await update(pending.cx, event.sessionId, { sessionUpdate: "plan", entries: event.entries ?? [] });
    } else if (event.type === "tool.start") {
      await update(pending.cx, event.sessionId, { sessionUpdate: "tool_call", toolCallId: event.id, title: event.title ?? event.name ?? "Tool", kind: event.kind ?? "other", status: "in_progress", locations: event.locations ?? [] });
    } else if (event.type === "tool.end") {
      await update(pending.cx, event.sessionId, { sessionUpdate: "tool_call_update", toolCallId: event.id, status: event.error ? "failed" : "completed", rawOutput: event.output ?? event.error });
    } else if (event.type === "done") {
      jsonlPending.delete(event.sessionId);
      pending.resolve({ stopReason: event.stopReason ?? "end_turn" });
    } else if (event.type === "error") {
      jsonlPending.delete(event.sessionId);
      pending.reject(new Error(event.message ?? "JSONL harness error"));
    }
  });
}

async function jsonlPrompt(params, cx) {
  ensureJsonl();
  return new Promise((resolve, reject) => {
    jsonlPending.set(params.sessionId, { cx, resolve, reject });
    jsonlChild.stdin.write(`${JSON.stringify({ type: "prompt", sessionId: params.sessionId, prompt: userText(params), cwd: process.cwd() })}\n`);
  });
}

async function newSession(params) {
  let sessionId;
  try {
    sessionId = protocol === "codex-app-server"
      ? prewarmedSessionId ?? await codexNewSession(params.cwd)
      : crypto.randomUUID();
  } catch (error) {
    process.stderr.write(`[harness-bridge] session/new failed: ${error?.stack ?? error}\n`);
    throw error;
  }
  const session = {
    active: null,
    nativeSessionId: null,
    history: [],
    model: initialModel || null,
    reasoningEffort: initialReasoningEffort || null,
    fastMode: initialFastMode,
    contextUsage: null,
  };
  sessions.set(sessionId, session);
  return { sessionId, configOptions: sessionConfigOptions(session) };
}

async function resumeSession(params) {
  if (protocol !== "codex-app-server") {
    throw new Error(`session/resume is not implemented by bridge protocol ${protocol}`);
  }
  const sessionId = await codexResumeSession(params.sessionId, params.cwd);
  const session = {
    active: null,
    nativeSessionId: sessionId,
    history: [],
    model: initialModel || null,
    reasoningEffort: initialReasoningEffort || null,
    fastMode: initialFastMode,
    contextUsage: null,
  };
  sessions.set(sessionId, session);
  return { configOptions: sessionConfigOptions(session) };
}

function sessionConfigOptions(session) {
  const configOptions = [];
  if (session.model) {
    configOptions.push({
      type: "select",
      id: "model",
      name: "Model",
      category: "model",
      currentValue: session.model,
      options: [{ value: session.model, name: session.model }],
    });
  }
  if (session.reasoningEffort) {
    configOptions.push({
      type: "select",
      id: "reasoning_effort",
      name: "Reasoning effort",
      category: "thought_level",
      currentValue: session.reasoningEffort,
      options: [{ value: session.reasoningEffort, name: session.reasoningEffort }],
    });
  }
  configOptions.push({
    type: "boolean",
    id: "fast_mode",
    name: "Fast mode",
    category: "model_config",
    currentValue: session.fastMode,
  });
  return configOptions;
}

async function setConfigOption(params) {
  const session = sessions.get(params.sessionId);
  if (!session) throw new Error(`unknown session: ${params.sessionId}`);
  if (params.configId === "model") {
    const value = typeof params.value === "string" && params.value ? params.value : null;
    session.model = value;
  } else if (params.configId === "reasoning_effort" || params.configId === "effort") {
    const value = typeof params.value === "string" && params.value ? params.value : null;
    session.reasoningEffort = value;
  } else if (params.configId === "fast_mode") {
    session.fastMode = params.value === true;
  } else {
    throw new Error(`unsupported session config: ${params.configId}`);
  }
  return { configOptions: sessionConfigOptions(session) };
}

async function setMode(params) {
  if (!sessions.has(params.sessionId)) throw new Error(`unknown session: ${params.sessionId}`);
  mode = params.modeId;
  if (protocol === "codex-app-server" && process.platform === "win32") {
    const permission = permissionConfig();
    if (permission.sandbox !== "danger-full-access") {
      await ensureWindowsSandbox(await ensureCodex(), process.cwd());
    }
  }
  return {};
}

async function prompt(params, cx) {
  if (protocol === "codex-app-server") return codexPrompt(params, cx);
  if (protocol === "claude-stream-json") return claudePrompt(params, cx);
  if (protocol === "pi-json") return piPrompt(params, cx);
  if (protocol === "stdio-jsonl") return jsonlPrompt(params, cx);
  if (protocol === "shell-command") return shellPrompt(params, cx);
  if (["openai-responses", "openai-chat", "anthropic-messages"].includes(protocol)) return httpPrompt(params, cx);
  throw new Error(`unsupported bridge protocol: ${protocol}`);
}

async function cancel(params) {
  if (protocol === "codex-app-server") {
    const turn = codexTurns.get(params.sessionId);
    if (turn?.turnId) await codexPeer.request("turn/interrupt", { threadId: params.sessionId, turnId: turn.turnId });
    return;
  }
  sessions.get(params.sessionId)?.active?.child?.kill();
  if (jsonlChild) jsonlChild.stdin.write(`${JSON.stringify({ type: "cancel", sessionId: params.sessionId })}\n`);
}

async function readCatalog(cwd) {
  if (protocol === "codex-app-server") {
    const peer = await ensureCodex();
    const models = [];
    let cursor = null;
    do {
      const page = await peer.request("model/list", {
        cursor,
        limit: 100,
        includeHidden: false,
      });
      models.push(...(page.data ?? []));
      cursor = page.nextCursor ?? null;
    } while (cursor);
    const config = await peer
      .request("config/read", { cwd, includeLayers: false })
      .catch(() => ({ config: {} }));
    const permissionProfiles = await peer
      .request("permissionProfile/list", { cwd, limit: 100 })
      .then((result) => result.data ?? [])
      .catch(() => []);
    const skillCatalog = await peer
      .request("skills/list", { cwds: [cwd], forceReload: false })
      .catch(() => ({ data: [] }));
    const discoveredSkills = (skillCatalog.data ?? skillCatalog.skills ?? [])
      .flatMap((entry) => entry.skills ?? (entry.name ? [entry] : []))
      .filter((entry) => entry?.name && entry.enabled !== false)
      .map((entry) => ({
        name: entry.name,
        description: entry.interface?.shortDescription || entry.shortDescription || entry.description || "",
      }));
    const skills = [...new Map(discoveredSkills.map((entry) => [entry.name, entry])).values()];
    const mcpConfig = config.config?.mcp_servers ?? config.config?.mcpServers ?? {};
    const mcpServers = Object.entries(mcpConfig).map(([name, server]) => ({
      name,
      status: server?.enabled === false ? "disabled" : "configured",
    }));
    const sandboxStatus = process.platform === "win32"
      ? await peer.request("windowsSandbox/readiness", {}).then((value) => value.status).catch(() => "unknown")
      : "ready";
    const configuredModel = config.config?.model ?? null;
    if (configuredModel && !models.some((entry) => entry.model === configuredModel)) {
      models.unshift({
        model: configuredModel,
        displayName: configuredModel,
        description: "Configured provider model",
        supportedReasoningEfforts: [],
        defaultReasoningEffort: null,
        isDefault: true,
      });
    }
    return {
      models: models.map((entry) => ({
        id: entry.model,
        label: entry.displayName || entry.model,
        description: entry.description || "",
        reasoningEfforts: (entry.supportedReasoningEfforts ?? []).map((effort) => ({
          id: effort.reasoningEffort,
          description: effort.description || "",
        })),
        defaultReasoningEffort: entry.defaultReasoningEffort || null,
        supportsFastMode: (entry.serviceTiers ?? []).some((tier) => tier.id === "fast")
          || (entry.additionalSpeedTiers ?? []).includes("fast"),
        isDefault: Boolean(entry.isDefault),
      })),
      defaultModel: configuredModel ?? models.find((entry) => entry.isDefault)?.model ?? null,
      contextWindow: Number(config.config?.model_context_window ?? 0) || null,
      supportsContextWindow: true,
      supportsAutoReview: true,
      sandboxStatus,
      // Catalog discovery must stay read-only. Creating a thread here used to
      // initialize the sandbox before the user had even sent a message and
      // left an extra native CLI session behind.
      prewarmedSessionId: null,
      permissionProfiles: permissionProfiles.map((profile) => ({
        id: profile.id,
        description: profile.description || "",
        allowed: profile.allowed,
      })),
      skills,
      mcpServers,
    };
  }
  if (protocol === "claude-stream-json") {
    return {
      models: ["sonnet", "opus", "haiku"].map((id) => ({
        id,
        label: id[0].toUpperCase() + id.slice(1),
        description: `Claude ${id} alias`,
        reasoningEfforts: ["low", "medium", "high", "xhigh", "max"].map((effort) => ({ id: effort, description: "" })),
        defaultReasoningEffort: "medium",
        supportsFastMode: id === "opus",
        isDefault: id === "sonnet",
      })),
      defaultModel: "sonnet",
      contextWindow: null,
      supportsContextWindow: false,
      supportsAutoReview: false,
      sandboxStatus: "ready",
      prewarmedSessionId: null,
      permissionProfiles: [],
      skills: [],
      mcpServers: [],
    };
  }
  return {
    models: [],
    defaultModel: null,
    contextWindow: null,
    supportsContextWindow: false,
    supportsAutoReview: false,
    sandboxStatus: "unknown",
    prewarmedSessionId: null,
    permissionProfiles: [],
    skills: [],
    mcpServers: [],
  };
}

function codexRateWindows(snapshot, prefix = "Codex") {
  const windows = [];
  for (const [kind, value] of [["primary", snapshot?.primary], ["secondary", snapshot?.secondary]]) {
    if (!value) continue;
    windows.push({
      label: `${prefix} · ${kind}`,
      usedPercent: value.usedPercent ?? null,
      remainingPercent: value.usedPercent == null ? null : Math.max(0, 100 - value.usedPercent),
      limit: null,
      remaining: null,
      resetsAt: value.resetsAt ?? null,
      resetAfter: value.windowDurationMins == null ? null : `${value.windowDurationMins} min window`,
    });
  }
  if (snapshot?.individualLimit) {
    windows.push({
      label: `${prefix} · spend limit`,
      usedPercent: 100 - snapshot.individualLimit.remainingPercent,
      remainingPercent: snapshot.individualLimit.remainingPercent,
      limit: snapshot.individualLimit.limit,
      remaining: null,
      resetsAt: snapshot.individualLimit.resetsAt,
      resetAfter: null,
    });
  }
  return windows;
}

async function readUsage() {
  if (protocol !== "codex-app-server") {
    throw new Error(`usage query is not implemented by bridge protocol ${protocol}`);
  }
  const peer = await ensureCodex();
  const [limits, usage] = await Promise.all([
    peer.request("account/rateLimits/read", {}),
    peer.request("account/usage/read", {}).catch(() => ({ summary: {} })),
  ]);
  const buckets = limits.rateLimitsByLimitId && Object.keys(limits.rateLimitsByLimitId).length > 0
    ? Object.entries(limits.rateLimitsByLimitId)
    : [[limits.rateLimits?.limitId ?? "codex", limits.rateLimits]];
  const windows = buckets.flatMap(([id, snapshot]) =>
    codexRateWindows(snapshot, snapshot?.limitName || id || "Codex"),
  );
  const defaultSnapshot = limits.rateLimits ?? buckets[0]?.[1] ?? {};
  const summary = usage.summary ?? {};
  const detailParts = [
    summary.lifetimeTokens == null ? null : `Lifetime tokens: ${summary.lifetimeTokens}`,
    summary.currentStreakDays == null ? null : `Current streak: ${summary.currentStreakDays} days`,
    limits.rateLimitResetCredits?.availableCount == null
      ? null
      : `Reset credits: ${limits.rateLimitResetCredits.availableCount}`,
  ].filter(Boolean);
  return {
    providerId: "",
    source: "codex-cli",
    plan: defaultSnapshot.planType ?? null,
    windows,
    creditsBalance: defaultSnapshot.credits?.hasCredits
      ? defaultSnapshot.credits?.balance ?? null
      : null,
    creditsUnlimited: Boolean(defaultSnapshot.credits?.unlimited),
    detail: detailParts.join(" · "),
    fetchedAt: Math.floor(Date.now() / 1000),
  };
}

const output = Writable.toWeb(process.stdout);
const input = Readable.toWeb(process.stdin);
if (option("usage") === "1") {
  try {
    const usage = await readUsage();
    process.stdout.write(`${JSON.stringify(usage)}\n`);
    codexPeer?.child?.kill();
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  }
} else if (option("catalog") === "1") {
  try {
    const catalog = await readCatalog(option("cwd", process.cwd()));
    process.stdout.write(`${JSON.stringify(catalog)}\n`);
    codexPeer?.child?.kill();
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  }
} else {
  const title = protocol === "codex-app-server"
    ? "Codex"
    : protocol === "claude-stream-json"
      ? "Claude Code"
      : protocol === "pi-json"
        ? "Pi Coding Agent"
        : command || protocol;
  acp.agent({ name: `glyphra-${protocol}-bridge` })
  .onRequest(acp.methods.agent.initialize, async () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: {
      loadSession: false,
      sessionCapabilities: protocol === "codex-app-server" ? { resume: {} } : {},
    },
    agentInfo: { name: `glyphra-${protocol}-bridge`, title, version: "0.1.0" },
    authMethods: [],
  }))
  .onRequest(acp.methods.agent.session.new, (ctx) => newSession(ctx.params))
  .onRequest(acp.methods.agent.session.resume, (ctx) => resumeSession(ctx.params))
  .onRequest(acp.methods.agent.authenticate, async () => ({}))
  .onRequest(acp.methods.agent.session.setMode, (ctx) => setMode(ctx.params))
  .onRequest(acp.methods.agent.session.setConfigOption, (ctx) => setConfigOption(ctx.params))
  .onRequest(acp.methods.agent.session.prompt, (ctx) => prompt(ctx.params, ctx.client))
  .onNotification(acp.methods.agent.session.cancel, (ctx) => cancel(ctx.params))
  .connect(acp.ndJsonStream(output, input));
}
