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

import { createClient, Code } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { describe, expect, it } from "vitest";

import * as privateProto from "@spine-event-engine/proto/generated/spine/delivery/session/private_delivery_pb.js";
import { CapacityLedger } from "../../src/server/capacity-ledger.js";
import { PrivateCapacityClient } from "../../src/server/private-capacity-client.js";
import { PrivateCapacityListener } from "../../src/server/private-capacity-listener.js";

describe("private capacity listener", () => {
  it("reserves capacity only for the matching child credential and generation", async () => {
    const ledger = new CapacityLedger({
      maxRetainedMessages: 1,
      maxRetainedBytes: 50,
      maxTrackedShards: 1,
    });
    ledger.replace(0, "first");
    const credentials = new Map([["Bearer child-secret", { slot: 0, generation: "first" }]]);
    const listener = new PrivateCapacityListener(ledger, credentials);
    await listener.start();
    const sessions = new Http2SessionManager(listener.baseUrl);
    const transport = createGrpcTransport({ baseUrl: listener.baseUrl, sessionManager: sessions });
    const client = createClient(privateProto.PrivateCapacityService, transport);
    const ticket = { slot: 0n, generation: "first", sequence: 1n };
    try {
      await expect(
        client.reserve({ ticket, growth: { rows: 1n, bytes: 20n, shards: 1n } }),
      ).rejects.toMatchObject({ code: Code.Unauthenticated });
      await expect(
        client.reserve(
          { ticket, growth: { rows: 1n, bytes: 20n, shards: 1n } },
          {
            headers: { authorization: "Bearer child-secret" },
          },
        ),
      ).resolves.toBeDefined();
      expect(ledger.usage()).toEqual({ rows: 1, bytes: 20, shards: 1 });
      await expect(
        client.report(
          {
            ticket: { ...ticket, generation: "stale" },
            usage: { rows: 1n, bytes: 20n, shards: 1n },
            revision: 1n,
          },
          { headers: { authorization: "Bearer child-secret" } },
        ),
      ).rejects.toMatchObject({ code: Code.FailedPrecondition });
      await expect(
        client.report(
          {
            ticket,
            usage: { rows: 1n, bytes: 20n, shards: 1n },
          },
          { headers: { authorization: "Bearer child-secret" } },
        ),
      ).rejects.toMatchObject({ code: Code.InvalidArgument });
      await client.report(
        {
          ticket,
          usage: { rows: 1n, bytes: 20n, shards: 1n },
          revision: 1n,
        },
        { headers: { authorization: "Bearer child-secret" } },
      );
      await client.reportUsage(
        {
          slot: 0n,
          generation: "first",
          revision: 2n,
          usage: { rows: 0n, bytes: 0n, shards: 0n },
        },
        { headers: { authorization: "Bearer child-secret" } },
      );
      expect(ledger.usage()).toEqual({ rows: 0, bytes: 0, shards: 0 });
      await client.reserve(
        {
          ticket: { ...ticket, sequence: 2n },
          growth: { rows: 0n, bytes: 0n, shards: 0n },
        },
        { headers: { authorization: "Bearer child-secret" } },
      );
      await client.report(
        {
          ticket: { ...ticket, sequence: 2n },
          usage: { rows: 0n, bytes: 0n, shards: 0n },
          revision: 2n,
        },
        { headers: { authorization: "Bearer child-secret" } },
      );
    } finally {
      sessions.abort();
      await listener.close();
    }
  });

  it("reports an autonomous release through the child client without a public call", async () => {
    const ledger = new CapacityLedger({
      maxRetainedMessages: 1,
      maxRetainedBytes: 50,
      maxTrackedShards: 1,
    });
    ledger.replace(0, "first");
    ledger.replace(1, "second");
    const credentials = new Map([["Bearer child-secret", { slot: 0, generation: "first" }]]);
    const listener = new PrivateCapacityListener(ledger, credentials);
    await listener.start();
    const client = new PrivateCapacityClient(listener.baseUrl, "Bearer child-secret", 0, "first");
    const pickup = { slot: 0, generation: "first", sequence: 1n };
    try {
      await client.reserve(pickup, { rows: 0, bytes: 0, shards: 1 });
      await client.report(pickup, { rows: 0, bytes: 0, shards: 1 }, 1n);
      expect(() => {
        ledger.reserve(
          { slot: 1, generation: "second", sequence: 1n },
          {
            rows: 1,
            bytes: 10,
            shards: 1,
          },
        );
      }).toThrow(expect.objectContaining({ code: Code.ResourceExhausted }));
      await client.reportUsage({ revision: 2n, usage: { rows: 0, bytes: 0, shards: 0 } });
      ledger.reserve(
        { slot: 1, generation: "second", sequence: 1n },
        {
          rows: 1,
          bytes: 10,
          shards: 1,
        },
      );
      expect(ledger.usage()).toEqual({ rows: 1, bytes: 10, shards: 1 });
    } finally {
      client.close();
      await listener.close();
    }
  });
});
