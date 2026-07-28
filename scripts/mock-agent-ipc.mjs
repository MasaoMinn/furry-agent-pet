#!/usr/bin/env node

import net from "node:net";

const DEFAULT_ADDRESS = String.raw`\\.\pipe\furry-companion-mcp`;

const DEMO_EVENTS = [
  {
    type: "state",
    state: "thinking",
    session_title: "IPC 演示会话",
    message: "正在理解任务和收集上下文。",
  },
  {
    type: "state",
    state: "planning",
    session_title: "IPC 演示会话",
    message: "正在整理实现步骤。",
  },
  {
    type: "state",
    state: "coding",
    session_title: "IPC 演示会话",
    message: "正在编写桌宠状态渲染逻辑。",
    file: "src/state-renderer.ts",
  },
  {
    type: "state",
    state: "testing",
    session_title: "IPC 演示会话",
    message: "正在运行本地构建与交互检查。",
    file: "src/state-renderer.test.ts",
  },
  {
    type: "state",
    state: "error",
    session_title: "IPC 演示会话",
    message: "演示一个需要用户确认的错误状态。",
  },
  {
    type: "state",
    state: "success",
    session_title: "IPC 演示会话",
    message: "桌宠的状态演示已经完成，现在可以查看任务结束气泡了。",
    file: "src/state-renderer.ts",
  },
];

function printHelp() {
  console.log(`Usage: node scripts/mock-agent-ipc.mjs [options]

Options:
  --address <path>  Override the Windows named pipe address.
  --demo            Send thinking -> planning -> coding -> testing -> error -> success.
  --protocol-test   Send fragmented, combined, blank, CRLF, and invalid input.
  --client-delay <milliseconds>
                    Delay protocol/demo events for CDP harness attachment (default: 0).
  --help            Show this help.

The server stays running until Ctrl+C.`);
}

function parseArguments(arguments_) {
  const options = {
    address: DEFAULT_ADDRESS,
    demo: false,
    protocolTest: false,
    clientDelay: 0,
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];

    if (argument === "--help" || argument === "-h") {
      printHelp();
      process.exit(0);
    }

    if (argument === "--demo") {
      options.demo = true;
      continue;
    }

    if (argument === "--protocol-test") {
      options.protocolTest = true;
      continue;
    }

    if (argument === "--address") {
      const address = arguments_[index + 1];
      if (!address || address.startsWith("--")) {
        throw new Error("--address requires a non-empty value");
      }
      options.address = address;
      index += 1;
      continue;
    }

    if (argument === "--client-delay") {
      const value = Number(arguments_[index + 1]);
      if (!Number.isInteger(value) || value < 0 || value > 30_000) {
        throw new Error("--client-delay requires an integer from 0 to 30000");
      }
      options.clientDelay = value;
      index += 1;
      continue;
    }

    if (argument.startsWith("--address=")) {
      const address = argument.slice("--address=".length);
      if (!address) {
        throw new Error("--address requires a non-empty value");
      }
      options.address = address;
      continue;
    }

    throw new Error(`unknown option: ${argument}`);
  }

  return options;
}

function toJsonLine(event) {
  return `${JSON.stringify(event)}\n`;
}

let options;
try {
  options = parseArguments(process.argv.slice(2));
} catch (error) {
  console.error(`ERROR ${error.message}`);
  process.exit(1);
}

const clients = new Map();
let isReady = false;
let isShuttingDown = false;
let clientSequence = 0;

function queueWrite(socket, delayMilliseconds, payload) {
  const timers = clients.get(socket);
  if (!timers) {
    return;
  }

  const timer = setTimeout(() => {
    timers.delete(timer);
    if (!socket.destroyed && socket.writable) {
      socket.write(payload);
    }
  }, delayMilliseconds);

  timers.add(timer);
}

function queueProtocolTest(socket, startAt = 0) {
  const fragmentedEvent = toJsonLine({
    type: "state",
    state: "thinking",
    message: "这条事件被拆成两个数据块发送。",
  });
  const splitAt = Math.floor(fragmentedEvent.length / 2);

  queueWrite(socket, startAt + 150, fragmentedEvent.slice(0, splitAt));
  queueWrite(socket, startAt + 300, fragmentedEvent.slice(splitAt));

  const combinedEvents =
    toJsonLine({
      type: "state",
      state: "planning",
      message: "这条事件与下一条事件粘包发送。",
    }) +
    toJsonLine({
      type: "state",
      state: "coding",
      message: "粘包中的第二条合法事件。",
      file: "src/main.ts",
    });
  queueWrite(socket, startAt + 450, combinedEvents);

  queueWrite(socket, startAt + 600, "\n\r\n");
  queueWrite(
    socket,
    startAt + 750,
    `${JSON.stringify({
      type: "state",
      state: "testing",
      message: "这条合法事件使用 CRLF 结尾。",
    })}\r\n`,
  );
  queueWrite(socket, startAt + 900, '{"type":"state","state":broken json}\n');
  queueWrite(
    socket,
    startAt + 1050,
    toJsonLine({
      type: "state",
      state: "teleporting",
      message: "这是用于校验的未知状态。",
    }),
  );
  queueWrite(
    socket,
    startAt + 1200,
    toJsonLine({
      type: "state",
      state: "success",
      message: "协议异常输入测试完成，后续合法事件仍能正常发送。",
      file: "scripts/mock-agent-ipc.mjs",
    }),
  );

  return startAt + 1350;
}

function queueDemo(socket, startAt = 150) {
  DEMO_EVENTS.forEach((event, index) => {
    queueWrite(socket, startAt + index * 750, toJsonLine(event));
  });
}

const server = net.createServer((socket) => {
  const clientId = ++clientSequence;
  clients.set(socket, new Set());
  socket.setNoDelay(true);
  console.log(`CLIENT_CONNECTED ${clientId}`);

  socket.on("error", (error) => {
    if (!isShuttingDown) {
      console.error(`CLIENT_ERROR ${error.message}`);
    }
  });

  socket.on("close", () => {
    const timers = clients.get(socket);
    if (timers) {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    }
    clients.delete(socket);
    console.log(`CLIENT_CLOSED ${clientId}`);
  });

  socket.write(toJsonLine({ type: "state", state: "idle" }));

  const demoStart = options.protocolTest
    ? queueProtocolTest(socket, options.clientDelay)
    : options.clientDelay + 150;
  if (options.demo) {
    queueDemo(socket, demoStart);
  }
});

server.on("error", (error) => {
  console.error(`ERROR ${error.message}`);
  if (!isReady) {
    process.exitCode = 1;
  }
});

server.listen(options.address, () => {
  isReady = true;
  console.log(`READY ${options.address}`);
});

function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.error(`SHUTDOWN ${signal}`);

  for (const [socket, timers] of clients) {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    socket.end();
  }

  const forceCloseTimer = setTimeout(() => {
    for (const socket of clients.keys()) {
      socket.destroy();
    }
  }, 1000);
  forceCloseTimer.unref();

  server.close((error) => {
    clearTimeout(forceCloseTimer);
    if (error) {
      console.error(`ERROR ${error.message}`);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
