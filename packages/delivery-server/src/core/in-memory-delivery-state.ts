import { Code, ConnectError } from "@connectrpc/connect";
import type { InboxMessage, ShardIndex, WorkerId } from "@spine-ts/proto/delivery";

import { type DeliveryStateLimits, resolveStateLimits } from "./limits.js";
import { copyMessage, copyShard, copyWorker, messageKey, shardKey } from "./wire-values.js";

export interface ShardRecord {
  readonly shard: ShardIndex;
  readonly worker: WorkerId | undefined;
  readonly whenLastPicked: number | undefined;
}

/** Package-private canonical detached state; a new instance deliberately starts empty. */
export class InMemoryDeliveryState {
  readonly messages: Map<string, InboxMessage> = new Map<string, InboxMessage>();
  readonly shards: Map<string, ShardRecord> = new Map<string, ShardRecord>();
  readonly #messageBytes = new Map<string, number>();
  readonly #messageShards = new Map<string, number>();
  readonly #limits: DeliveryStateLimits;
  #retainedBytes = 0;

  constructor(limits: Partial<DeliveryStateLimits> = {}) {
    this.#limits = resolveStateLimits(limits);
  }

  putAll(
    messages: readonly { readonly message: InboxMessage; readonly bytes: number }[],
  ): InboxMessage[] {
    this.#ensureCapacity(messages);
    const initial = new Set(this.messages.keys());
    const inserted: InboxMessage[] = [];
    const seen = new Set<string>();
    const final = new Map<string, { readonly message: InboxMessage; readonly bytes: number }>();
    for (const candidate of messages) {
      const key = messageKey(candidate.message);
      if (!initial.has(key) && !seen.has(key)) inserted.push(candidate.message);
      seen.add(key);
      final.set(key, candidate);
    }
    for (const [key, candidate] of final) this.#replace(key, candidate.message, candidate.bytes);
    return inserted;
  }

  delete(message: InboxMessage): boolean {
    const key = messageKey(message);
    const current = this.messages.get(key);
    if (current === undefined) return false;
    this.messages.delete(key);
    this.#retainedBytes -= this.#messageBytes.get(key) ?? 0;
    this.#messageBytes.delete(key);
    this.#decrementMessageShard(current);
    this.#pruneReleasedShard(shardKey(requiredShard(current)));
    return true;
  }

  session(shard: ShardIndex): ShardRecord | undefined {
    const record = this.shards.get(shardKey(shard));
    return record?.worker === undefined ? undefined : record;
  }

  setSession(shard: ShardIndex, worker: WorkerId, whenPicked: number): void {
    this.#ensureShardCapacity(shard);
    this.shards.set(shardKey(shard), {
      shard: copyShard(shard),
      worker: copyWorker(worker),
      whenLastPicked: whenPicked,
    });
  }

  release(shard: ShardIndex): ShardRecord | undefined {
    const key = shardKey(shard);
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
    for (const candidate of candidates) final.set(messageKey(candidate.message), candidate);
    let count = this.messages.size;
    let bytes = this.#retainedBytes;
    const tracked = new Set<string>([...this.shards.keys(), ...this.#messageShards.keys()]);
    for (const [key, candidate] of final) {
      const prior = this.messages.get(key);
      if (prior === undefined) count++;
      else bytes -= this.#messageBytes.get(key) ?? 0;
      bytes += candidate.bytes;
      tracked.add(shardKey(requiredShard(candidate.message)));
    }
    if (
      count > this.#limits.maxRetainedMessages ||
      bytes > this.#limits.maxRetainedBytes ||
      tracked.size > this.#limits.maxTrackedShards
    ) {
      throw exhausted("Delivery retained-state capacity is full.");
    }
  }

  #replace(key: string, message: InboxMessage, bytes: number): void {
    const prior = this.messages.get(key);
    if (prior !== undefined) {
      this.#retainedBytes -= this.#messageBytes.get(key) ?? 0;
      this.#decrementMessageShard(prior);
    }
    this.messages.set(key, copyMessage(message));
    this.#messageBytes.set(key, bytes);
    this.#retainedBytes += bytes;
    const shard = shardKey(requiredShard(message));
    this.#messageShards.set(shard, (this.#messageShards.get(shard) ?? 0) + 1);
  }

  #decrementMessageShard(message: InboxMessage): void {
    const key = shardKey(requiredShard(message));
    const count = this.#messageShards.get(key);
    if (count === undefined || count < 1)
      throw new TypeError("Delivery message shard count is invalid.");
    if (count === 1) this.#messageShards.delete(key);
    else this.#messageShards.set(key, count - 1);
  }

  #ensureShardCapacity(shard: ShardIndex): void {
    const key = shardKey(shard);
    if (this.shards.has(key) || this.#messageShards.has(key)) return;
    const tracked = new Set<string>([...this.shards.keys(), ...this.#messageShards.keys()]);
    if (tracked.size >= this.#limits.maxTrackedShards)
      throw exhausted("Delivery tracked-shard capacity is full.");
  }

  #pruneReleasedShard(key: string): void {
    if (!this.#messageShards.has(key) && this.shards.get(key)?.worker === undefined)
      this.shards.delete(key);
  }
}

function requiredShard(message: InboxMessage): ShardIndex {
  if (message.id?.index === undefined) throw new TypeError("Delivery message identity is missing.");
  return message.id.index;
}

function exhausted(message: string): ConnectError {
  return new ConnectError(message, Code.ResourceExhausted);
}
