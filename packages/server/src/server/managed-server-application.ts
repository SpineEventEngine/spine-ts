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
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { RunningServer } from "./server.js";

const childMarker = "SPINE_MANAGED_SERVER_CHILD";
const slotMarker = "SPINE_MANAGED_SERVER_SLOT";
const incarnationMarker = "SPINE_MANAGED_SERVER_INCARNATION";
const initialRestartDelayMs = 250;
const maximumRestartDelayMs = 30_000;
const healthyReadyMs = 60_000;

/** Configures bounded replacement after an unexpected replica exit. */
export interface ManagedServerRestartOptions {
  /** Delay before the first replacement attempt. Defaults to 250 milliseconds. */
  readonly initialDelayMs?: number;
  /** Largest replacement delay. Defaults to 30 seconds. */
  readonly maximumDelayMs?: number;
  /** READY duration after which replacement delay returns to its initial value. Defaults to 60 seconds. */
  readonly healthyReadyMs?: number;
  /** Largest number of concurrent child starts. Defaults to the smaller of four and processCount. */
  readonly concurrentStarts?: number;
}

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
  /** Child-local readiness work that must settle before the private READY fact. */
  readonly synchronizationGates?: readonly Promise<unknown>[];
  /** Bounded private process-replacement settings. */
  readonly restart?: ManagedServerRestartOptions;
}

/** One managed complete-replica cohort. */
export interface ManagedServerApplicationHandle {
  /** Child process identifiers in logical-slot order. */
  readonly childPids: readonly number[];
  /** Whether all initial children completed the private readiness handshake. */
  readonly ready: boolean;
  /** Loopback endpoints reported by ready child processes. */
  readonly childEndpoints: readonly string[];
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
    await Promise.all(options.synchronizationGates ?? []);
    await ManagedServerValues.send({
      type: "ready",
      slot: process.env[slotMarker],
      incarnation: process.env[incarnationMarker],
      endpoint: server.baseUrl,
    });
    let closing: Promise<void> | undefined;
    process.once("message", (message: { readonly type?: string }) => {
      if (message.type === "close") closing ??= server.close().finally(() => process.disconnect());
    });
    return {
      childPids: [],
      childEndpoints: [server.baseUrl],
      ready: true,
      close: () => (closing ??= server.close()),
    };
  },
  parent(options: ManagedServerApplicationOptions): Promise<ManagedServerApplicationHandle> {
    return new ManagedServerCoordinator(options).start();
  },
  send(message: {
    readonly type: "ready";
    readonly slot: string | undefined;
    readonly incarnation: string | undefined;
    readonly endpoint: string;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      if (process.send === undefined || !process.connected) {
        reject(new Error("Managed child has no parent IPC channel."));
        return;
      }
      process.send(message, (error) => (error === null ? resolve() : reject(error)));
    });
  },
});

interface ReplicaRecord {
  readonly slot: number;
  readonly incarnation: string;
  readonly child: ChildProcess;
  endpoint: string | undefined;
  readyAt: number | undefined;
  expectedExit: boolean;
}

interface SlotRecord {
  readonly slot: number;
  failures: number;
  initialReady: boolean;
  starting: boolean;
  replacementTimer: ReturnType<typeof setTimeout> | undefined;
  replica: ReplicaRecord | undefined;
}

class ManagedServerCoordinator {
  readonly #slots: SlotRecord[];
  readonly #restart: Required<ManagedServerRestartOptions>;
  readonly #options: ManagedServerApplicationOptions;
  #closing = false;
  #starts = 0;
  #ready: Promise<void> | undefined;
  #resolveReady: (() => void) | undefined;

  constructor(options: ManagedServerApplicationOptions) {
    this.#options = options;
    this.#restart = ManagedServerCoordinatorValues.restart(options);
    this.#slots = Array.from({ length: options.processCount }, (_, slot) => ({
      slot,
      failures: 0,
      initialReady: false,
      starting: false,
      replacementTimer: undefined,
      replica: undefined,
    }));
  }

  async start(): Promise<ManagedServerApplicationHandle> {
    this.#ready = new Promise<void>((resolve) => {
      this.#resolveReady = resolve;
    });
    for (const slot of this.#slots) this.#start(slot);
    await this.#ready;
    const coordinator = this;
    return {
      get childPids() {
        return ManagedServerCoordinatorValues.pids(coordinator.#slots);
      },
      get childEndpoints() {
        return ManagedServerCoordinatorValues.endpoints(coordinator.#slots);
      },
      get ready() {
        return coordinator.#slots.some((slot) => slot.replica?.readyAt !== undefined);
      },
      close: () => this.close(),
    };
  }

  #start(slot: SlotRecord): void {
    if (
      this.#closing ||
      slot.starting ||
      slot.replica !== undefined ||
      this.#starts >= this.#restart.concurrentStarts
    )
      return;
    slot.starting = true;
    this.#starts++;
    const incarnation = randomUUID();
    const child = fork(fileURLToPath(this.#options.moduleUrl), [], {
      env: {
        ...process.env,
        [childMarker]: "true",
        [slotMarker]: String(slot.slot),
        [incarnationMarker]: incarnation,
      },
      silent: true,
    });
    const replica: ReplicaRecord = {
      slot: slot.slot,
      incarnation,
      child,
      endpoint: undefined,
      readyAt: undefined,
      expectedExit: false,
    };
    slot.replica = replica;
    child.on("message", (message: unknown) => this.#onMessage(slot, replica, message));
    child.once("exit", () => this.#onExit(slot, replica));
  }

  #onMessage(slot: SlotRecord, replica: ReplicaRecord, message: unknown): void {
    if (!ManagedServerCoordinatorValues.readyMessage(message, slot.slot, replica.incarnation))
      return;
    if (slot.replica !== replica || replica.readyAt !== undefined || this.#closing) return;
    slot.starting = false;
    this.#starts--;
    replica.endpoint = message.endpoint;
    replica.readyAt = Date.now();
    slot.initialReady = true;
    if (this.#slots.every((candidate) => candidate.initialReady)) this.#resolveReady?.();
    this.#drainStarts();
  }

  #onExit(slot: SlotRecord, replica: ReplicaRecord): void {
    if (slot.replica !== replica) return;
    slot.replica = undefined;
    if (slot.starting) {
      slot.starting = false;
      this.#starts--;
    }
    if (this.#closing || replica.expectedExit) return;
    if (
      replica.readyAt !== undefined &&
      Date.now() - replica.readyAt >= this.#restart.healthyReadyMs
    ) {
      slot.failures = 0;
    }
    slot.failures++;
    const delay = Math.min(
      this.#restart.initialDelayMs * 2 ** Math.max(0, slot.failures - 1),
      this.#restart.maximumDelayMs,
    );
    slot.replacementTimer = setTimeout(() => {
      slot.replacementTimer = undefined;
      this.#start(slot);
    }, delay);
    this.#drainStarts();
  }

  #drainStarts(): void {
    for (const slot of this.#slots) {
      if (this.#starts >= this.#restart.concurrentStarts) return;
      if (slot.replica === undefined && slot.replacementTimer === undefined) this.#start(slot);
    }
  }

  async close(): Promise<void> {
    if (this.#closing) return;
    this.#closing = true;
    for (const slot of this.#slots) {
      if (slot.replacementTimer !== undefined) clearTimeout(slot.replacementTimer);
      slot.replacementTimer = undefined;
    }
    await Promise.all(
      this.#slots.map((slot) => ManagedServerCoordinatorValues.close(slot.replica)),
    );
  }
}

const ManagedServerCoordinatorValues = Object.freeze({
  restart(options: ManagedServerApplicationOptions): Required<ManagedServerRestartOptions> {
    const restart = {
      initialDelayMs: options.restart?.initialDelayMs ?? initialRestartDelayMs,
      maximumDelayMs: options.restart?.maximumDelayMs ?? maximumRestartDelayMs,
      healthyReadyMs: options.restart?.healthyReadyMs ?? healthyReadyMs,
      concurrentStarts: options.restart?.concurrentStarts ?? Math.min(4, options.processCount),
    };
    for (const [name, value] of Object.entries(restart)) {
      if (!Number.isSafeInteger(value) || value < 1)
        throw new Error(`Managed server restart ${name} must be a positive safe integer.`);
    }
    if (restart.maximumDelayMs < restart.initialDelayMs)
      throw new Error("Managed server restart maximumDelayMs must not be below initialDelayMs.");
    if (restart.concurrentStarts > options.processCount)
      throw new Error("Managed server restart concurrentStarts must not exceed processCount.");
    return restart;
  },
  pids(slots: readonly SlotRecord[]): readonly number[] {
    return slots.flatMap((slot) =>
      slot.replica?.readyAt === undefined ? [] : [slot.replica.child.pid ?? 0],
    );
  },
  endpoints(slots: readonly SlotRecord[]): readonly string[] {
    return slots.flatMap((slot) =>
      slot.replica?.endpoint === undefined ? [] : [slot.replica.endpoint],
    );
  },
  readyMessage(
    message: unknown,
    slot: number,
    incarnation: string,
  ): message is { readonly endpoint: string } {
    if (typeof message !== "object" || message === null) return false;
    const candidate = message as Record<string, unknown>;
    return (
      candidate.type === "ready" &&
      candidate.slot === String(slot) &&
      candidate.incarnation === incarnation &&
      typeof candidate.endpoint === "string"
    );
  },
  async close(replica: ReplicaRecord | undefined): Promise<void> {
    if (replica === undefined) return;
    replica.expectedExit = true;
    const { child } = replica;
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    if (child.connected) child.send({ type: "close" });
    await exited;
  },
});
