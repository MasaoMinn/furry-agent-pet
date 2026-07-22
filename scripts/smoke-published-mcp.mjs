#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const TIMEOUT_MS = 8_000;

function parseRuntimePath(arguments_) {
  const runtimeIndex = arguments_.indexOf("--runtime");
  const runtimePath = runtimeIndex >= 0 ? arguments_[runtimeIndex + 1] : undefined;
  if (!runtimePath || runtimePath.startsWith("--")) {
    throw new Error("Usage: node scripts/smoke-published-mcp.mjs --runtime <dist/index.js>");
  }

  const resolved = path.resolve(runtimePath);
  if (!existsSync(resolved)) {
    throw new Error(`Published MCP runtime was not found: ${resolved}`);
  }
  return resolved;
}

function withTimeout(promise, label, timeoutMs = TIMEOUT_MS) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function createJsonLineReader(stream, onMessage) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        onMessage(JSON.parse(trimmed));
      }
    }
  });
}

function connectToIpc(ipcPath) {
  return withTimeout(
    new Promise((resolve, reject) => {
      const socket = net.createConnection(ipcPath);
      socket.once("connect", () => resolve(socket));
      socket.once("error", reject);
    }),
    "the published runtime IPC bridge",
  );
}

function waitForExit(child) {
  if (child.exitCode !== null) {
    return Promise.resolve(child.exitCode);
  }
  return new Promise((resolve) => child.once("exit", resolve));
}

const runtimePath = parseRuntimePath(process.argv.slice(2));
const suffix = `${process.pid}-${Date.now()}`;
const ipcPath =
  process.platform === "win32"
    ? `\\\\.\\pipe\\furry-agent-pet-runtime-smoke-${suffix}`
    : path.join(os.tmpdir(), `furry-agent-pet-runtime-smoke-${suffix}.sock`);

const child = spawn(process.execPath, [runtimePath], {
  cwd: path.dirname(runtimePath),
  env: { ...process.env, FURRY_COMPANION_IPC_PATH: ipcPath },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr = `${stderr}${chunk}`.slice(-8_192);
});

let requestId = 0;
const pendingRequests = new Map();
createJsonLineReader(child.stdout, (message) => {
  if (!("id" in message)) {
    return;
  }
  const pending = pendingRequests.get(message.id);
  if (!pending) {
    return;
  }
  pendingRequests.delete(message.id);
  if (message.error) {
    pending.reject(new Error(`MCP error ${message.error.code}: ${message.error.message}`));
  } else {
    pending.resolve(message.result);
  }
});

function sendNotification(method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

function sendRequest(method, params) {
  const id = ++requestId;
  const response = new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return withTimeout(response, `MCP response for ${method}`);
}

let socket;
try {
  const initializeResult = await sendRequest("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
      clientInfo: { name: "furry-agent-pet-smoke", version: "0.1.0" },
  });
  if (initializeResult?.serverInfo?.name !== "furry-companion-mcp") {
    throw new Error("Unexpected MCP server identity");
  }
  sendNotification("notifications/initialized");

  const tools = await sendRequest("tools/list", {});
  if (!tools?.tools?.some((tool) => tool.name === "set_state")) {
    throw new Error("Published MCP runtime does not expose set_state");
  }

  socket = await connectToIpc(ipcPath);
  const events = [];
  const eventWaiters = [];
  createJsonLineReader(socket, (event) => {
    events.push(event);
    for (const waiter of eventWaiters.splice(0)) {
      waiter();
    }
  });

  async function waitForState(state) {
    await withTimeout(
      new Promise((resolve) => {
        const check = () => {
          if (events.some((event) => event.type === "state" && event.state === state)) {
            resolve();
          } else {
            eventWaiters.push(check);
          }
        };
        check();
      }),
      `IPC state ${state}`,
    );
    return events.findLast((event) => event.type === "state" && event.state === state);
  }

  await waitForState("idle");
  const codingMessage = "Published runtime MCP-to-IPC smoke test";
  const codingResult = await sendRequest("tools/call", {
    name: "set_state",
    arguments: {
      state: "coding",
      message: codingMessage,
      file: "scripts/smoke-published-mcp.mjs",
    },
  });
  if (codingResult?.isError) {
    throw new Error("set_state returned an MCP tool error");
  }
  const codingEvent = await waitForState("coding");
  if (codingEvent.message !== codingMessage) {
    throw new Error("IPC coding event did not preserve its message");
  }

  const successMessage = "Published furry-companion-mcp bridge is compatible.";
  await sendRequest("tools/call", {
    name: "set_state",
    arguments: { state: "success", message: successMessage },
  });
  const successEvent = await waitForState("success");
  if (successEvent.message !== successMessage) {
    throw new Error("IPC success event did not preserve its completion message");
  }

  console.log(
    `PASS furry-companion-mcp ${initializeResult.serverInfo.version}: initialize -> set_state -> ${ipcPath}`,
  );
} catch (error) {
  const detail = stderr.trim() ? `\nRuntime stderr:\n${stderr.trim()}` : "";
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}${detail}`);
  process.exitCode = 1;
} finally {
  socket?.destroy();
  child.stdin.end();
  try {
    await withTimeout(waitForExit(child), "the published runtime to exit", 3_000);
  } catch {
    child.kill();
    await withTimeout(waitForExit(child), "the published runtime to terminate", 3_000).catch(
      () => undefined,
    );
  }
}
