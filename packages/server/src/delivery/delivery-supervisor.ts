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

import type { OnDeliveryMessage } from "./delivery.js";
import type { InboxMessage } from "./inbox.js";
import type { Delivery } from "./delivery-builder.js";
import type { DeliveryOperationOptions } from "./delivery-ports.js";
import { DeliveryRunControl } from "./delivery-run-control.js";
import { ShardIndex } from "./shard-index.js";
import type { ILogLayer } from "loglayer";

import { emitServerWarning } from "../server/server-log.js";

const deliverySupervisorLoggers = new WeakMap<DeliverySupervisor, ILogLayer>();
const deliverySupervisorAdmissions = new WeakMap<
  DeliverySupervisor,
  (message: InboxMessage) => boolean
>();
const deliverySupervisorFinalizers = new WeakMap<DeliverySupervisor, (shard: ShardIndex) => void>();
const deliverySupervisors = new WeakSet<DeliverySupervisor>();

interface DeliverySupervisorAccess {
  installLogger(supervisor: DeliverySupervisor, logger: ILogLayer): void;
  loggerFor(supervisor: DeliverySupervisor): ILogLayer;
  installAdmission(
    supervisor: DeliverySupervisor,
    admission: (message: InboxMessage) => boolean,
  ): void;
  installFinalization(
    supervisor: DeliverySupervisor,
    onRunSettled: (shard: ShardIndex) => void,
  ): void;
}

/**
 * A detached shard update consumed by {@link DeliverySupervisor}.
 */
export interface DeliveryShardUpdate {
  // prettier-ignore

  /**
   * Shard whose detached delivery status changed.
   */
  readonly shard: ShardIndex;

  /**
   * Current remote pickup state used for fail-closed admission.
   */
  readonly status: "PICKED" | "NOT_PICKED";

  /**
   * Non-negative remote message count; only positive counts are admitted.
   */
  readonly messages: number;
}

/**
 * Structural remote source required by {@link DeliverySupervisor}.
 */
export interface DeliverySource {
  // prettier-ignore

  /**
   * Reads one detached shard snapshot for startup or recovery.
   * The optional signal/deadline controls this read only; cancellation is cooperative.
   *
   * @param options Optional cancellation and deadline controls.
   * @returns The detached shard updates.
   */
  shardSnapshot(options?: DeliveryOperationOptions): Promise<readonly DeliveryShardUpdate[]>;

  /**
   * Observes detached Admin shard updates until completion, cancellation, or failure.
   * The supervisor owns bounded reconnect and passes its lifecycle signal.
   *
   * @param options Optional cancellation and deadline controls.
   * @returns The stream of detached shard updates.
   */
  observeShardUpdates(options?: DeliveryOperationOptions): AsyncIterable<DeliveryShardUpdate>;

  /**
   * Deletes sessions older than `inactivityMs` as one non-retried mutation.
   * Rejection or timeout is never treated as successful release.
   *
   * @param inactivityMs The stale-session age in milliseconds.
   * @param options Optional cancellation and deadline controls.
   * @returns Facts about the released sessions.
   */
  releaseExpired(
    inactivityMs: number,
    options?: DeliveryOperationOptions,
  ): Promise<readonly unknown[]>;
}

export type { DeliveryOperationOptions } from "./delivery-ports.js";

/**
 * Raised when active delivery or release cleanup exceeds its bounded close phase.
 */
export class DeliveryShutdownTimeoutError extends Error {
  // prettier-ignore

  /**
   * Creates the bounded-shutdown timeout error.
   */
  constructor() {
    super("Delivery supervisor shutdown timed out.");
    this.name = "DeliveryShutdownTimeoutError";
  }
}

/**
 * Public builder-owned delivery accepted by the supervisor.
 * Runtime validation accepts only identities created by {@link DeliveryBuilder}.
 */
export type SupervisedDelivery = Delivery;

/**
 * Admits bounded local delivery and observes remote shards.
 */
export class DeliverySupervisor {
  readonly #source: DeliverySource;
  readonly #runs: DeliveryRunControl;
  readonly #onMessage: OnDeliveryMessage;
  readonly #concurrency: number;
  readonly #pendingLimit: number;
  readonly #recoveryMs: number;
  readonly #staleMs: number;
  readonly #watchInitialBackoffMs: number;
  readonly #watchMaxBackoffMs: number;
  readonly #pending = new Map<string, ShardIndex>();
  readonly #active = new Set<string>();
  readonly #idle = new Set<() => undefined>();
  readonly #controller = new AbortController();
  readonly #sourceController = new AbortController();
  #started = false;
  #closing = false;
  #closed = false;
  #rescanRequired = false;
  #recovering: Promise<boolean> | undefined;
  #recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  #watchTimer: ReturnType<typeof setTimeout> | undefined;
  #watchBackoffMs: number;
  #watching = false;
  #releaseConfirmed = false;
  #releaseAttempt: Promise<void> | undefined;
  #closeAttempt: Promise<void> | undefined;

  /**
   * Creates a bounded delivery supervisor.
   *
   * @param options The source, delivery, endpoint, and bounds.
   */
  constructor(options: DeliverySupervisorOptions) {
    deliverySupervisors.add(this);
    this.#source = options.source;
    this.#runs = new DeliveryRunControl(options.delivery);
    this.#onMessage = options.onMessage;
    this.#concurrency = DeliverySupervisor.#requireBound(
      "Delivery supervisor concurrency",
      options.concurrency ?? 1,
    );
    this.#pendingLimit = DeliverySupervisor.#requireBound(
      "Delivery supervisor pending limit",
      options.pendingLimit ?? 100,
    );
    this.#recoveryMs = DeliverySupervisor.#requireBound(
      "Delivery supervisor recovery interval",
      options.recoveryMs ?? 30_000,
    );
    this.#staleMs = DeliverySupervisor.#requireBound(
      "Delivery supervisor stale session interval",
      options.staleMs ?? 60_000,
    );
    this.#watchInitialBackoffMs = DeliverySupervisor.#requireBound(
      "Delivery supervisor watch initial backoff",
      options.watchInitialBackoffMs ?? 100,
    );
    this.#watchMaxBackoffMs = DeliverySupervisor.#requireBound(
      "Delivery supervisor watch maximum backoff",
      options.watchMaxBackoffMs ?? 30_000,
    );
    if (this.#watchMaxBackoffMs < this.#watchInitialBackoffMs) {
      throw new Error(
        "Delivery supervisor watch maximum backoff must not be smaller than initial backoff.",
      );
    }
    this.#watchBackoffMs = this.#watchInitialBackoffMs;
  }

  /**
   * Starts initial stale release and snapshot recovery, then accepts notifications and observation.
   * Repeated successful calls are idempotent; starting after close is rejected.
   *
   * @returns A promise that resolves after recovery and observation start.
   */
  async start(): Promise<void> {
    if (this.#closing || this.#closed) throw new Error("Delivery supervisor is closed.");
    if (this.#started) return;
    this.#started = true;
    const recovered = await this.#recover();
    this.#scheduleRecovery();
    if (recovered) this.#startWatch();
  }

  /**
   * Queues one local or remote notification for a shard.
   * Calls before start or after close are ignored; capacity overflow requests one rescan.
   *
   * @param shard The shard whose work may be scheduled.
   */
  notify(shard: ShardIndex): void {
    if (!this.#started || this.#closing || this.#closed) return;
    const key = DeliverySupervisor.#shardKey(shard);
    if (this.#active.has(key) || this.#active.size >= this.#concurrency) {
      this.#queue(key, shard);
      return;
    }
    this.#active.add(key);
    // spine-log-boundary: server.delivery_run_terminal
    void this.#run(shard, key).catch(() => undefined);
  }

  /**
   * Resolves when no active or retained pending shard work remains.
   *
   * @returns A promise that resolves when the supervisor is idle.
   *
   */
  whenIdle(): Promise<void> {
    if (this.#active.size === 0 && this.#pending.size === 0) return Promise.resolve();
    const gate = Promise.withResolvers<undefined>();
    this.#idle.add(() => {
      gate.resolve(undefined);
      return undefined;
    });
    return gate.promise;
  }

  /**
   * Stops admission and source activity, waits one bounded active-work grace phase, then fences runs.
   * A separate release-cleanup phase uses the same bound. Cleanup failure takes precedence over
   * an active-work timeout; incomplete cleanup is retained for a later close retry.
   *
   * @param options The bounded close controls.
   * @returns A promise that settles after close cleanup completes.
   */
  close(options: DeliverySupervisorCloseOptions = {}): Promise<void> {
    if (this.#closed) return Promise.resolve();
    if (this.#closeAttempt !== undefined) return this.#closeAttempt;
    DeliverySupervisor.#requireGrace(options.graceMs ?? 30_000);
    this.#closing = true;
    this.#pending.clear();
    this.#cancelTimers();
    this.#sourceController.abort(new Error("Delivery supervisor source activity is closed."));
    const attempt = this.#closeNow(options.graceMs ?? 30_000).finally(() => {
      this.#closeAttempt = undefined;
    });
    this.#closeAttempt = attempt;
    return attempt;
  }

  async #closeNow(graceMs: number): Promise<void> {
    let timedOut = false;
    if (this.#active.size > 0) {
      try {
        await DeliverySupervisor.#waitForIdle(this.whenIdle(), graceMs);
      } catch {
        timedOut = true;
      }
    }
    // Abort is the epoch fence and also stops any lease renewal on the controlled path.
    this.#controller.abort(new Error("Delivery supervisor is closed."));
    let releaseError: unknown;
    try {
      await this.#releaseOnce(graceMs);
    } catch (error) {
      releaseError = error;
    }
    if (releaseError !== undefined) throw DeliverySupervisor.#releaseError(releaseError);
    if (this.#active.size > 0) await this.whenIdle();
    this.#closed = true;
    deliverySupervisorLoggers.delete(this);
    if (timedOut) throw new DeliveryShutdownTimeoutError();
  }

  async #releaseOnce(timeoutMs: number): Promise<void> {
    if (this.#releaseConfirmed) return;
    const controller = new AbortController();
    const attempt = this.#releaseExpired({ signal: controller.signal }).then(() => {
      this.#releaseConfirmed = true;
    });
    try {
      await DeliverySupervisor.#waitForIdle(attempt, timeoutMs);
    } catch (error) {
      controller.abort(new Error("Delivery supervisor release cleanup timed out."));
      // spine-log-boundary: server.delivery_release_timeout_observer
      void attempt.catch(() => undefined);
      throw error;
    }
  }

  #releaseExpired(options: DeliveryOperationOptions): Promise<void> {
    const active = this.#releaseAttempt;
    if (active !== undefined) return active;
    const attempt = this.#source.releaseExpired(this.#staleMs, options).then(() => undefined);
    this.#releaseAttempt = attempt;
    // spine-log-boundary: server.delivery_release_reset_observer
    void attempt
      .finally(() => {
        if (this.#releaseAttempt === attempt) this.#releaseAttempt = undefined;
      })
      .catch(() => undefined);
    return attempt;
  }

  async #run(shard: ShardIndex, key: string): Promise<void> {
    try {
      const admission = deliverySupervisorAdmissions.get(this);
      const finalization = deliverySupervisorFinalizers.get(this);
      await this.#runs.run({
        shard,
        onMessage: this.#onMessage,
        ...(admission === undefined ? {} : { acceptMessage: admission }),
        ...(finalization === undefined
          ? {}
          : {
              onRunSettled: () => {
                finalization(shard);
              },
            }),
        signal: this.#controller.signal,
      });
    } finally {
      this.#active.delete(key);
      this.#startNext(key);
      this.#settleIdle();
    }
  }

  #settleIdle(): void {
    if (this.#active.size !== 0 || this.#pending.size !== 0) return;
    for (const resolve of this.#idle) resolve();
    this.#idle.clear();
  }

  #recover(): Promise<boolean> {
    if (this.#recovering !== undefined) return this.#recovering;
    const recovering = this.#recoverNow().finally(() => {
      this.#recovering = undefined;
    });
    this.#recovering = recovering;
    return recovering;
  }

  async #recoverNow(): Promise<boolean> {
    if (this.#closing || this.#closed) return false;
    try {
      // Release is a mutation: a rejection is not treated as a successful release.
      await this.#releaseExpired({ signal: this.#sourceController.signal });
      const shards = await this.#source.shardSnapshot({ signal: this.#sourceController.signal });
      for (const shard of shards) {
        if (shard.status === "NOT_PICKED" && shard.messages > 0) this.notify(shard.shard);
      }
      return true;
      // spine-log-boundary: server.delivery_recovery_failure
    } catch {
      // A later bounded recovery retries; no unknown mutation outcome is assumed successful.
      if (!this.#isClosing()) this.#warnRecoveryFailure();
      return false;
    }
  }

  #warnRecoveryFailure(): void {
    const logger = deliverySupervisorLoggers.get(this);
    if (logger === undefined) return;
    emitServerWarning(logger, "Delivery recovery failed.", {
      operation: "delivery.recovery",
      reasonCode: "failed",
    });
  }

  #isClosing(): boolean {
    return this.#closing || this.#closed;
  }

  #scheduleRecovery(): void {
    if (this.#closing || this.#closed || this.#recoveryTimer !== undefined) return;
    this.#recoveryTimer = setTimeout(() => {
      this.#recoveryTimer = undefined;
      void this.#recover().then((recovered) => {
        if (recovered) this.#startWatch();
        this.#scheduleRecovery();
      });
    }, this.#recoveryMs);
    this.#recoveryTimer.unref();
  }

  #startWatch(): void {
    if (this.#closing || this.#closed || this.#watching) return;
    this.#watching = true;
    void this.#watch();
  }

  async #watch(): Promise<void> {
    let failed = false;
    try {
      for await (const shard of this.#source.observeShardUpdates({
        signal: this.#sourceController.signal,
      })) {
        if (this.#closing || this.#closed) return;
        this.#watchBackoffMs = this.#watchInitialBackoffMs;
        if (shard.status === "NOT_PICKED" && shard.messages > 0) this.notify(shard.shard);
      }
      failed = !this.#closing && !this.#closed;
      // spine-log-boundary: server.delivery_watch_failure
    } catch {
      failed = !this.#closing && !this.#closed;
    } finally {
      this.#watching = false;
      if (failed) {
        this.#warnWatchFailure();
        this.#scheduleWatchRestart();
      }
    }
  }

  #warnWatchFailure(): void {
    const logger = deliverySupervisorLoggers.get(this);
    if (logger === undefined) return;
    emitServerWarning(logger, "Delivery shard watch failed.", {
      operation: "delivery.watch",
      reasonCode: "failed",
    });
  }

  #scheduleWatchRestart(): void {
    if (this.#closing || this.#closed || this.#watchTimer !== undefined) return;
    const delay = this.#watchBackoffMs;
    this.#watchBackoffMs = Math.min(this.#watchMaxBackoffMs, delay * 2);
    this.#watchTimer = setTimeout(() => {
      this.#watchTimer = undefined;
      void this.#recover().then((recovered) => {
        if (recovered) this.#startWatch();
        else this.#scheduleWatchRestart();
      });
    }, delay);
    this.#watchTimer.unref();
  }

  #cancelTimers(): void {
    if (this.#recoveryTimer !== undefined) clearTimeout(this.#recoveryTimer);
    if (this.#watchTimer !== undefined) clearTimeout(this.#watchTimer);
    this.#recoveryTimer = undefined;
    this.#watchTimer = undefined;
  }

  #queue(key: string, shard: ShardIndex): void {
    if (this.#pending.has(key)) return;
    if (this.#pending.size >= this.#pendingLimit) {
      this.#rescanRequired = true;
      return;
    }
    this.#pending.set(key, shard);
  }

  #startNext(completed: string): void {
    if (this.#closing || this.#closed) return;
    const repeat = this.#pending.get(completed);
    if (repeat !== undefined) {
      this.#pending.delete(completed);
      this.notify(repeat);
    }
    while (this.#active.size < this.#concurrency) {
      const next = this.#pending.entries().next().value;
      if (next === undefined) break;
      this.#pending.delete(next[0]);
      this.notify(next[1]);
    }
    if (this.#rescanRequired) {
      this.#rescanRequired = false;
      void this.#recover();
    }
  }

  static #shardKey(shard: ShardIndex): string {
    return `${String(shard.index)}/${String(shard.ofTotal)}`;
  }

  static #requireBound(name: string, value: number): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive safe integer.`);
    }
    return value;
  }

  static #requireGrace(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Delivery close grace must be a safe integer.");
    }
  }

  static #waitForIdle(idle: Promise<void>, graceMs: number): Promise<void> {
    if (graceMs === 0) return Promise.reject(new DeliveryShutdownTimeoutError());
    const timeout = Promise.withResolvers<undefined>();
    const timer = setTimeout(() => {
      timeout.reject(new DeliveryShutdownTimeoutError());
    }, graceMs);
    timer.unref();
    return Promise.race([idle, timeout.promise]).finally(() => {
      clearTimeout(timer);
    });
  }

  static #releaseError(error: unknown): Error {
    if (error instanceof DeliveryShutdownTimeoutError) return error;
    return new Error("Delivery supervisor release cleanup failed.");
  }
}

/**
 * Exposes framework-only delivery supervisor metadata installation.
 *
 * @internal
 */
export const deliverySupervisorAccess: DeliverySupervisorAccess = Object.freeze({
  installLogger(supervisor: DeliverySupervisor, logger: ILogLayer): void {
    if (!deliverySupervisors.has(supervisor)) {
      throw new TypeError("Delivery supervisor logger requires a DeliverySupervisor instance.");
    }
    deliverySupervisorLoggers.set(supervisor, logger);
  },

  loggerFor(supervisor: DeliverySupervisor): ILogLayer {
    if (!deliverySupervisors.has(supervisor)) {
      throw new TypeError("Delivery supervisor logger requires a DeliverySupervisor instance.");
    }
    const logger = deliverySupervisorLoggers.get(supervisor);
    if (logger === undefined) {
      throw new TypeError("Delivery supervisor logger is not installed.");
    }
    return logger;
  },

  installAdmission(
    supervisor: DeliverySupervisor,
    admission: (message: InboxMessage) => boolean,
  ): void {
    if (!deliverySupervisors.has(supervisor)) {
      throw new TypeError("Delivery supervisor admission requires a DeliverySupervisor instance.");
    }
    deliverySupervisorAdmissions.set(supervisor, admission);
  },

  installFinalization(
    supervisor: DeliverySupervisor,
    onRunSettled: (shard: ShardIndex) => void,
  ): void {
    if (!deliverySupervisors.has(supervisor)) {
      throw new TypeError(
        "Delivery supervisor finalization requires a DeliverySupervisor instance.",
      );
    }
    deliverySupervisorFinalizers.set(supervisor, onRunSettled);
  },
});

/**
 * Construction options for {@link DeliverySupervisor}.
 */
export interface DeliverySupervisorOptions {
  // prettier-ignore

  /**
   * Structural Admin source; mutable releases are serialized and never blindly retried.
   */
  readonly source: DeliverySource;

  /**
   * Delivery returned by {@link DeliveryBuilder.build}; forged lookalike ports are rejected.
   */
  readonly delivery: SupervisedDelivery;

  /**
   * Framework endpoint invoked for each supported admitted delivery row.
   */
  readonly onMessage: OnDeliveryMessage;

  /**
   * Positive safe-integer active-shard limit. Defaults to `1`.
   */
  readonly concurrency?: number;

  /**
   * Positive safe-integer retained pending-shard limit. Defaults to `100`.
   */
  readonly pendingLimit?: number;

  /**
   * Positive safe-integer periodic recovery delay in milliseconds. Defaults to `30000`.
   */
  readonly recoveryMs?: number;

  /**
   * Positive safe-integer stale-session age in milliseconds. Defaults to `60000`.
   */
  readonly staleMs?: number;

  /**
   * Positive safe-integer initial watch reconnect delay. Defaults to `100` milliseconds.
   */
  readonly watchInitialBackoffMs?: number;

  /**
   * Positive safe-integer maximum watch reconnect delay. Defaults to `30000` milliseconds and
   * must not be smaller than `watchInitialBackoffMs`.
   */
  readonly watchMaxBackoffMs?: number;
}

/**
 * Bounded close controls for {@link DeliverySupervisor}.
 */
export interface DeliverySupervisorCloseOptions {
  // prettier-ignore

  /**
   * Non-negative safe-integer bound used separately for active work and release cleanup.
   * Defaults to `30000` milliseconds. A zero value fences without waiting.
   */
  readonly graceMs?: number;
}
