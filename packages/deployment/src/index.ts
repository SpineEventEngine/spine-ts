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

/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/require-await */

import { ApplicationNode } from "./discovery/application-node.js";
import { scheduledDiscoveryLog } from "./discovery/scheduled-discovery-log.js";
import type { ILogLayer } from "loglayer";

export { ApplicationNode } from "./discovery/application-node.js";
export {
  BackendMembershipKernel,
  type BackendMemberClient,
  type BackendMembershipKernelOptions,
} from "./internal/backend-membership-kernel.js";

export {
  LeasedNodeRegistry,
  type LeasedNodeRegistryOptions,
  type NodeLease,
} from "./registry/leased-node-registry.js";

/**
 * Receives complete application-node snapshots.
 */
export interface NodeDiscovery {
  // prettier-ignore

  /**
   * Starts complete snapshot delivery.
   *
   * @param onSnapshot Receives each complete immutable node snapshot.
   * @returns A deterministic operation that stops later delivery.
   */
  watch(
    onSnapshot: (nodes: readonly ApplicationNode[]) => void,
  ): Promise<() => Promise<void>> | (() => Promise<void>);
}

/**
 * Schedules node refresh callbacks.
 */
export interface NodeScheduler {
  // prettier-ignore

  /**
   * Schedules one refresh callback.
   *
   * @param delayMs Supplies the delay in milliseconds.
   * @param onTick Receives the callback to run.
   * @returns Cancels the scheduled callback.
   */
  schedule(delayMs: number, onTick: () => void): () => void;
}

/**
 * Reads one complete node snapshot.
 */
export interface NodeSnapshotReader {
  // prettier-ignore

  /**
   * Reads current membership.
   *
   * @param signal Cancels the read during close.
   * @returns The complete current node snapshot.
   */
  read(signal: AbortSignal): Promise<readonly ApplicationNode[]>;
}

/**
 * Configures scheduled application-node discovery.
 */
export interface ScheduledNodeDiscoveryOptions {
  // prettier-ignore

  /**
   * Reads the current application-node snapshot.
   */
  readonly reader: NodeSnapshotReader;

  /**
   * Schedules refresh ticks when supplied.
   */
  readonly scheduler?: NodeScheduler;

  /**
   * Sets the refresh interval in milliseconds when supplied.
   */
  readonly intervalMs?: number;

  /**
   * Application-owned logger reserved for component-local records. The component
   * does not retain or close the supplied logger.
   */
  readonly logger?: ILogLayer;
}

const systemNodeScheduler: NodeScheduler = {
  schedule(delayMs, onTick) {
    const timer = setTimeout(onTick, delayMs);
    timer.unref();
    return () => {
      clearTimeout(timer);
    };
  },
};

/**
 * Publishes complete snapshots on an injected, cancellable schedule.
 */
export class ScheduledNodeDiscovery implements NodeDiscovery {
  readonly #reader: NodeSnapshotReader;
  readonly #scheduler: NodeScheduler;
  readonly #intervalMs: number;
  readonly #logger: ILogLayer | undefined;
  #cancel: (() => void) | undefined;
  #controller: AbortController | undefined;
  #watcher: ((nodes: readonly ApplicationNode[]) => void) | undefined;
  #refreshing: Promise<void> | undefined;
  #closed = false;

  /**
   * Creates a scheduled source with a ten-second default refresh interval.
   *
   * @param options Supplies the snapshot reader, optional scheduler, and interval.
   */
  constructor(options: ScheduledNodeDiscoveryOptions) {
    if (
      options.intervalMs !== undefined &&
      (!Number.isSafeInteger(options.intervalMs) || options.intervalMs < 1)
    )
      throw new RangeError("Node refresh interval must be a positive safe integer.");
    this.#reader = options.reader;
    this.#scheduler = options.scheduler ?? systemNodeScheduler;
    this.#intervalMs = options.intervalMs ?? 10_000;
    this.#logger = options.logger;
  }

  /**
   * Starts the only scheduled complete-snapshot watch.
   *
   * A second active watch or a watch after `close()` is rejected.
   *
   * @param onSnapshot Receives each successful complete snapshot.
   * @returns Stops scheduling and cancels an in-flight read.
   */
  watch(onSnapshot: (nodes: readonly ApplicationNode[]) => void): () => Promise<void> {
    if (this.#closed) throw new Error("Node discovery is closed.");
    if (this.#watcher !== undefined) throw new Error("Node discovery supports one active watch.");
    this.#watcher = onSnapshot;
    this.#schedule(0);
    return () => this.close();
  }

  /**
   * Stops scheduled refresh work permanently.
   *
   * This operation is idempotent, cancels scheduling, and joins the active
   * snapshot read after requesting its cancellation.
   *
   * @returns Completes after the active read settles.
   */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#cancel?.();
    this.#controller?.abort();
    this.#watcher = undefined;
    await this.#refreshing;
  }

  #schedule(delayMs: number): void {
    this.#cancel = this.#scheduler.schedule(delayMs, () => {
      // spine-log-boundary: deployment.scheduled_discovery_refresh_tail
      this.#refreshing = this.#refresh().catch(() => undefined);
    });
  }

  async #refresh(): Promise<void> {
    if (this.#closed) return;
    const controller = new AbortController();
    this.#controller = controller;
    try {
      const nodes = await this.#reader.read(controller.signal);
      if (!this.#closed) this.#watcher?.([...nodes]);
    } catch {
      if (this.#closed || controller.signal.aborted) return;
      // spine-log-boundary: deployment.scheduled_discovery_refresh
      scheduledDiscoveryLog.warn(this.#logger);
      // Retain the last successful snapshot and retry at the configured interval.
    } finally {
      this.#controller = undefined;
      if (!this.#closed) this.#schedule(this.#intervalMs);
    }
  }
}

/**
 * Publishes mutable static membership for local and combined deployments.
 */
export class StaticNodeDiscovery implements NodeDiscovery {
  #nodes: readonly ApplicationNode[];
  readonly #watchers = new Set<(nodes: readonly ApplicationNode[]) => void>();

  /**
   * Creates a source with an initial complete static node set.
   *
   * @param nodes Supplies the initial complete static node set.
   */
  constructor(nodes: readonly ApplicationNode[]) {
    this.#nodes = [...nodes];
  }

  /**
   * Publishes a replacement complete node set.
   *
   * @param nodes Supplies replacement membership.
   */
  replace(nodes: readonly ApplicationNode[]): void {
    this.#nodes = [...nodes];
    for (const onSnapshot of this.#watchers) onSnapshot([...this.#nodes]);
  }

  /**
   * Starts delivery of current and subsequent complete snapshots.
   *
   * @param onSnapshot Receives the current and subsequent complete snapshots.
   * @returns An operation that removes this snapshot receiver.
   */
  watch(onSnapshot: (nodes: readonly ApplicationNode[]) => void): () => Promise<void> {
    this.#watchers.add(onSnapshot);
    onSnapshot([...this.#nodes]);
    return async () => {
      this.#watchers.delete(onSnapshot);
    };
  }
}
