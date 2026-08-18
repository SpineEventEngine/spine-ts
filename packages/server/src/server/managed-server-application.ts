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
import { fileURLToPath } from "node:url";
import type { RunningServer } from "./server.js";

const childMarker = "SPINE_MANAGED_SERVER_CHILD";

/** Configures one locally assembled complete-replica application. */
export interface ManagedServerApplicationOptions {
  /** Explicit number of complete application replicas to start. */
  readonly processCount: number;
  /** URL of the ESM entry module that invokes this method in parent and child processes. */
  readonly moduleUrl: string;
  /** Host for the future coordinator listener. */
  readonly host: string;
  /** Port for the future coordinator listener. */
  readonly port: number;
  /** Builds one complete local application server in a child process. */
  readonly createServer: (options: {
    readonly host: string;
    readonly port: number;
  }) => Promise<RunningServer>;
}

/** One managed complete-replica cohort. */
export interface ManagedServerApplicationHandle {
  /** Child process identifiers in logical-slot order. */
  readonly childPids: readonly number[];
  /** Whether all initial children completed the private readiness handshake. */
  readonly ready: boolean;
  /** Stops all child processes and waits for their exit. */
  close(): Promise<void>;
}

/** Starts a managed parent and its complete-replica child processes. */
export const ManagedServerApplication: Readonly<{
  run(options: ManagedServerApplicationOptions): Promise<ManagedServerApplicationHandle>;
}> = Object.freeze({
  async run(options: ManagedServerApplicationOptions): Promise<ManagedServerApplicationHandle> {
    if (!Number.isSafeInteger(options.processCount) || options.processCount < 1) {
      throw new Error("Managed server processCount must be a positive safe integer.");
    }
    if (process.env[childMarker] === "true") return ManagedServerValues.child(options);
    return ManagedServerValues.parent(options);
  },
});

const ManagedServerValues = Object.freeze({
  async child(options: ManagedServerApplicationOptions): Promise<ManagedServerApplicationHandle> {
    const server = await options.createServer({ host: "127.0.0.1", port: 0 });
    await ManagedServerValues.send({ type: "ready" });
    let closing: Promise<void> | undefined;
    process.once("message", (message: { readonly type?: string }) => {
      if (message.type === "close") closing ??= server.close().finally(() => process.disconnect());
    });
    return { childPids: [], ready: true, close: () => (closing ??= server.close()) };
  },
  parent(options: ManagedServerApplicationOptions): Promise<ManagedServerApplicationHandle> {
    const children = Array.from({ length: options.processCount }, () =>
      fork(fileURLToPath(options.moduleUrl), [], {
        env: { ...process.env, [childMarker]: "true" },
        silent: true,
      }),
    );
    return new Promise((resolve, reject) => {
      let ready = 0;
      for (const child of children) {
        child.once("exit", () => reject(new Error("Managed child exited before ready.")));
        child.on("message", (message: { readonly type?: string }) => {
          if (message.type !== "ready" || ++ready !== children.length) return;
          resolve({
            childPids: children.map((candidate) => candidate.pid ?? 0),
            ready: true,
            close: () => ManagedServerValues.close(children),
          });
        });
      }
    });
  },
  async close(children: readonly ChildProcess[]): Promise<void> {
    for (const child of children) if (child.connected) child.send({ type: "close" });
    await Promise.all(
      children.map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) resolve();
            else child.once("exit", () => resolve());
          }),
      ),
    );
  },
  send(message: { readonly type: "ready" }): Promise<void> {
    return new Promise((resolve, reject) => {
      if (process.send === undefined || !process.connected) {
        reject(new Error("Managed child has no parent IPC channel."));
        return;
      }
      process.send(message, (error) => (error === null ? resolve() : reject(error)));
    });
  },
});
