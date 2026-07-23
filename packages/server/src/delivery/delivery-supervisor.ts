import type { OnDeliveryMessage } from "./delivery.js";
import type { DeliveryOperationOptions } from "./delivery-ports.js";
import { DeliveryRunControl, type DeliveryRunPort } from "./delivery-run-control.js";
import { ShardIndex } from "./shard-index.js";

/** A detached shard update consumed by {@link DeliverySupervisor}. */
export interface DeliveryShardUpdate {
  readonly shard: ShardIndex;
  readonly status: "PICKED" | "NOT_PICKED";
  readonly messages: number;
}

/** Structural remote source required by {@link DeliverySupervisor}. */
export interface DeliverySource {
  shardSnapshot(options?: DeliveryOperationOptions): Promise<readonly DeliveryShardUpdate[]>;
  observeShardUpdates(options?: DeliveryOperationOptions): AsyncIterable<DeliveryShardUpdate>;
  releaseExpired(inactivityMs: number, options?: DeliveryOperationOptions): Promise<readonly unknown[]>;
}

export type { DeliveryOperationOptions } from "./delivery-ports.js";

/** Raised when a supervisor fences still-active delivery after bounded close grace. */
export class DeliveryShutdownTimeoutError extends Error {
  constructor() {
    super("Delivery supervisor shutdown timed out.");
    this.name = "DeliveryShutdownTimeoutError";
  }
}

/** Minimal local delivery port used by the supervisor. */
export type SupervisedDelivery = DeliveryRunPort;

/** Owns bounded local delivery admission and remote shard observation. */
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
  #recovering: Promise<void> | undefined;
  #recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  #watchTimer: ReturnType<typeof setTimeout> | undefined;
  #watchBackoffMs: number;
  #watching = false;
  #releaseConfirmed = false;
  #releaseAttempt: Promise<void> | undefined;
  #closeAttempt: Promise<void> | undefined;

  constructor(options: DeliverySupervisorOptions) {
    this.#source = options.source;
    this.#runs = new DeliveryRunControl(options.delivery);
    this.#onMessage = options.onMessage;
    this.#concurrency = requireBound("Delivery supervisor concurrency", options.concurrency ?? 1);
    this.#pendingLimit = requireBound("Delivery supervisor pending limit", options.pendingLimit ?? 100);
    this.#recoveryMs = requireBound("Delivery supervisor recovery interval", options.recoveryMs ?? 30_000);
    this.#staleMs = requireBound("Delivery supervisor stale session interval", options.staleMs ?? 60_000);
    this.#watchInitialBackoffMs = requireBound(
      "Delivery supervisor watch initial backoff",
      options.watchInitialBackoffMs ?? 100,
    );
    this.#watchMaxBackoffMs = requireBound(
      "Delivery supervisor watch maximum backoff",
      options.watchMaxBackoffMs ?? 30_000,
    );
    if (this.#watchMaxBackoffMs < this.#watchInitialBackoffMs) {
      throw new Error("Delivery supervisor watch maximum backoff must not be smaller than initial backoff.");
    }
    this.#watchBackoffMs = this.#watchInitialBackoffMs;
  }

  /** Start accepting local shard notifications and remote observation. */
  async start(): Promise<void> {
    if (this.#closing || this.#closed) throw new Error("Delivery supervisor is closed.");
    if (this.#started) return;
    this.#started = true;
    await this.#recover();
    this.#scheduleRecovery();
    this.#startWatch();
  }

  /** Coalesce one local or remote notification for a shard. */
  notify(shard: ShardIndex): void {
    if (!this.#started || this.#closing || this.#closed) return;
    const key = shardKey(shard);
    if (this.#active.has(key) || this.#active.size >= this.#concurrency) {
      this.#queue(key, shard);
      return;
    }
    this.#active.add(key);
    void this.#run(shard, key).catch(() => undefined);
  }

  /** Resolve when no admitted or coalesced shard work remains. */
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
   * Stop admission, cancel source activity, and fence active epochs after grace.
   * A failed release cleanup remains checkpointed for a later close call.
   */
  close(options: DeliverySupervisorCloseOptions = {}): Promise<void> {
    if (this.#closed) return Promise.resolve();
    if (this.#closeAttempt !== undefined) return this.#closeAttempt;
    requireGrace(options.graceMs ?? 30_000);
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
        await waitForIdle(this.whenIdle(), graceMs);
      } catch {
        timedOut = true;
      }
    }
    // Abort is the epoch fence and also stops any lease renewal on the controlled path.
    this.#controller.abort(new Error("Delivery supervisor is closed."));
    if (this.#active.size > 0) await this.whenIdle();
    let releaseError: unknown;
    try {
      await this.#releaseOnce(graceMs);
    } catch (error) {
      releaseError = error;
    }
    if (releaseError !== undefined) throw toError(releaseError);
    this.#closed = true;
    if (timedOut) throw new DeliveryShutdownTimeoutError();
  }

  async #releaseOnce(timeoutMs: number): Promise<void> {
    if (this.#releaseConfirmed) return;
    const controller = new AbortController();
    const attempt = this.#source.releaseExpired(this.#staleMs, { signal: controller.signal }).then(() => {
      this.#releaseConfirmed = true;
    });
    this.#releaseAttempt = attempt;
    try {
      await waitForIdle(attempt, timeoutMs);
    } catch (error) {
      controller.abort(new Error("Delivery supervisor release cleanup timed out."));
      void attempt.catch(() => undefined);
      throw error;
    } finally {
      if (this.#releaseAttempt === attempt) this.#releaseAttempt = undefined;
    }
  }

  async #run(shard: ShardIndex, key: string): Promise<void> {
    try {
      await this.#runs.run({ shard, onMessage: this.#onMessage, signal: this.#controller.signal });
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

  #recover(): Promise<void> {
    if (this.#recovering !== undefined) return this.#recovering;
    const recovering = this.#recoverNow().finally(() => {
      this.#recovering = undefined;
    });
    this.#recovering = recovering;
    return recovering;
  }

  async #recoverNow(): Promise<void> {
    if (this.#closing || this.#closed) return;
    try {
      // Release is a mutation: a rejection is not treated as a successful release.
      await this.#source.releaseExpired(this.#staleMs, { signal: this.#sourceController.signal });
      const shards = await this.#source.shardSnapshot({ signal: this.#sourceController.signal });
      for (const shard of shards) {
        if (shard.status === "NOT_PICKED" && shard.messages > 0) this.notify(shard.shard);
      }
    } catch {
      // A later bounded recovery retries; no unknown mutation outcome is assumed successful.
    }
  }

  #scheduleRecovery(): void {
    if (this.#closing || this.#closed || this.#recoveryTimer !== undefined) return;
    this.#recoveryTimer = setTimeout(() => {
      this.#recoveryTimer = undefined;
      void this.#recover().finally(() => {
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
      for await (const shard of this.#source.observeShardUpdates({ signal: this.#sourceController.signal })) {
        if (this.#closing || this.#closed) return;
        this.#watchBackoffMs = this.#watchInitialBackoffMs;
        if (shard.status === "NOT_PICKED" && shard.messages > 0) this.notify(shard.shard);
      }
      failed = !this.#closing && !this.#closed;
    } catch {
      failed = !this.#closing && !this.#closed;
    } finally {
      this.#watching = false;
      if (failed) this.#scheduleWatchRestart();
    }
  }

  #scheduleWatchRestart(): void {
    if (this.#closing || this.#closed || this.#watchTimer !== undefined) return;
    const delay = this.#watchBackoffMs;
    this.#watchBackoffMs = Math.min(this.#watchMaxBackoffMs, delay * 2);
    this.#watchTimer = setTimeout(() => {
      this.#watchTimer = undefined;
      this.#startWatch();
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
}

/** Construction options for {@link DeliverySupervisor}. */
export interface DeliverySupervisorOptions {
  readonly source: DeliverySource;
  readonly delivery: SupervisedDelivery;
  readonly onMessage: OnDeliveryMessage;
  readonly concurrency?: number;
  readonly pendingLimit?: number;
  readonly recoveryMs?: number;
  readonly staleMs?: number;
  /** Initial bounded delay before reconnecting a completed or failed watch. */
  readonly watchInitialBackoffMs?: number;
  /** Maximum bounded delay before reconnecting a completed or failed watch. */
  readonly watchMaxBackoffMs?: number;
}

/** Bounded close controls for {@link DeliverySupervisor}. */
export interface DeliverySupervisorCloseOptions {
  /** Milliseconds to await active work before it is fenced from future outcomes. */
  readonly graceMs?: number;
}

function shardKey(shard: ShardIndex): string {
  return `${String(shard.index)}/${String(shard.ofTotal)}`;
}

function requireBound(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer.`);
  return value;
}

function requireGrace(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Delivery close grace must be a safe integer.");
}

function waitForIdle(idle: Promise<void>, graceMs: number): Promise<void> {
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

function toError(error: unknown): Error {
  if (error instanceof DeliveryShutdownTimeoutError) return error;
  return new Error("Delivery supervisor release cleanup failed.");
}
