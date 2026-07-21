#!/usr/bin/env node
/**
 * Windows fallback for `codex app-server daemon`, which is currently Unix-only.
 * A detached host keeps one app-server process warm; short-lived bridge proxies
 * connect over a local named pipe. JSON-RPC ids and thread notifications are
 * multiplexed so catalogs, usage probes, and live agent windows can coexist.
 */
import { spawn } from "node:child_process";
import net from "node:net";
import { createInterface } from "node:readline";

function option(name, fallback = "") {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const pipeName = option("pipe");
const command = option("command");
const commandArgs = JSON.parse(option("args", "[]"));
const serving = process.argv.includes("--serve");
const diagnosticPipe = `${pipeName}-stderr`;

if (!pipeName || !command) throw new Error("--pipe and --command are required");

if (!serving) {
  const connect = (path) =>
    new Promise((resolve, reject) => {
      const socket = net.createConnection(path);
      socket.once("connect", () => resolve(socket));
      socket.once("error", reject);
    });

  let socket;
  try {
    socket = await connect(pipeName);
  } catch {
    const host = spawn(
      process.execPath,
      [
        new URL(import.meta.url).pathname.replace(/^\/(.:\/)/, "$1"),
        "--serve",
        `--pipe=${pipeName}`,
        `--command=${command}`,
        `--args=${JSON.stringify(commandArgs)}`,
      ],
      { detached: true, stdio: "ignore", windowsHide: true },
    );
    host.unref();
    let lastError;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      try {
        socket = await connect(pipeName);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!socket) throw lastError ?? new Error("timed out starting Codex app-server host");
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const diagnostics = await connect(diagnosticPipe);
      diagnostics.pipe(process.stderr);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
  socket.once("close", () => process.exit(0));
  socket.once("error", (error) => {
    process.stderr.write(`[codex-daemon-proxy] ${error.message}\n`);
    process.exit(1);
  });
} else {
  let child = null;
  const clients = new Map();
  const diagnosticClients = new Set();
  const pendingRequests = new Map();
  const serverRequests = new Map();
  const threadOwners = new Map();
  let initializeResponse = null;
  const initializeWaiters = [];
  let initializedForwarded = false;
  let nextClientId = 1;
  let nextNativeId = 1;
  let idleTimer = null;
  const trace = (message) => {
    if (process.env.GLYPHRA_DAEMON_DEBUG !== "1") return;
    const line = `[codex-daemon-host] ${message}\n`;
    for (const diagnostics of diagnosticClients) diagnostics.write(line);
  };

  const write = (socket, message) => {
    if (socket && !socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
  };

  const ownerFor = (message) => {
    const threadId = message.params?.threadId ?? message.params?.thread?.id;
    return threadId ? threadOwners.get(threadId) : null;
  };

  const armIdleTimer = () => {
    clearTimeout(idleTimer);
    if (clients.size > 0) return;
    idleTimer = setTimeout(() => {
      child?.kill();
      process.exit(0);
    }, 15 * 60_000);
    idleTimer.unref();
  };

  const attachClient = (socket) => {
    const clientId = nextClientId++;
    clients.set(clientId, socket);
    clearTimeout(idleTimer);
    trace(`proxy ${clientId} connected`);
    const lines = createInterface({ input: socket });
    lines.on("line", (line) => {
      let message;
      try { message = JSON.parse(line); } catch {
        trace(`proxy ${clientId} -> native non-json`);
        return;
      }
      trace(`proxy ${clientId} -> native ${message.method ?? `response:${message.id}`}`);

      if (!message.method && message.id != null && ("result" in message || "error" in message)) {
        const key = `${clientId}:${String(message.id)}`;
        const nativeId = serverRequests.get(key);
        if (nativeId != null) {
          serverRequests.delete(key);
          child?.stdin.write(`${JSON.stringify({ ...message, id: nativeId })}\n`);
        }
        return;
      }
      if (message.method === "initialize" && message.id != null) {
        if (initializeResponse) {
          write(socket, { id: message.id, ...initializeResponse });
        } else {
          initializeWaiters.push({ socket, id: message.id });
          if (initializeWaiters.length === 1) {
            child?.stdin.write(`${JSON.stringify({ ...message, id: "__glyphra_initialize__" })}\n`);
          }
        }
        return;
      }
      if (message.method === "initialized" && initializedForwarded) return;
      if (message.method === "initialized") initializedForwarded = true;
      if (message.id != null && message.method) {
        const nativeId = `glyphra:${clientId}:${nextNativeId++}`;
        pendingRequests.set(nativeId, {
          clientId,
          originalId: message.id,
          method: message.method,
          params: message.params,
        });
        if (message.params?.threadId) threadOwners.set(message.params.threadId, clientId);
        child?.stdin.write(`${JSON.stringify({ ...message, id: nativeId })}\n`);
      } else {
        child?.stdin.write(`${line}\n`);
      }
    });
    socket.once("close", () => {
      lines.close();
      clients.delete(clientId);
      for (const [key, request] of pendingRequests) {
        if (request.clientId === clientId) pendingRequests.delete(key);
      }
      for (const key of serverRequests.keys()) {
        if (key.startsWith(`${clientId}:`)) serverRequests.delete(key);
      }
      trace(`proxy ${clientId} disconnected`);
      armIdleTimer();
    });
    socket.once("error", () => undefined);
  };

  const server = net.createServer((socket) => {
    attachClient(socket);
  });
  const diagnosticServer = net.createServer((socket) => {
    diagnosticClients.add(socket);
    socket.once("close", () => {
      diagnosticClients.delete(socket);
    });
  });

  const shutdown = (code = 0) => {
    for (const socket of clients.values()) socket.destroy();
    for (const diagnostics of diagnosticClients) diagnostics.destroy();
    server.close();
    diagnosticServer.close();
    child?.kill();
    process.exit(code);
  };

  server.once("error", (error) => {
    if (error.code === "EADDRINUSE") process.exit(0);
    shutdown(1);
  });
  diagnosticServer.once("error", () => undefined);
  process.once("SIGTERM", () => shutdown(0));
  process.once("SIGINT", () => shutdown(0));

  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
    server.listen(pipeName);
  });
  diagnosticServer.listen(diagnosticPipe);

  child = spawn(command, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch {
      trace("native -> client non-json");
      for (const socket of clients.values()) socket.write(`${line}\n`);
      return;
    }
    trace(`native -> client ${message.method ?? `response:${message.id}`}`);
    if (String(message.id) === "__glyphra_initialize__" && ("result" in message || "error" in message)) {
      initializeResponse = "result" in message
        ? { result: message.result }
        : { error: message.error };
      for (const waiter of initializeWaiters.splice(0)) {
        write(waiter.socket, { id: waiter.id, ...initializeResponse });
      }
      return;
    }
    if (!message.method && message.id != null && ("result" in message || "error" in message)) {
      const request = pendingRequests.get(String(message.id));
      if (!request) return;
      pendingRequests.delete(String(message.id));
      const socket = clients.get(request.clientId);
      if (request.method === "thread/start" && message.result?.thread?.id) {
        threadOwners.set(message.result.thread.id, request.clientId);
      }
      write(socket, { ...message, id: request.originalId });
      return;
    }
    if (message.method && message.id != null) {
      const clientId = ownerFor(message) ?? clients.keys().next().value;
      const socket = clients.get(clientId);
      if (!socket) return;
      const visibleId = `server:${String(message.id)}`;
      serverRequests.set(`${clientId}:${visibleId}`, message.id);
      write(socket, { ...message, id: visibleId });
      return;
    }
    const clientId = ownerFor(message);
    if (clientId) {
      write(clients.get(clientId), message);
    } else {
      for (const socket of clients.values()) write(socket, message);
    }
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    for (const diagnostics of diagnosticClients) diagnostics.write(text);
  });
  child.once("error", () => shutdown(1));
  child.once("exit", (code) => shutdown(code ?? 1));
  armIdleTimer();
}
