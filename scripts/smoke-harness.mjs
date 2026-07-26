#!/usr/bin/env node
/** Read-only handshake smoke for a native harness or the normalization bridge. */
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { PROTOCOL_VERSION, client, methods, ndJsonStream } from "@agentclientprotocol/sdk";

function option(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const protocol = option("protocol", "acp");
const command = option("command");
const repeatedArgs = process.argv
  .filter((value) => value.startsWith("--arg="))
  .map((value) => value.slice("--arg=".length));
const args = repeatedArgs.length > 0 ? repeatedArgs : JSON.parse(option("args", "[]"));
const cwd = option("cwd", process.cwd());
const promptText = option("prompt");
const firstPromptText = option("first-prompt");
const model = option("model");
const reasoningEffort = option("reasoning-effort");
const contextWindow = option("context-window");
const fastMode = option("fast-mode") === "1";
const prewarmedSessionId = option("prewarmed-session-id");
const approvalReviewer = option("approval-reviewer");
const mode = option("mode", "read-only");
const switchModel = option("switch-model");
const switchReasoningEffort = option("switch-reasoning-effort");
const switchFastMode = option("switch-fast-mode");
const holdMs = Number(option("hold-ms", "0")) || 0;
const mcpStdioCommand = option("mcp-stdio-command");
const mcpServers = mcpStdioCommand
  ? [{
      name: option("mcp-name", "smoke-mcp"),
      command: mcpStdioCommand,
      args: [],
      env: [],
    }]
  : [];
if (!command) throw new Error("--command is required");

const bridge = new URL("./harness-bridge.mjs", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1");
const program = protocol === "acp" ? command : process.execPath;
const programArgs = protocol === "acp"
  ? args
  : [
      bridge,
      `--protocol=${protocol}`,
      `--command=${command}`,
      `--args=${JSON.stringify(args)}`,
      ...(model ? [`--model=${model}`] : []),
      ...(reasoningEffort ? [`--reasoning-effort=${reasoningEffort}`] : []),
      ...(contextWindow ? [`--context-window=${contextWindow}`] : []),
      ...(fastMode ? ["--fast-mode=1"] : []),
      ...(prewarmedSessionId ? [`--prewarmed-session-id=${prewarmedSessionId}`] : []),
      ...(approvalReviewer ? [`--approval-reviewer=${approvalReviewer}`] : []),
    ];
const child = spawn(program, programArgs, {
  cwd,
  env: { ...process.env, INITIAL_AGENT_MODE: mode },
  stdio: ["pipe", "pipe", "pipe"],
  shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(program),
});
let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
  if (process.env.GLYPHRA_SMOKE_DEBUG === "1") process.stderr.write(chunk);
});

const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
let latestContextUsage = null;
let availableCommands = [];
let latestCost = null;
const connection = client({ name: "glyphra-smoke" })
  .onNotification(methods.client.session.update, (ctx) => {
    if (ctx.params.update.sessionUpdate === "usage_update") {
      latestContextUsage = {
        used: ctx.params.update.used,
        size: ctx.params.update.size,
      };
      latestCost = ctx.params.update.cost ?? latestCost;
    } else if (ctx.params.update.sessionUpdate === "available_commands_update") {
      availableCommands = ctx.params.update.availableCommands.map((command) => command.name);
    }
  })
  .connect(stream);
const timer = setTimeout(() => child.kill(), 60_000);
try {
  const initialized = await connection.agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
      session: { configOptions: {} },
    },
    clientInfo: { name: "glyphra-smoke", title: "Glyphra harness smoke", version: "0.1.0" },
  });
  const session = await connection.agent
    .buildSession({ cwd, mcpServers })
    .start();
  const runPrompt = async (text) => {
    let reply = "";
    let contextUsage = null;
    const promptPromise = session.prompt(text);
    for (;;) {
      const message = await session.nextUpdate();
      if (message.kind === "stop") {
        await promptPromise;
        const context = message.response._meta?.glyphraContext;
        return {
          stopReason: message.stopReason,
          reply: reply || null,
          contextUsage: contextUsage ?? latestContextUsage ?? (
            context?.size > 0 ? { used: context.used, size: context.size } : null
          ),
          usage: message.response.usage ?? null,
          cost: latestCost,
        };
      }
      if (
        message.update.sessionUpdate === "agent_message_chunk" &&
        message.update.content.type === "text"
      ) {
        reply += message.update.content.text;
      } else if (message.update.sessionUpdate === "usage_update") {
        contextUsage = { used: message.update.used, size: message.update.size };
      }
    }
  };
  const firstTurn = firstPromptText ? await runPrompt(firstPromptText) : null;
  const configUpdates = [];
  if (switchModel) {
    await connection.agent.request(methods.agent.session.setConfigOption, {
      sessionId: session.sessionId,
      configId: "model",
      value: switchModel,
    });
    configUpdates.push(`model=${switchModel}`);
  }
  if (switchReasoningEffort) {
    await connection.agent.request(methods.agent.session.setConfigOption, {
      sessionId: session.sessionId,
      configId: "reasoning_effort",
      value: switchReasoningEffort,
    });
    configUpdates.push(`effort=${switchReasoningEffort}`);
  }
  if (switchFastMode) {
    const enabled = ["1", "true", "on"].includes(switchFastMode.toLowerCase());
    await connection.agent.request(methods.agent.session.setConfigOption, {
      sessionId: session.sessionId,
      configId: "fast_mode",
      type: "boolean",
      value: enabled,
    });
    configUpdates.push(`fast=${enabled}`);
  }
  const finalTurn = promptText ? await runPrompt(promptText) : null;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    protocol,
    agent: initialized.agentInfo?.title ?? initialized.agentInfo?.name ?? null,
    sessionId: session.sessionId,
    firstTurn,
    stopReason: finalTurn?.stopReason ?? null,
    reply: finalTurn?.reply ?? null,
    contextUsage: finalTurn?.contextUsage ?? null,
    usage: finalTurn?.usage ?? null,
    cost: finalTurn?.cost ?? null,
    availableCommands,
    mcpServerCount: mcpServers.length,
    configUpdates,
  })}\n`);
  if (holdMs > 0) await new Promise((resolve) => setTimeout(resolve, holdMs));
  session.dispose();
  connection.close();
} catch (error) {
  process.stderr.write(`${error?.stack ?? error}\n${stderr}`);
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  child.kill();
}

child.once("exit", (code) => {
  if (code && stderr) process.stderr.write(stderr);
});
