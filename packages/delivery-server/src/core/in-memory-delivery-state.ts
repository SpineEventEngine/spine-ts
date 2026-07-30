import { Code, ConnectError } from "@connectrpc/connect";
import type { InboxMessage, ShardIndex, WorkerId } from "@spine-event-engine/proto/delivery";

import { DeliveryLimits, type DeliveryStateLimits } from "./limits.js";
import { DeliveryMessages, DeliveryShards, DeliveryWorkers } from "./wire-values.js";

/** Represents retained pickup state for one delivery shard. */
export interface ShardRecord {
  /** Identifies the tracked shard. */
  readonly shard: ShardIndex;
  /** Identifies the current worker when picked. */
  readonly worker: WorkerId | undefined;
  /** Records the pickup time in milliseconds. */
  readonly whenLastPicked: number | undefined;
}

/** Package-private canonical detached state; a new instance deliberately starts empty. */
export class InMemoryDeliveryState {
  /** Stores messages by stable identity. */
  readonly messages: Map<string, InboxMessage> = new Map<string, InboxMessage>();
  /** Stores sessions by stable shard identity. */
  readonly shards: Map<string, ShardRecord> = new Map<string, ShardRecord>();
  readonly #messageBytes = new Map<string, number>();
  readonly #messageShards = new Map<string, number>();
  readonly #limits: DeliveryStateLimits;
  #retainedBytes = 0;

  /** Creates empty state.
   * @param limits Configures retained-state limits.
   */
  constructor(limits: Partial<DeliveryStateLimits> = {}) {
    this.#limits = DeliveryLimits.resolve(limits);
  }

  /** Stores a validated batch atomically.
   * @param messages Supplies encoded messages.
   * @returns Lists newly inserted messages.
   */
  putAll(
    messages: readonly { readonly message: InboxMessage; readonly bytes: number }[],
  ): InboxMessage[] {
    this.#ensureCapacity(messages);
    const initial = new Set(this.messages.keys());
    const inserted: InboxMessage[] = [];
    const seen = new Set<string>();
    const final = new Map<string, { readonly message: InboxMessage; readonly bytes: number }>();
    for (const candidate of messages) {
      const key = DeliveryMessages.key(candidate.message);
      if (!initial.has(key) && !seen.has(key)) inserted.push(candidate.message);
      seen.add(key);
      final.set(key, candidate);
    }
    for (const [key, candidate] of final) this.#replace(key, candidate.message, candidate.bytes);
    return inserted;
  }

  /** Deletes a message.
   * @param message Identifies the message.
   * @returns Reports whether the message existed.
   */
  delete(message: InboxMessage): boolean {
    const key = DeliveryMessages.key(message);
    const current = this.messages.get(key);
    if (current === undefined) return false;
    this.messages.delete(key);
    this.#retainedBytes -= this.#messageBytes.get(key) ?? 0;
    this.#messageBytes.delete(key);
    this.#decrementMessageShard(current);
    this.#pruneReleasedShard(DeliveryShards.key(this.#requiredShard(current)));
    return true;
  }

  /** Finds an active shard session.
   * @param shard Identifies the shard.
   * @returns Provides the session when active.
   */
  session(shard: ShardIndex): ShardRecord | undefined {
    const record = this.shards.get(DeliveryShards.key(shard));
    return record?.worker === undefined ? undefined : record;
  }

  /** Stores a shard pickup session.
   * @param shard Identifies the shard.
   * @param worker Identifies the worker.
   * @param whenPicked Records the pickup time.
   */
  setSession(shard: ShardIndex, worker: WorkerId, whenPicked: number): void {
    this.#ensureShardCapacity(shard);
    this.shards.set(DeliveryShards.key(shard), {
      shard: DeliveryShards.copy(shard),
      worker: DeliveryWorkers.copy(worker),
      whenLastPicked: whenPicked,
    });
  }

  /** Removes an active shard session.
   * @param shard Identifies the shard.
   * @returns Provides the former session when active.
   */
  release(shard: ShardIndex): ShardRecord | undefined {
    const key = DeliveryShards.key(shard);
    const record = this.shards.get(key);
    if (record?.worker === undefined) return undefined;
    if (this.#messageShards.has(key)) this.shards.set(key, { ...record, worker: undefined });
    else this.shards.delete(key);
    return record;
  }

  #ensureCapacity(
    candidates: readonly { readonly message: InboxMessage; readonly bytes: number }[],
  ): void {
    const final = new Map<string, { readonly message: InboxMessage; readonly bytes: number }>();
    for (const candidate of candidates)
      final.set(DeliveryMessages.key(candidate.message), candidate);
    let count = this.messages.size;
    let bytes = this.#retainedBytes;
    const tracked = new Set<string>([...this.shards.keys(), ...this.#messageShards.keys()]);
    for (const [key, candidate] of final) {
      const prior = this.messages.get(key);
      if (prior === undefined) count++;
      else bytes -= this.#messageBytes.get(key) ?? 0;
      bytes += candidate.bytes;
      tracked.add(DeliveryShards.key(this.#requiredShard(candidate.message)));
    }
    if (
      count > this.#limits.maxRetainedMessages ||
      bytes > this.#limits.maxRetainedBytes ||
      tracked.size > this.#limits.maxTrackedShards
    ) {
      throw new ConnectError("Delivery retained-state capacity is full.", Code.ResourceExhausted);
    }
  }

  #replace(key: string, message: InboxMessage, bytes: number): void {
    const prior = this.messages.get(key);
    if (prior !== undefined) {
      this.#retainedBytes -= this.#messageBytes.get(key) ?? 0;
      this.#decrementMessageShard(prior);
    }
    this.messages.set(key, DeliveryMessages.copy(message));
    this.#messageBytes.set(key, bytes);
    this.#retainedBytes += bytes;
    const shard = DeliveryShards.key(this.#requiredShard(message));
    this.#messageShards.set(shard, (this.#messageShards.get(shard) ?? 0) + 1);
  }

  #decrementMessageShard(message: InboxMessage): void {
    const key = DeliveryShards.key(this.#requiredShard(message));
    const count = this.#messageShards.get(key);
    if (count === undefined || count < 1)
      throw new TypeError("Delivery message shard count is invalid.");
    if (count === 1) this.#messageShards.delete(key);
    else this.#messageShards.set(key, count - 1);
  }

  #ensureShardCapacity(shard: ShardIndex): void {
    const key = DeliveryShards.key(shard);
    if (this.shards.has(key) || this.#messageShards.has(key)) return;
    const tracked = new Set<string>([...this.shards.keys(), ...this.#messageShards.keys()]);
    if (tracked.size >= this.#limits.maxTrackedShards)
      throw new ConnectError("Delivery tracked-shard capacity is full.", Code.ResourceExhausted);
  }

  #pruneReleasedShard(key: string): void {
    if (!this.#messageShards.has(key) && this.shards.get(key)?.worker === undefined)
      this.shards.delete(key);
  }

  #requiredShard(message: InboxMessage): ShardIndex {
    if (message.id?.index === undefined)
      throw new TypeError("Delivery message identity is missing.");
    return message.id.index;
  }
}
