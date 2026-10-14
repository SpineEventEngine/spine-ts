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

import * as http2 from "node:http2";

import { create } from "@bufbuild/protobuf";
import { EmptySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Code, createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AdminService,
  Health,
  InboxReadService,
  InboxService,
  ShardService,
} from "@spine-event-engine/proto/delivery-server";
import { CommandSchema } from "@spine-event-engine/proto";
import {
  InboxLabel,
  InboxMessageSchema,
  InboxMessageStatus,
  ShardIndexSchema,
} from "@spine-event-engine/proto/delivery";

import { DeliveryServer } from "../../src/index.js";

const servers: DeliveryServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("DeliveryServer listener", () => {
  it("registers Inbox, InboxRead, Shard, Admin, and Health on an ephemeral loopback bind", async () => {
    const server = tracked(new DeliveryServer({ host: "127.0.0.1", port: 0 }));
    await expect(Promise.all([server.start(), server.start()])).resolves.toEqual([server, server]);
    expect(server.port).toBeGreaterThan(0);
    expect(server.baseUrl).toBe(`http://127.0.0.1:${String(server.port)}`);
    const sessions = new Http2SessionManager(server.baseUrl);
    const transport = createGrpcTransport({ baseUrl: server.baseUrl, sessionManager: sessions });
    try {
      await expect(
        createClient(AdminService, transport).getShardInfo(create(EmptySchema)),
      ).resolves.toMatchObject({ shards: [] });
      await expect(createClient(Health, transport).check({ service: "" })).resolves.toBeDefined();
      await expect(
        createClient(InboxService, transport).findOne({ uuid: "" }),
      ).rejects.toMatchObject({
        code: Code.InvalidArgument,
      });
      const reads = createClient(InboxReadService, transport);
      await expect(
        reads.readPage({
          shard: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
          pageSize: 1,
        }),
      ).resolves.toMatchObject({ message: [] });
      await expect(
        reads.readPage({
          shard: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
          pageSize: 0,
        }),
      ).rejects.toMatchObject({ code: Code.InvalidArgument });
      await expect(
        reads.readPage({
          shard: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
          pageSize: 1,
          after: { messageId: "", version: 0 },
        }),
      ).rejects.toMatchObject({ code: Code.InvalidArgument });
      await expect(
        reads.readPage({
          shard: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
          pageSize: 1,
          sinceWhen: create(TimestampSchema, { seconds: 1n }),
          after: {
            messageId: "a",
            version: 0,
            whenReceived: create(TimestampSchema, { seconds: 1n }),
          },
        }),
      ).rejects.toMatchObject({ code: Code.InvalidArgument });
      await expect(
        reads.readPage({
          shard: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
          pageSize: 1,
          sinceWhen: create(TimestampSchema, { seconds: 253_402_300_800n }),
        }),
      ).rejects.toMatchObject({ code: Code.InvalidArgument });
      await expect(createClient(ShardService, transport).pickShard({})).rejects.toMatchObject({
        code: Code.InvalidArgument,
      });
    } finally {
      sessions.abort();
    }
  });

  it("rejects a port collision and leaves a failed instance terminal", async () => {
    const owner = tracked(new DeliveryServer({ port: 0 }));
    await owner.start();
    const error = vi.fn();
    const logger = { withMetadata: vi.fn(() => ({ error })) };
    const failed = tracked(
      new DeliveryServer({ host: owner.host, port: owner.port, logger: logger as never }),
    );
    await expect(failed.start()).rejects.toBeInstanceOf(Error);
    await expect(failed.start()).rejects.toBeInstanceOf(Error);
    expect(logger.withMetadata).toHaveBeenCalledWith({
      operation: "delivery.listener.start",
      reasonCode: "failed",
    });
    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith("delivery.listener.start_failed");
    await failed.close();
    expect(error).toHaveBeenCalledOnce();
  });

  it("closes an idle owned HTTP/2 session", async () => {
    const server = tracked(new DeliveryServer({ port: 0 }));
    await server.start();
    const session = http2.connect(server.baseUrl);
    await connected(session);
    const closed = new Promise<void>((resolve) => session.once("close", resolve));
    await server.close();
    await expect(closed).resolves.toBeUndefined();
  });

  it("uses the documented default bind before startup", () => {
    const server = tracked(new DeliveryServer());
    expect(server.host).toBe("127.0.0.1");
    expect(server.port).toBe(8484);
    expect(() => server.baseUrl).toThrow("Delivery server has not started.");
  });

  it("rejects an over-limit inbound request while accepting an allowed request", async () => {
    const server = tracked(new DeliveryServer({ port: 0, maxInboundMessageBytes: 1_024 }));
    await server.start();
    const sessions = new Http2SessionManager(server.baseUrl);
    const inbox = createClient(
      InboxService,
      createGrpcTransport({ baseUrl: server.baseUrl, sessionManager: sessions }),
    );
    try {
      await expect(inbox.writeOne(inboxMessage("ok"))).resolves.toBeDefined();
      await expect(inbox.writeOne(inboxMessage("x".repeat(2_048)))).rejects.toMatchObject({
        code: Code.ResourceExhausted,
      });
    } finally {
      sessions.abort();
    }
  });
});

function tracked(server: DeliveryServer): DeliveryServer {
  servers.push(server);
  return server;
}

function connected(session: http2.ClientHttp2Session): Promise<void> {
  return new Promise((resolve, reject) => {
    session.once("connect", resolve);
    session.once("error", reject);
  });
}

function inboxMessage(uuid: string) {
  return {
    message: create(InboxMessageSchema, {
      id: { uuid, index: { index: 0, ofTotal: 1 } },
      signalId: { value: "signal" },
      inboxId: { entityId: { id: { typeUrl: "example.Entity" } }, typeUrl: "example.State" },
      payload: {
        case: "command",
        value: create(CommandSchema, {
          id: { uuid: "command" },
          message: { typeUrl: "example.Command", value: new Uint8Array([1]) },
        }),
      },
      label: InboxLabel.HANDLE_COMMAND,
      whenReceived: { seconds: 0n, nanos: 0 },
      status: InboxMessageStatus.TO_DELIVER,
    }),
  };
}
