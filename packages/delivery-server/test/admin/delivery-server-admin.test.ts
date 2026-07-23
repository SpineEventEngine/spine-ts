import { create } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { Code, createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { describe, expect, it } from "vitest";

import {
  AdminService,
  InboxService,
  PickUpShardSchema,
  ReleaseShardSchema,
  ShardService,
  ShardStatus,
  WriteMessageSchema,
  type SubscriptionResponse,
} from "@spine-ts/proto/delivery-server";
import {
  InboxMessageSchema,
  InboxMessageStatus,
  ShardIndexSchema,
  WorkerIdSchema,
  type ShardIndex,
} from "@spine-ts/proto/delivery";

import { DeliveryServer } from "../../src/index.js";

describe("DeliveryServer Admin", () => {
  it("serves an empty deterministic shard snapshot", async () => {
    const server = new DeliveryServer({ port: 0 });
    await server.start();
    try {
      const sessions = new Http2SessionManager(server.baseUrl);
      const admin = createClient(
        AdminService,
        createGrpcTransport({ baseUrl: server.baseUrl, sessionManager: sessions }),
      );
      await expect(admin.getShardInfo(create(EmptySchema))).resolves.toMatchObject({ shards: [] });
      sessions.abort();
    } finally {
      await server.close();
    }
  });

  it("reports message-only, picked, and released complete observations in deterministic order", async () => {
    const server = new DeliveryServer({ port: 0 });
    await server.start();
    const sessions = new Http2SessionManager(server.baseUrl);
    const transport = createGrpcTransport({ baseUrl: server.baseUrl, sessionManager: sessions });
    const admin = createClient(AdminService, transport);
    const inbox = createClient(InboxService, transport);
    const shards = createClient(ShardService, transport);
    const first = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
    const second = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
    const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" });
    try {
      await inbox.writeOne(create(WriteMessageSchema, { message: message("first", second) }));
      await inbox.writeOne(create(WriteMessageSchema, { message: message("second", first) }));
      await shards.pickShard(create(PickUpShardSchema, { shard: second, worker }));
      await expect(admin.getShardInfo(create(EmptySchema))).resolves.toMatchObject({
        shards: [
          { index: first, status: ShardStatus.NOT_PICKED, messages: 1 },
          { index: second, status: ShardStatus.PICKED, messages: 1 },
        ],
      });

      const iterator = admin.subscribeToShardUpdates(create(EmptySchema))[Symbol.asyncIterator]();
      await expect(iterator.next()).resolves.toMatchObject({
        value: { value: { case: "created", value: true } },
      });
      const inserted = iterator.next();
      await inbox.writeOne(create(WriteMessageSchema, { message: message("third", second) }));
      const insertedResult = await inserted;
      expect(insertedResult).toMatchObject({
        value: {
          value: {
            case: "update",
            value: {
              index: second,
              newStatus: ShardStatus.PICKED,
              newMessagesCount: 2,
            },
          },
        },
      });
      const insertedFrame = insertedResult.value as SubscriptionResponse | undefined;
      expect(
        insertedFrame?.value.case === "update"
          ? insertedFrame.value.value.whenLastPicked
          : undefined,
      ).toBeDefined();
      const released = iterator.next();
      await shards.releaseSession(create(ReleaseShardSchema, { shard: second, worker }));
      const releasedResult = await released;
      expect(releasedResult).toMatchObject({
        value: {
          value: {
            case: "update",
            value: {
              index: second,
              newStatus: ShardStatus.NOT_PICKED,
              newMessagesCount: 2,
            },
          },
        },
      });
      const releasedFrame = releasedResult.value as SubscriptionResponse | undefined;
      expect(
        releasedFrame?.value.case === "update"
          ? releasedFrame.value.value.whenLastPicked
          : undefined,
      ).toBeDefined();
      await iterator.return?.();

      const abort = new AbortController();
      const aborted = admin
        .subscribeToShardUpdates(create(EmptySchema), { signal: abort.signal })
        [Symbol.asyncIterator]();
      await aborted.next();
      const waiting = aborted.next();
      abort.abort();
      await expect(waiting).rejects.toMatchObject({ code: Code.Canceled });
    } finally {
      sessions.abort();
      await server.close();
    }
  });
});

function message(uuid: string, shard: ShardIndex) {
  return create(InboxMessageSchema, {
    id: { uuid, index: shard },
    signalId: { value: "signal" },
    inboxId: { entityId: { id: { typeUrl: "example.Entity" } }, typeUrl: "example.State" },
    payload: { case: "command", value: {} },
    label: 1,
    whenReceived: { seconds: 0n, nanos: 0 },
    status: InboxMessageStatus.TO_DELIVER,
  });
}
