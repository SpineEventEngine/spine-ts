/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { fork, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import process from "node:process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const childPath = fileURLToPath(new URL("./server-integration-broker-child.mjs", import.meta.url));
const phaseTimeoutMs = 5_000;
const execFileAsync = promisify(execFile);
const adapterIdentity = "wave13-cross-process";
const ipcTemporaryRoot = process.platform === "darwin" ? "/tmp" : tmpdir();

type Role = "consumer" | "producer";
interface Ready {
  readonly contextName: string;
  readonly pid: number;
  readonly role: Role;
  readonly type: "ready";
}
interface Delivered {
  readonly actorId: string;
  readonly eventId: string;
  readonly external: boolean;
  readonly origin: "importContext";
  readonly payload: string;
  readonly producerId: string;
  readonly role: "consumer";
  readonly tenantId: undefined;
  readonly type: "delivered";
  readonly typeUrl: "type.spine.io/spine.net.EmailAddress";
}
interface ProbeDelivered {
  readonly role: "consumer";
  readonly type: "probe-delivered";
}
interface Failure {
  readonly reason: string;
  readonly role: Role;
  readonly type: "failure";
}
interface Stopped {
  readonly role: Role;
  readonly type: "stopped";
}
type ChildMessage = Ready | Delivered | ProbeDelivered | Failure | Stopped;

describe("Wave 13 IntegrationBroker across normal Node applications", () => {
  // prettier-ignore
  it(
    "RED-22 delivers a domestic Event across two configured application processes without a forwarding shortcut",
    async () => {
    const fixtureSource = await readFile(childPath, "utf8");
    expect(fixtureSource).toContain("createZeroMqTransportFactory");
    expect(fixtureSource).toContain("ZeroMqConfig.create");
    expect(fixtureSource).toContain("withGeneratedRegistryRoot");
    expect(fixtureSource).toContain("version: 3");
    expect(fixtureSource).toContain(".add(Wave13ExternalProjection)");
    expect(fixtureSource).not.toContain("Repository");
    for (const forbiddenShortcut of [
      "ExternalMessage",
      "ContextTransport",
      "RuntimeTransportBinding",
      "SignalTransport",
      "forwarder",
      "externalEventSchemas",
      "addEventDispatcher",
    ]) {
      expect(fixtureSource).not.toMatch(new RegExp(forbiddenShortcut, "iu"));
    }
    await expect(execFileAsync(process.execPath, ["--check", childPath])).resolves.toBeDefined();

    const ipcDirectory = await mkdtemp(join(ipcTemporaryRoot, "w13-"));
    const producer = start("producer", ipcDirectory);
    const consumer = start("consumer", ipcDirectory);
    let cleanupFailure: AggregateError | undefined;
    try {
      const [producerReady, consumerReady] = await Promise.all([
        awaitMessage<Ready>(producer, "ready"),
        awaitMessage<Ready>(consumer, "ready"),
      ]);
      expect(producerReady.pid).not.toBe(consumerReady.pid);
      expect(producerReady.contextName).not.toBe(consumerReady.contextName);

      await establishExternalDelivery(producer, consumer);
      producer.send({ type: "publish-domestic-event" });
      const delivered = await awaitMessage<Delivered>(consumer, "delivered");
      expect(delivered).toEqual({
        type: "delivered",
        role: "consumer",
        eventId: "wave13-cross-process-event",
        typeUrl: "type.spine.io/spine.net.EmailAddress",
        producerId: "Wave13Producer",
        payload: "full-event-payload",
        origin: "importContext",
        actorId: "Wave13Actor",
        tenantId: undefined,
        external: true,
      });
    } finally {
      const failures: unknown[] = [];
      try {
        const shutdown = await Promise.allSettled([stop(producer), stop(consumer)]);
        for (const result of shutdown) {
          if (result.status === "rejected") failures.push(result.reason);
        }
        try {
          expect(await adapterArtifacts(ipcDirectory)).toEqual([]);
        } catch (error) {
          failures.push(error);
        }
      } finally {
        await rm(ipcDirectory, { recursive: true, force: true });
      }
      if (failures.length > 0)
        cleanupFailure = new AggregateError(failures, "Wave 13 child-process cleanup failed.");
    }
    if (cleanupFailure !== undefined) throw cleanupFailure;
  });
});

async function establishExternalDelivery(
  producer: ChildProcess,
  consumer: ChildProcess,
): Promise<void> {
  const delivered = awaitMessage<ProbeDelivered>(consumer, "probe-delivered");
  const publish = () => {
    if (producer.connected) producer.send({ type: "publish-readiness-probe" });
  };
  publish();
  const retry = setInterval(publish, 50);
  try {
    await delivered;
  } finally {
    clearInterval(retry);
  }
}

function start(role: Role, ipcDirectory: string): ChildProcess {
  return fork(childPath, [], {
    env: {
      ...process.env,
      SPINE_WAVE13_IPC_DIRECTORY: ipcDirectory,
      SPINE_WAVE13_ROLE: role,
      SPINE_WAVE13_ADAPTER_IDENTITY: adapterIdentity,
    },
    silent: true,
  });
}

async function adapterArtifacts(directory: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(directory, { recursive: true });
    return (
      await Promise.all(
        entries.map(async (entry) =>
          (await stat(join(directory, entry))).isDirectory() ? undefined : entry,
        ),
      )
    ).flatMap((entry) => (entry === undefined ? [] : [entry]));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function awaitMessage<T extends ChildMessage>(
  child: ChildProcess,
  expected: T["type"],
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${expected}.`));
    }, phaseTimeoutMs);
    child.on("message", (message: ChildMessage) => {
      if (message.type === "failure") {
        clearTimeout(timeout);
        reject(new Error(`${message.role} fixture failed: ${message.reason}`));
      }
      if (message.type === expected) {
        clearTimeout(timeout);
        resolve(message as T);
      }
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`Child exited before ${expected}: ${String(code)}/${String(signal)}.`));
    });
  });
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<{
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }>((resolve) =>
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    }),
  );
  child.send({ type: "shutdown" });
  const terminate = setTimeout(() => child.kill("SIGTERM"), 1_000);
  const force = setTimeout(() => child.kill("SIGKILL"), 2_000);
  let rejectForcedExit: NodeJS.Timeout | undefined;
  const exit = await Promise.race([
    exited,
    new Promise<never>(
      (_, reject) =>
        (rejectForcedExit = setTimeout(() => {
          reject(new Error("Child did not exit after SIGKILL."));
        }, 3_000)),
    ),
  ]);
  clearTimeout(terminate);
  clearTimeout(force);
  clearTimeout(rejectForcedExit);
  expect(exit, "application fixture must close its broker and transport cleanly").toEqual({
    code: 0,
    signal: null,
  });
}
