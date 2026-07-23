import type { InboxMessage, ShardIndex, WorkerId } from "@spine-ts/proto/delivery";

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

  put(message: InboxMessage): boolean {
    const key = messageKey(message);
    const inserted = !this.messages.has(key);
    this.messages.set(key, copyMessage(message));
    return inserted;
  }

  delete(message: InboxMessage): boolean {
    return this.messages.delete(messageKey(message));
  }

  session(shard: ShardIndex): ShardRecord | undefined {
    const record = this.shards.get(shardKey(shard));
    return record?.worker === undefined ? undefined : record;
  }

  setSession(shard: ShardIndex, worker: WorkerId, whenPicked: number): void {
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
    const released = { ...record, worker: undefined };
    this.shards.set(key, released);
    return record;
  }
}
