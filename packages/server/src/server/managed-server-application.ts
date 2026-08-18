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
import { LogLayer, StructuredTransport, type ILogLayer } from "loglayer";
import { runningServerAccess, type RunningServer } from "./server.js";
import { emitServerWarning } from "./server-log.js";
import { NodeCoordinator, type ReadyCoordinatorMember } from "./node-coordinator.js";
import { InMemorySubscriptionRegistry } from "../stand/subscription-registry.js";

const childMarker = "SPINE_MANAGED_SERVER_CHILD";
const slotMarker = "SPINE_MANAGED_SERVER_SLOT";
const incarnationMarker = "SPINE_MANAGED_SERVER_INCARNATION";
const initialRestartDelayMs = 250;
const maximumRestartDelayMs = 30_000;
const healthyReadyMs = 60_000;
const closeGraceMs = 1_000;
const closeKillMs = 1_000;
const endpointMaximumBytes = 256;
const handleMembers = new WeakMap<ManagedServerApplicationHandle, ManagedServerCoordinator>();
const managedTestRegistries = new WeakMap<RunningServer, readonly InMemorySubscriptionRegistry[]>();
const lifecycleLogger: ILogLayer = new LogLayer({
  transport: new StructuredTransport({
    logger: console,
    level: "warn",
    stringify: true,
    messageField: "message",
    dateField: "timestamp",
    levelField: "severity",
    levelFn: (level) => level.toUpperCase(),
  }),
}).child();

/**
 *
 * Configures bounded replacement after an unexpected replica exit.
 */
export interface ManagedServerRestartOptions {
  // prettier-ignore

  /**
   *
   * Delays the first replacement attempt. Defaults to 250 milliseconds.
   */
  readonly initialDelayMs?: number;

  /**
   *
   * Limits replacement delay to 30 seconds.
   */
  readonly maximumDelayMs?: number;

  /**
   *
   * Resets replacement delay after 60 seconds of READY status.
   */
  readonly healthyReadyMs?: number;

  /**
   *
   * Limits concurrent child starts to the smaller of four and processCount.
   */
  readonly concurrentStarts?: number;
}

/**
 *
 * Configures one locally assembled complete-replica application.
 */
export interface ManagedServerApplicationOptions {
  // prettier-ignore

  /**
   *
   * Specifies the number of complete application replicas to start.
   */
  readonly processCount: number;

  /**
   *
   * Hosts the front-facing Coordinator listener. Defaults to `127.0.0.1`.
   */
  readonly host?: string;

  /**
   *
   * Selects the known front-facing Coordinator listener port.
   */
  readonly port: number;

  /**
   *
   * Identifies the ESM entry module invoked in parent and child processes.
   */
  readonly moduleUrl: string;

  /**
   *
   * Builds one complete local application server in a child process.
   *
   * The framework owns the returned `Server` for the managed child lifetime.
   * Every assembled Bounded Context must use its actual
   * `InMemorySubscriptionRegistry`: managed mode rejects persistent and custom
   * registries, then closes the assembled server before the child can report
   * READY. This prevents child-local durable subscription ownership.
   *
   * @param options Supplies the child-only loopback listener address.
   * @returns The assembled local application server.
   */
  readonly createServer: (options: {
    // prettier-ignore

    /**
     *
     * Identifies the loopback listener host.
     */
    readonly host: string;

    /**
     *
     * Requests an ephemeral loopback listener port.
     */
    readonly port: number;
  }) => Promise<RunningServer>;

  /**
   *
   * Starts child-local readiness work after local server assembly.
   *
   * This callback runs only in a managed child. It is deliberately lazy so a
   * parent never starts application synchronization work.
   *
   * @returns Completion after the child is ready for local intake.
   */
  readonly synchronize?: () => Promise<void>;

  /**
   *
   * Configures bounded private process replacement.
   */
  readonly restart?: ManagedServerRestartOptions;
}

/**
 *
 * Represents one managed complete-replica cohort.
 */
export interface ManagedServerApplicationHandle {
  // prettier-ignore

  /**
   *
   * Reports whether at least one managed child is currently ready.
   */
  readonly ready: boolean;

  /**
   *
   * Stops all child processes and waits for their exit.
   *
   * @returns Completion after managed child cleanup succeeds.
   */
  close(): Promise<void>;
}

/**
 *
 * Starts a managed parent and its complete-replica child processes.
 */
export const ManagedServerApplication: Readonly<{
  run(options: ManagedServerApplicationOptions): Promise<ManagedServerApplicationHandle>;
}> = Object.freeze({
  async run(options: ManagedServerApplicationOptions): Promise<ManagedServerApplicationHandle> {
    if (!Number.isSafeInteger(options.processCount) || options.processCount < 1) {
      throw new Error("Managed server processCount must be a positive safe integer.");
    }
    ManagedServerCoordinatorValues.coordinatorPort(options.port);
    if (process.env[childMarker] === "true") return ManagedServerValues.child(options);
    return ManagedServerValues.parent(options);
  },
});

const ManagedServerValues = Object.freeze({
  async child(options: ManagedServerApplicationOptions): Promise<ManagedServerApplicationHandle> {
    const server = await options.createServer({ host: "127.0.0.1", port: 0 });
    try {
      ManagedServerValues.requireVolatileRegistries(server);
      await options.synchronize?.();
    } catch (error) {
      try {
        await server.close();
      } catch (cleanup) {
        throw new AggregateError(
          [error, cleanup],
          "Managed child setup and server cleanup failed.",
        );
      }
      throw error;
    }
    // Node may emit an IPC EPIPE after a parent has already disappeared. The
    // disconnect handler below owns shutdown; this listener prevents that
    // transport detail from becoming an unhandled child-process exception.
    const containIpcError = () => undefined;
    process.on("error", containIpcError);
    try {
      await ManagedServerValues.send({
        type: "ready",
        slot: process.env[slotMarker],
        incarnation: process.env[incarnationMarker],
        endpoint: server.baseUrl,
      });
    } catch (error) {
      await server.close();
      process.off("error", containIpcError);
      throw error;
    }
    let closing: Promise<void> | undefined;
    const close = () => {
      if (closing !== undefined) return closing;
      const attempt = ManagedServerValues.send({
        type: "draining",
        slot: process.env[slotMarker],
        incarnation: process.env[incarnationMarker],
      })
        .catch(() => undefined)
        .then(() => server.close())
        .then(
          () => {
            if (process.connected && typeof process.disconnect === "function") process.disconnect();
            process.off("error", containIpcError);
            process.off("message", onMessage);
          },
          (error: unknown) => {
            if (closing === attempt) closing = undefined;
            throw error;
          },
        );
      closing = attempt;
      return attempt;
    };
    const onMessage = (message: { readonly type?: string }) => {
      if (message.type === "close") {
        ManagedServerValues.closeFromEvent(close);
      }
    };
    process.on("message", onMessage);
    process.once("disconnect", () => {
      ManagedServerValues.closeFromEvent(close);
    });
    return {
      ready: true,
      close,
    };
  },
  parent(options: ManagedServerApplicationOptions): Promise<ManagedServerApplicationHandle> {
    return new ManagedServerCoordinator(options).start();
  },
  closeFromEvent(close: () => Promise<void>): void {
    // spine-log-boundary: server.managed_replica_child_close
    void close().catch(() => {
      emitServerWarning(lifecycleLogger, "Managed child close failed.", {
        operation: "managed_replica.child_close",
        reasonCode: "close_failed",
      });
    });
  },
  requireVolatileRegistries(server: RunningServer): void {
    const registries =
      runningServerAccess.subscriptionRegistries(server) ?? managedTestRegistries.get(server);
    if (
      registries === undefined ||
      registries.some((registry) => !(registry instanceof InMemorySubscriptionRegistry))
    )
      throw new Error(
        "Managed application replicas require an in-memory Stand subscription registry.",
      );
  },
  send(message: {
    readonly type: "ready" | "draining";
    readonly slot: string | undefined;
    readonly incarnation: string | undefined;
    readonly endpoint?: string;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      if (process.send === undefined || !process.connected) {
        reject(new Error("Managed child has no parent IPC channel."));
        return;
      }
      try {
        process.send(message, (error) => {
          if (error === null) resolve();
          else reject(error);
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Managed child READY IPC failed."));
      }
    });
  },
});

interface ReplicaRecord {
  readonly slot: number;
  readonly incarnation: string;
  readonly child: ChildProcess;
  endpoint: string | undefined;
  readyAt: number | undefined;
  draining: boolean;
  expectedExit: boolean;
  terminal: boolean;
}

interface SlotRecord {
  readonly slot: number;
  failures: number;
  initialReady: boolean;
  starting: boolean;
  replacementTimer: unknown;
  replica: ReplicaRecord | undefined;
}

/**
 *
 * Supplies deterministic dependencies for the private process supervisor.
 *
 * @internal
 */
export interface ManagedServerCoordinatorDependencies {
  // prettier-ignore

  /**
   *
   * Provides the clock and timers used by managed replica lifecycle tests.
   */
  readonly clock: {
    // prettier-ignore

    /**
     *
     * Reads the current clock value.
     *
     * @returns The current time in milliseconds.
     */
    now(): number;

    /**
     *
     * Schedules a timeout callback.
     *
     * @param onTimeout Runs when the requested delay elapses.
     * @param delay Specifies the timeout in milliseconds.
     * @returns A timer handle that can be cleared.
     */
    setTimeout(onTimeout: () => void, delay: number): unknown;

    /**
     *
     * Cancels a scheduled timeout.
     *
     * @param timer Identifies the timer to cancel.
     */
    clearTimeout(timer: unknown): void;
  };

  /**
   *
   * Starts one child process for a replica incarnation.
   *
   * @param moduleUrl Identifies the child ESM entry module.
   * @param slot Identifies the managed replica slot.
   * @param incarnation Identifies this child process incarnation.
   * @returns The started child process.
   */
  readonly spawn: (moduleUrl: string, slot: number, incarnation: string) => ChildProcess;

  /**
   *
   * Opens the private parent Coordinator after initial replica readiness.
   *
   * @param options Supplies private Coordinator membership and listener facts.
   * @returns The running private Coordinator.
   */
  readonly openCoordinator?: (options: {
    readonly members: ManagedServerCoordinator;
    readonly host?: string;
    readonly port?: number;
  }) => Promise<NodeCoordinator>;
}

type ManagedServerCoordinatorOptions = Omit<ManagedServerApplicationOptions, "port"> & {
  readonly port?: number;
};

/**
 *
 * Coordinates the parent-only lifecycle of managed application replicas.
 *
 * @internal
 */
export class ManagedServerCoordinator {
  readonly #slots: SlotRecord[];
  readonly #restart: Required<ManagedServerRestartOptions>;
  readonly #options: ManagedServerCoordinatorOptions;
  readonly #dependencies: ManagedServerCoordinatorDependencies;
  #closing = false;
  #starts = 0;
  #ready: Promise<void> | undefined;
  #resolveReady: (() => void) | undefined;
  #close: Promise<void> | undefined;
  readonly #retired = new Set<ReplicaRecord>();
  readonly #retireTerminations = new Map<ReplicaRecord, Promise<void>>();
  readonly #memberListeners = new Set<() => void>();
  #onSignal: (() => void) | undefined;
  #nodeCoordinator: NodeCoordinator | undefined;

  /**
   *
   * Creates a coordinator for one configured replica cohort.
   *
   * @param options Configures complete child application replicas.
   * @param dependencies Supplies private process and clock dependencies.
   */
  constructor(
    options: ManagedServerCoordinatorOptions,
    dependencies: ManagedServerCoordinatorDependencies = ManagedServerCoordinatorValues.dependencies,
  ) {
    this.#options = options;
    this.#dependencies = dependencies;
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

  /**
   *
   * Starts every initial replica and waits until all report READY.
   *
   * @returns The handle for the started managed cohort.
   */
  async start(): Promise<ManagedServerApplicationHandle> {
    this.#ready = new Promise<void>((resolve) => {
      this.#resolveReady = resolve;
    });
    this.#installSignalHandlers();
    for (const slot of this.#slots) this.#start(slot);
    await this.#ready;
    try {
      const openCoordinator = this.#dependencies.openCoordinator;
      if (openCoordinator !== undefined)
        this.#nodeCoordinator = await openCoordinator({
          members: this,
          ...(this.#options.host === undefined ? {} : { host: this.#options.host }),
          ...(this.#options.port === undefined ? {} : { port: this.#options.port }),
        });
    } catch (error) {
      try {
        await this.close();
      } catch (rollback) {
        throw new AggregateError(
          [error, rollback],
          "Managed replica Coordinator start and rollback failed.",
        );
      }
      throw error;
    }
    const isReady = () => this.#slots.some((slot) => slot.replica?.readyAt !== undefined);
    const handle: ManagedServerApplicationHandle = {
      get ready() {
        return isReady();
      },
      close: () => this.close(),
    };
    handleMembers.set(handle, this);
    return handle;
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
    let child: ChildProcess;
    try {
      child = this.#dependencies.spawn(this.#options.moduleUrl, slot.slot, incarnation);
    } catch {
      slot.starting = false;
      this.#starts--;
      // spine-log-boundary: server.managed_replica_start
      emitServerWarning(lifecycleLogger, "Managed replica start failed.", {
        operation: "managed_replica.start",
        reasonCode: "start_failed",
        slot: String(slot.slot),
        incarnation,
        attempt: String(slot.failures + 1),
      });
      this.#scheduleReplacement(slot);
      this.#drainStarts();
      return;
    }
    const replica: ReplicaRecord = {
      slot: slot.slot,
      incarnation,
      child,
      endpoint: undefined,
      readyAt: undefined,
      draining: false,
      expectedExit: false,
      terminal: false,
    };
    slot.replica = replica;
    child.on("message", (message: unknown) => {
      this.#onMessage(slot, replica, message);
    });
    child.once("exit", () => {
      this.#retired.delete(replica);
      this.#retireTerminations.delete(replica);
      this.#onExit(slot, replica);
    });
    child.once("error", () => {
      this.#onError(slot, replica);
    });
  }

  #onMessage(slot: SlotRecord, replica: ReplicaRecord, message: unknown): void {
    if (ManagedServerCoordinatorValues.drainingMessage(message, slot.slot, replica.incarnation)) {
      if (slot.replica !== replica || replica.draining) return;
      replica.draining = true;
      replica.expectedExit = true;
      this.#notifyReadyMembers();
      return;
    }
    if (!ManagedServerCoordinatorValues.readyMessage(message, slot.slot, replica.incarnation))
      return;
    if (slot.replica !== replica || replica.readyAt !== undefined || this.#closing) return;
    slot.starting = false;
    this.#starts--;
    replica.endpoint = message.endpoint;
    replica.readyAt = this.#dependencies.clock.now();
    slot.initialReady = true;
    if (this.#slots.every((candidate) => candidate.initialReady)) this.#resolveReady?.();
    this.#notifyReadyMembers();
    this.#drainStarts();
  }

  #onExit(slot: SlotRecord, replica: ReplicaRecord): void {
    if (slot.replica !== replica || replica.terminal) return;
    replica.terminal = true;
    slot.replica = undefined;
    this.#notifyReadyMembers();
    if (slot.starting) {
      slot.starting = false;
      this.#starts--;
    }
    if (this.#closing || replica.expectedExit) return;
    if (
      replica.readyAt !== undefined &&
      this.#dependencies.clock.now() - replica.readyAt >= this.#restart.healthyReadyMs
    ) {
      slot.failures = 0;
    }
    // spine-log-boundary: server.managed_replica_exit
    emitServerWarning(lifecycleLogger, "Managed replica exited unexpectedly.", {
      operation: "managed_replica.exit",
      reasonCode: "unexpected_exit",
      slot: String(slot.slot),
      incarnation: replica.incarnation,
      attempt: String(slot.failures + 1),
    });
    this.#scheduleReplacement(slot);
    this.#drainStarts();
  }

  #onError(slot: SlotRecord, replica: ReplicaRecord): void {
    if (slot.replica !== replica || replica.terminal) return;
    // A ChildProcess error can precede exit while the OS process still lives.
    // Retire the incarnation once, then actively terminate that known child.
    this.#onExit(slot, replica);
    this.#terminateUnexpected(replica);
  }

  #scheduleReplacement(slot: SlotRecord): void {
    slot.failures++;
    const delay = Math.min(
      this.#restart.initialDelayMs * 2 ** Math.max(0, slot.failures - 1),
      this.#restart.maximumDelayMs,
    );
    slot.replacementTimer = this.#dependencies.clock.setTimeout(() => {
      slot.replacementTimer = undefined;
      this.#start(slot);
    }, delay);
    // spine-log-boundary: server.managed_replica_retry
    emitServerWarning(lifecycleLogger, "Managed replica replacement scheduled.", {
      operation: "managed_replica.replace",
      reasonCode: "unexpected_exit",
      slot: String(slot.slot),
      attempt: String(slot.failures),
      delay: String(delay),
    });
  }

  #drainStarts(): void {
    for (const slot of this.#slots) {
      if (this.#starts >= this.#restart.concurrentStarts) return;
      if (slot.replica === undefined && slot.replacementTimer === undefined) this.#start(slot);
    }
  }

  /**
   *
   * Stops managed children and prevents later replacement starts.
   *
   * @returns Completion after child and retired-child cleanup succeeds.
   */
  close(): Promise<void> {
    const closing = this.#close;
    if (closing !== undefined) return closing;
    const close = (async () => {
      this.#closing = true;
      this.#removeSignalHandlers();
      for (const slot of this.#slots) {
        if (slot.replacementTimer !== undefined)
          this.#dependencies.clock.clearTimeout(slot.replacementTimer);
        slot.replacementTimer = undefined;
      }
      const childClose = Promise.all(this.#slots.map((slot) => this.#closeReplica(slot.replica)));
      const coordinatorClose = this.#nodeCoordinator?.close();
      if (coordinatorClose === undefined) await childClose;
      else await Promise.all([coordinatorClose, childClose]);
      await Promise.all([...this.#retired].map((replica) => this.#closeRetired(replica)));
    })();
    this.#close = close;
    void close.then(undefined, () => {
      if (this.#close === close) this.#close = undefined;
    });
    return close;
  }

  #closeReplica(replica: ReplicaRecord | undefined): Promise<void> {
    return ManagedServerCoordinatorValues.close(replica, this.#dependencies.clock);
  }

  async #closeRetired(replica: ReplicaRecord): Promise<void> {
    replica.expectedExit = true;
    await this.#terminateRetired(replica);
    this.#retired.delete(replica);
  }

  #terminateUnexpected(replica: ReplicaRecord): void {
    this.#retired.add(replica);
    void this.#terminateRetired(replica);
  }

  #terminateRetired(replica: ReplicaRecord): Promise<void> {
    const prior = this.#retireTerminations.get(replica);
    if (prior !== undefined) return prior;
    const termination = ManagedServerCoordinatorValues.terminate(
      replica.child,
      this.#dependencies.clock,
    );
    this.#retireTerminations.set(replica, termination);
    void termination.then(
      () => {
        this.#retireTerminations.delete(replica);
        this.#retired.delete(replica);
      },
      () => {
        this.#retireTerminations.delete(replica);
        // spine-log-boundary: server.managed_replica_termination
        emitServerWarning(lifecycleLogger, "Managed replica termination was bounded.", {
          operation: "managed_replica.terminate",
          reasonCode: "unresponsive",
          slot: String(replica.slot),
          incarnation: replica.incarnation,
        });
      },
    );
    return termination;
  }

  /**
   *
   * Returns ready child facts to the next Coordinator slice.
   *
   * @returns The ready child topology facts.
   * @internal
   */
  readyMembers(): readonly ReadyCoordinatorMember[] {
    return this.#slots.flatMap((slot) => {
      const replica = slot.replica;
      if (
        replica?.readyAt === undefined ||
        replica.draining ||
        replica.endpoint === undefined ||
        replica.child.pid === undefined
      )
        return [];
      return [
        {
          slot: slot.slot,
          incarnation: replica.incarnation,
          pid: replica.child.pid,
          endpoint: replica.endpoint,
        },
      ];
    });
  }

  /**
   * Subscribes one private Coordinator to READY membership changes.
   *
   * @param onChange Runs after an admitted READY member or removed member changes.
   * @returns Stops later private notifications.
   * @internal
   */
  onReadyMembersChange(onChange: () => void): () => void {
    this.#memberListeners.add(onChange);
    return () => this.#memberListeners.delete(onChange);
  }

  /**
   * Returns the private public-listener endpoint for coordinator acceptance.
   *
   * @returns The listener endpoint after managed startup, when open.
   * @internal
   */
  coordinatorEndpoint(): string | undefined {
    return this.#nodeCoordinator?.baseUrl;
  }

  #notifyReadyMembers(): void {
    for (const listener of this.#memberListeners) listener();
  }

  #installSignalHandlers(): void {
    if (this.#onSignal !== undefined) return;
    this.#onSignal = () => {
      // spine-log-boundary: server.managed_replica_signal
      void this.close()
        .then(() => {
          if (process.connected && typeof process.disconnect === "function") process.disconnect();
        })
        .catch(() => {
          emitServerWarning(lifecycleLogger, "Managed replica signal close failed.", {
            operation: "managed_replica.signal",
            reasonCode: "close_failed",
          });
        });
    };
    process.on("SIGINT", this.#onSignal);
    process.on("SIGTERM", this.#onSignal);
  }

  #removeSignalHandlers(): void {
    if (this.#onSignal === undefined) return;
    process.off("SIGINT", this.#onSignal);
    process.off("SIGTERM", this.#onSignal);
    this.#onSignal = undefined;
  }
}

/**
 *
 * Represents private ready-child facts for Coordinator forwarding.
 *
 * @internal
 */
type ReadyMember = ReadyCoordinatorMember;

/**
 *
 * Exposes private Coordinator topology facts to the next internal slice.
 *
 * @internal
 */
export const managedServerCoordinatorAccess: Readonly<{
  readyMembers(coordinator: ManagedServerCoordinator): readonly ReadyMember[];
  coordinatorEndpoint(coordinator: ManagedServerCoordinator): string | undefined;
}> = Object.freeze({
  readyMembers(coordinator: ManagedServerCoordinator): readonly ReadyMember[] {
    return coordinator.readyMembers();
  },
  coordinatorEndpoint(coordinator: ManagedServerCoordinator): string | undefined {
    return coordinator.coordinatorEndpoint();
  },
});

/**
 *
 * Exposes private managed-child facts to Coordinator forwarding tests.
 *
 * @internal
 */
export const managedServerApplicationAccess: Readonly<{
  readyMembers(handle: ManagedServerApplicationHandle): readonly ReadyMember[];
  coordinatorEndpoint(handle: ManagedServerApplicationHandle): string | undefined;
  installRegistriesForTest(
    server: RunningServer,
    registries: readonly InMemorySubscriptionRegistry[],
  ): void;
}> = Object.freeze({
  readyMembers(handle: ManagedServerApplicationHandle): readonly ReadyMember[] {
    return handleMembers.get(handle)?.readyMembers() ?? [];
  },
  coordinatorEndpoint(handle: ManagedServerApplicationHandle): string | undefined {
    return handleMembers.get(handle)?.coordinatorEndpoint();
  },
  installRegistriesForTest(
    server: RunningServer,
    registries: readonly InMemorySubscriptionRegistry[],
  ): void {
    managedTestRegistries.set(server, registries);
  },
});

const ManagedServerCoordinatorValues = Object.freeze({
  coordinatorPort(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > 65_535)
      throw new Error(
        "Managed server Coordinator port must be a safe integer between 1 and 65535.",
      );
    return value;
  },
  dependencies: {
    clock: {
      now: () => Date.now(),
      setTimeout: (onTimeout: () => void, delay: number) => setTimeout(onTimeout, delay),
      clearTimeout: (timer: unknown) => {
        clearTimeout(timer as ReturnType<typeof setTimeout>);
      },
    },
    spawn: (moduleUrl: string, slot: number, incarnation: string) =>
      fork(fileURLToPath(moduleUrl), [], {
        env: {
          ...process.env,
          [childMarker]: "true",
          [slotMarker]: String(slot),
          [incarnationMarker]: incarnation,
        },
        stdio: ["inherit", "inherit", "inherit", "ipc"],
      }),
    openCoordinator: (options) => NodeCoordinator.open(options),
  } satisfies ManagedServerCoordinatorDependencies,
  restart(options: ManagedServerCoordinatorOptions): Required<ManagedServerRestartOptions> {
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
      typeof candidate.endpoint === "string" &&
      canonicalLoopbackEndpoint(candidate.endpoint) !== undefined
    );
  },
  drainingMessage(
    message: unknown,
    slot: number,
    incarnation: string,
  ): message is {
    readonly type: "draining";
    readonly slot: string;
    readonly incarnation: string;
  } {
    if (typeof message !== "object" || message === null) return false;
    const candidate = message as Record<string, unknown>;
    return (
      candidate.type === "draining" &&
      candidate.slot === String(slot) &&
      candidate.incarnation === incarnation
    );
  },
  async close(
    replica: ReplicaRecord | undefined,
    clock: ManagedServerCoordinatorDependencies["clock"],
  ): Promise<void> {
    if (replica === undefined) return;
    replica.expectedExit = true;
    const { child } = replica;
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => {
        resolve();
      }),
    );
    if (child.connected) child.send({ type: "close" }, () => undefined);
    await ManagedServerCoordinatorValues.terminate(child, clock, exited);
  },
  async terminate(
    child: ChildProcess,
    clock: ManagedServerCoordinatorDependencies["clock"],
    knownExit?: Promise<void>,
  ): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited =
      knownExit ??
      new Promise<void>((resolve) =>
        child.once("exit", () => {
          resolve();
        }),
      );
    if (await ManagedServerCoordinatorValues.within(exited, closeGraceMs, clock)) return;
    child.kill("SIGTERM");
    if (await ManagedServerCoordinatorValues.within(exited, closeKillMs, clock)) return;
    child.kill("SIGKILL");
    if (await ManagedServerCoordinatorValues.within(exited, closeKillMs, clock)) return;
    throw new Error("Managed child did not exit after SIGKILL.");
  },
  within(
    promise: Promise<void>,
    delay: number,
    clock: ManagedServerCoordinatorDependencies["clock"],
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = clock.setTimeout(() => {
        resolve(false);
      }, delay);
      void promise.then(() => {
        clock.clearTimeout(timer);
        resolve(true);
      });
    });
  },
});

function canonicalLoopbackEndpoint(value: string): string | undefined {
  if (Buffer.byteLength(value, "utf8") > endpointMaximumBytes) return undefined;
  try {
    const endpoint = new URL(value);
    if (
      endpoint.protocol !== "http:" ||
      endpoint.hostname !== "127.0.0.1" ||
      endpoint.port === "" ||
      endpoint.username !== "" ||
      endpoint.password !== "" ||
      endpoint.pathname !== "/" ||
      endpoint.search !== "" ||
      endpoint.hash !== "" ||
      endpoint.origin !== value
    )
      return undefined;
    const port = Number(endpoint.port);
    return Number.isSafeInteger(port) && port >= 1 && port <= 65_535 ? value : undefined;
  } catch {
    return undefined;
  }
}
