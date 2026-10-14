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

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import { expect, test } from "vitest";

const driver = new URL("../test-fixtures/project-subscription-transport.mjs", import.meta.url);

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`);
  return value;
}

async function runTransport(args: string[]): Promise<string> {
  const child = spawn(process.execPath, [driver.pathname, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.pid === undefined) throw new Error("Transport fixture did not start.");
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  const deadline = { expired: false };
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const timeout = setTimeout(() => {
    deadline.expired = true;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  }, 40_000);
  let reapTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => {
          resolve({ code, signal });
        });
      },
    );
    const exit = await Promise.race([
      exited,
      new Promise<undefined>((resolve) => {
        reapTimer = setTimeout(() => {
          resolve(undefined);
        }, 47_000);
      }),
    ]);
    const resourceLine = /TRANSPORT_RESOURCE (\{[^\n]+\})/u.exec(stdout)?.[1];
    const resource =
      resourceLine === undefined
        ? undefined
        : (JSON.parse(resourceLine) as { evidencePath: string });
    const cleanup =
      resource === undefined
        ? "resource identity unavailable"
        : await readFile(`${resource.evidencePath}/cleanup.json`, "utf8").catch(
            () => "cleanup unverified",
          );
    if (exit?.code !== 0 || deadline.expired) {
      throw new Error(
        `Transport fixture ${String(child.pid)} exited ${String(exit?.code)}/${String(exit?.signal)}; ` +
          `timedOut=${String(deadline.expired)}; resource=${resourceLine ?? "unavailable"}; ` +
          `cleanup=${cleanup}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      );
    }
    const report = JSON.parse(cleanup) as {
      databaseDropped: boolean;
      remainingSessions: number;
      errors: string[];
    };
    expect(report).toEqual({ databaseDropped: true, remainingSessions: 0, errors: [] });
    return stdout;
  } finally {
    clearTimeout(timeout);
    clearTimeout(killTimer);
    clearTimeout(reapTimer);
  }
}

test("real SQL and selected transport preserve subscription readiness and exact updates", async () => {
  const provider = required("SPINE_TS_TRANSPORT_PROVIDER");
  const protocol = required("SPINE_TS_TRANSPORT_PROTOCOL");
  const scenario = required("SPINE_TS_TRANSPORT_SCENARIO");
  const deliveryMode = required("SPINE_TS_TRANSPORT_DELIVERY_MODE");
  expect(["native", "grpc-web", "connect"]).toContain(protocol);
  expect([
    "basic",
    "cancel-retry",
    "pending-cancel",
    "concurrent-teardown",
    "stream-reconnect",
    "child-stream-fault",
    "child-stream-eof",
    "child-fanout-fault",
    "child-retry-exhaustion",
    "child-retry-cancel",
    "coordinator-child-fault",
    "coordinator-fanout-fault",
    "coordinator-retry-exhaustion",
    "coordinator-retry-cancel",
    "partial-activation-failure",
    "cancel-publication-race",
    "duplicate-ack-terminal",
  ]).toContain(scenario);
  expect(["db-only", "shared-memory"]).toContain(deliveryMode);
  const stdout = await runTransport([provider, protocol, scenario, deliveryMode]);
  const resultLine = stdout.trim().split("\n").at(-1);
  if (resultLine === undefined) throw new Error("Transport fixture returned no result.");
  const result = JSON.parse(resultLine) as {
    status: string;
    provider: string;
    protocol: string;
    scenario: string;
    deliveryMode: string;
    eventId?: string;
    relayedEvents?: readonly { id: string; sha256: string }[];
    stateId?: { number: number };
    counters: {
      ackReleased: number;
      cancelFaults: number;
      cancelSuccesses: number;
      streamFaults: number;
      iterators: number;
    };
    secondaryCounters?: {
      subscribe: number;
      activate: number;
      ackReleased: number;
      cancel: number;
      iterators: number;
    };
    secondaryTrace?: readonly { operation: string; id: string }[];
    coordinator?: { endpoint: string; childActivations: number };
  };
  expect(result).toMatchObject({
    status: "PASS",
    provider,
    protocol,
    scenario,
    deliveryMode,
    counters: {
      ackReleased: [
        "pending-cancel",
        "child-retry-cancel",
        "coordinator-retry-cancel",
        "duplicate-ack-terminal",
      ].includes(scenario)
        ? 1
        : [
              "stream-reconnect",
              "child-retry-exhaustion",
              "coordinator-retry-exhaustion",
              "cancel-publication-race",
            ].includes(scenario)
          ? 3
          : 2,
      cancelFaults: ["cancel-retry", "partial-activation-failure"].includes(scenario) ? 1 : 0,
      cancelSuccesses: [
        "pending-cancel",
        "child-retry-cancel",
        "coordinator-retry-cancel",
        "duplicate-ack-terminal",
      ].includes(scenario)
        ? 1
        : [
              "stream-reconnect",
              "child-retry-exhaustion",
              "coordinator-retry-exhaustion",
              "cancel-publication-race",
            ].includes(scenario)
          ? 3
          : 2,
      streamFaults: [
        "stream-reconnect",
        "child-stream-fault",
        "child-stream-eof",
        "child-fanout-fault",
        "child-retry-cancel",
        "coordinator-child-fault",
        "coordinator-fanout-fault",
        "coordinator-retry-cancel",
      ].includes(scenario)
        ? 1
        : ["child-retry-exhaustion", "coordinator-retry-exhaustion"].includes(scenario)
          ? 3
          : 0,
      iterators: 0,
    },
  });
  if (
    [
      "pending-cancel",
      "child-retry-exhaustion",
      "child-retry-cancel",
      "coordinator-retry-exhaustion",
      "coordinator-retry-cancel",
      "partial-activation-failure",
      "duplicate-ack-terminal",
    ].includes(scenario)
  ) {
    expect(result.eventId).toBeUndefined();
    if (["coordinator-retry-exhaustion", "coordinator-retry-cancel"].includes(scenario))
      expect(result.coordinator?.childActivations).toBe(
        scenario === "coordinator-retry-exhaustion" ? 3 : 1,
      );
    if (scenario === "partial-activation-failure")
      expect(result.secondaryCounters).toMatchObject({
        subscribe: 2,
        activate: 2,
        ackReleased: 0,
        iterators: 0,
      });
    if (scenario === "partial-activation-failure") {
      expect(result.secondaryCounters?.cancel).toBeGreaterThanOrEqual(2);
      expect(result.secondaryCounters?.cancel).toBeLessThanOrEqual(3);
      const accepted =
        result.secondaryTrace?.filter((item) => item.operation === "subscribe") ?? [];
      const canceled = result.secondaryTrace?.filter((item) => item.operation === "cancel") ?? [];
      expect(accepted).toHaveLength(2);
      expect(accepted.every((item) => canceled.some((candidate) => candidate.id === item.id))).toBe(
        true,
      );
    }
  } else if (
    [
      "child-stream-fault",
      "child-stream-eof",
      "child-fanout-fault",
      "coordinator-child-fault",
      "coordinator-fanout-fault",
    ].includes(scenario)
  ) {
    expect(typeof result.eventId).toBe("string");
    expect(result.eventId).not.toBe("");
    if (["coordinator-child-fault", "coordinator-fanout-fault"].includes(scenario)) {
      expect(result.coordinator?.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
      expect(result.coordinator?.childActivations).toBe(
        scenario === "coordinator-fanout-fault" ? 4 : 2,
      );
    }
    if (["child-fanout-fault", "coordinator-fanout-fault"].includes(scenario))
      expect(result.secondaryCounters).toEqual({
        subscribe: 2,
        activate: 2,
        ackReleased: 2,
        cancel: 2,
        iterators: 0,
      });
    if (["child-fanout-fault", "coordinator-fanout-fault"].includes(scenario)) {
      expect(result.relayedEvents).toHaveLength(2);
      expect(result.relayedEvents?.[0]?.id).toBe(result.eventId);
      expect(result.relayedEvents?.[1]).toEqual(result.relayedEvents?.[0]);
    }
  } else {
    expect(result.stateId?.number).toBe(1);
    expect(result.eventId).not.toBe("");
  }
}, 50_000);
