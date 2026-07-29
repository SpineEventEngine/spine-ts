import { clone } from "@bufbuild/protobuf";
import {
  InboxMessageSchema,
  ShardIndexSchema,
  WorkerIdSchema,
  type InboxMessage,
  type ShardIndex,
  type WorkerId,
} from "@spine-event-engine/proto/delivery";

/** Provides canonical detached delivery message values. */
export const DeliveryMessages: Readonly<{
  key(message: InboxMessage): string;
  copy(message: InboxMessage): InboxMessage;
}> = Object.freeze({
  /** Returns the stable key for a message identity. */
  key(message: InboxMessage): string {
    if (message.id?.index === undefined)
      throw new TypeError("Delivery message identity is missing.");
    return `${DeliveryShards.key(message.id.index)}:${message.id.uuid}`;
  },
  /** Returns a detached message clone. */
  copy(message: InboxMessage): InboxMessage {
    return clone(InboxMessageSchema, message);
  },
});

/** Provides canonical detached delivery shard values. */
export const DeliveryShards: Readonly<{
  key(shard: ShardIndex): string;
  copy(shard: ShardIndex): ShardIndex;
}> = Object.freeze({
  /** Returns the stable key for a shard. */
  key(shard: ShardIndex): string {
    return `${String(shard.index)}/${String(shard.ofTotal)}`;
  },
  /** Returns a detached shard clone. */
  copy(shard: ShardIndex): ShardIndex {
    return clone(ShardIndexSchema, shard);
  },
});

/** Provides canonical detached delivery worker values. */
export const DeliveryWorkers: Readonly<{ copy(worker: WorkerId): WorkerId }> = Object.freeze({
  /** Returns a detached worker clone. */
  copy(worker: WorkerId): WorkerId {
    return clone(WorkerIdSchema, worker);
  },
});
