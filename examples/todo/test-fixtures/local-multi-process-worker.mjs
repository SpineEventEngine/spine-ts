import process from "node:process";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";

import { EnvironmentType, Server, ServerEnvironment } from "@spine-event-engine/server";
import { createZeroMqTransport, ZeroMqConfig } from "@spine-event-engine/transport/zeromq";

import { createTodoContext } from "@spine-event-engine/example-todo";

const ipcDirectory = requiredEnvironment("SPINE_TODO_MULTI_PROCESS_IPC_DIRECTORY");
const adapterIdentity = requiredEnvironment("SPINE_TODO_MULTI_PROCESS_ADAPTER_IDENTITY");
const controlTimeoutMs = positiveIntegerEnvironment("SPINE_TODO_MULTI_PROCESS_CONTROL_TIMEOUT_MS");
const requestTimeoutMs = positiveIntegerEnvironment("SPINE_TODO_MULTI_PROCESS_REQUEST_TIMEOUT_MS");
const receiveTimeoutMs = positiveIntegerEnvironment("SPINE_TODO_MULTI_PROCESS_RECEIVE_TIMEOUT_MS");
const workerMode = workerModeEnvironment();
const injectedCloseFailures = closeFailureEnvironment();
const startupGate = createGate();
const baseTransport = createZeroMqTransport(
  ZeroMqConfig.create({ ipcDirectory, adapterIdentity }),
  { requestTimeoutMs, receiveTimeoutMs },
);
const transport =
  workerMode === "pending-startup"
    ? pendingStartupTransport(baseTransport, startupGate)
    : baseTransport;
ServerEnvironment.when(EnvironmentType.Local).use({ transport });
let running;
let stopping;
let stopRequested = false;
let startup;

process.on("message", (message) => {
  if (isShutdownMessage(message)) {
    if (workerMode !== "ignore-stop") {
      void shutdown();
    }
  } else {
    void reportFailure("control", new Error("Received an invalid lifecycle control message."));
  }
});
process.once("disconnect", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  if (workerMode !== "ignore-stop") {
    void shutdown();
  }
});

startup = startServer();
try {
  running = await startup;
  if (stopRequested) {
    await shutdown();
  } else if (workerMode !== "no-ready") {
    await sendControl(
      { type: "ready", pid: process.pid, host: running.host, port: running.port },
      "ready control",
    );
    if (workerMode === "exit-after-ready") {
      await new Promise((resolve) => setTimeout(resolve, 100));
      process.exit(23);
    }
  }
} catch (error) {
  if (!stopRequested) {
    await reportFailure("startup", error);
  }
  await shutdown(1);
}

async function startServer() {
  return await Server.atPort(0, { host: "127.0.0.1" })
    .add(await createTodoContext())
    .start();
}

async function shutdown(exitCode = 0) {
  stopRequested = true;
  startupGate.release();
  stopping ??= (async () => {
    const closeFailures = [];
    try {
      running ??= await startup;
    } catch (error) {
      closeFailures.push(new Error(`startup rollback failed: ${safeMessage(error)}`));
    }
    await captureClose("running server", async () => running?.close(), closeFailures);
    await captureClose(
      "environment",
      async () => ServerEnvironment.instance().close(),
      closeFailures,
    );
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

async function captureClose(label, onClose, failures) {
  try {
    await onClose();
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
      reject(new Error(`${phase} timed out after ${String(controlTimeoutMs)}ms.`));
    }, controlTimeoutMs);
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

function pendingStartupTransport(delegate, gate) {
  let pending = true;
  return {
    publish: (operation) => delegate.publish(operation),
    subscribe: (subscription, onHandler) => delegate.subscribe(subscription, onHandler),
    request: (operation) => delegate.request(operation),
    async respond(subscription, onHandler) {
      if (pending) {
        pending = false;
        const marker = path.join(ipcDirectory, "startup-pending");
        await writeFile(marker, "pending", "utf8");
        try {
          await gate.wait;
        } finally {
          await rm(marker, { force: true });
        }
      }
      return await delegate.respond(subscription, onHandler);
    },
    close: () => delegate.close(),
  };
}

function createGate() {
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  return {
    wait,
    release() {
      release();
    },
  };
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

function workerModeEnvironment() {
  const value = requiredEnvironment("SPINE_TODO_MULTI_PROCESS_WORKER_MODE");
  const allowed = new Set([
    "default",
    "exit-after-ready",
    "ignore-stop",
    "no-ready",
    "pending-startup",
  ]);
  if (!allowed.has(value)) {
    throw new Error("SPINE_TODO_MULTI_PROCESS_WORKER_MODE has an unknown value.");
  }
  return value;
}

function closeFailureEnvironment() {
  const value = process.env.SPINE_TODO_MULTI_PROCESS_CLOSE_FAILURES?.trim();
  if (value === undefined || value.length === 0) {
    return new Set();
  }
  const allowed = new Set(["running server", "environment"]);
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
