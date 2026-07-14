import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";

import { Server, ServerEnvironment } from "@spine-ts/server";
import { createZeroMqAdapterConfig, createZeroMqTransport } from "@spine-ts/transport/zeromq";

import { createTodoContext } from "@spine-ts/example-todo";

const ipcDirectory = requiredEnvironment("SPINE_TODO_MULTI_PROCESS_IPC_DIRECTORY");
const adapterIdentity = requiredEnvironment("SPINE_TODO_MULTI_PROCESS_ADAPTER_IDENTITY");
const requestTimeoutMs = positiveIntegerEnvironment("SPINE_TODO_MULTI_PROCESS_REQUEST_TIMEOUT_MS");
const injectedCloseFailures = closeFailureEnvironment();
const transport = createZeroMqTransport(
  createZeroMqAdapterConfig({ ipcDirectory, adapterIdentity }),
  { requestTimeoutMs, receiveTimeoutMs: 100, onBackgroundFailure: (error) => reportFailure("transport", error) },
);
const environment = ServerEnvironment.local({ transport, ownsTransport: false });
let running;
let stopping;

process.on("message", (message) => {
  if (isShutdownMessage(message)) {
    void shutdown();
  } else {
    void reportFailure("control", new Error("Received an invalid lifecycle control message."));
  }
});
process.once("disconnect", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});

try {
  running = await Server.atPort(0, { host: "127.0.0.1", environment })
    .add(await createTodoContext())
    .start();
  await sendControl(
    { type: "ready", pid: process.pid, host: running.host, port: running.port },
    "ready control",
  );
} catch (error) {
  await reportFailure("startup", error);
  await shutdown(1);
}

async function shutdown(exitCode = 0) {
  stopping ??= (async () => {
    const closeFailures = [];
    await captureClose("running server", async () => running?.close(), closeFailures);
    await captureClose("environment", async () => environment.close(), closeFailures);
    await captureClose("transport", async () => transport.close(), closeFailures);
    if (closeFailures.length > 0) {
      await reportFailure(
        "shutdown",
        new Error(closeFailures.map((failure) => failure.message).join("; ")),
      );
    }
    try {
      await sendControl({ type: "stopped" }, "stopped control");
    } catch {
      // The parent may already have disconnected; owned resource cleanup is complete.
    } finally {
      process.exitCode = closeFailures.length === 0 ? exitCode : 1;
      process.disconnect?.();
    }
  })();
  await stopping;
}

async function captureClose(label, close, failures) {
  try {
    await close();
    if (injectedCloseFailures.has(label)) {
      throw new Error(`Injected ${label} close failure.`);
    }
  } catch (error) {
    failures.push(new Error(`${label} close failed: ${safeMessage(error)}`));
  }
}

async function reportFailure(phase, error) {
  await sendControl(
    {
      type: "failure",
      phase,
      message: safeMessage(error),
    },
    `${phase} failure control`,
  ).catch(() => undefined);
}

async function sendControl(message, phase) {
  if (!process.send || !process.connected) {
    return;
  }
  await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      reject(new Error(`${phase} timed out after 1000ms.`));
    }, 1000);
    try {
      process.send(message, (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (error === null || error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
    } catch (error) {
      settled = true;
      clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must be set.`);
  }
  return value;
}

function positiveIntegerEnvironment(name) {
  const value = requiredEnvironment(name);
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`${name} must be a positive decimal integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a safe integer.`);
  }
  return parsed;
}

function closeFailureEnvironment() {
  const value = process.env.SPINE_TODO_MULTI_PROCESS_CLOSE_FAILURES?.trim();
  if (value === undefined || value.length === 0) {
    return new Set();
  }
  const allowed = new Set(["running server", "environment", "transport"]);
  const failures = value.split(",");
  for (const failure of failures) {
    if (!allowed.has(failure)) {
      throw new Error("SPINE_TODO_MULTI_PROCESS_CLOSE_FAILURES contains an unknown resource.");
    }
  }
  return new Set(failures);
}

function isShutdownMessage(message) {
  return (
    typeof message === "object" &&
    message !== null &&
    Object.keys(message).length === 1 &&
    message.type === "shutdown"
  );
}

function safeMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/[\r\n\t]+/gu, " ").slice(0, 240);
}
