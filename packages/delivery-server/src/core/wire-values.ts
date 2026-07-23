import { clone } from "@bufbuild/protobuf";
import {
  InboxMessageSchema,
  ShardIndexSchema,
  WorkerIdSchema,
  type InboxMessage,
  type ShardIndex,
  type WorkerId,
} from "@spine-ts/proto/delivery";

export function shardKey(shard: ShardIndex): string {
  return `${String(shard.index)}/${String(shard.ofTotal)}`;
}

export function messageKey(message: InboxMessage): string {
  if (message.id?.index === undefined) throw new TypeError("Delivery message identity is missing.");
  return `${shardKey(message.id.index)}:${message.id.uuid}`;
}

export function copyMessage(message: InboxMessage): InboxMessage {
  return clone(InboxMessageSchema, message);
}

export function copyShard(shard: ShardIndex): ShardIndex {
  return clone(ShardIndexSchema, shard);
}

export function copyWorker(worker: WorkerId): WorkerId {
  return clone(WorkerIdSchema, worker);
}
