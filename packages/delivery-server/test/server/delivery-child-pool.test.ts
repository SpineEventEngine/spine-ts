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

import { fork, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { InboxService } from "@spine-event-engine/proto/delivery-server";
import { ShardIndexSchema } from "@spine-event-engine/proto/delivery";
import { describe, expect, it, vi } from "vitest";

import { domainMessage, encodedBytes } from "../core/domain-message.js";
import { DeliveryChildPool } from "../../src/server/delivery-child-pool.js";
import { DeliveryConfig } from "../../src/server/config.js";

describe("forked delivery children", () => {
  it("reaps a delayed startup-failed child during shutdown", async () => {
    let failed: ChildProcess | undefined;
    let attempts = 0;
    const fixture = resolve("packages/delivery-server/test/fixtures/delayed-failed-child.mjs");
    const pool = new DeliveryChildPool(
      1,
      DeliveryConfig.resolve({ port: 0 }),
      (entry, args, options) => {
        attempts++;
        if (attempts === 1) {
          failed = fork(fixture, [], options);
          return failed;
        }
        return fork(entry, args, options);
      },
    );
    try {
      await pool.start();
      await vi.waitFor(() => {
        expect(pool.endpoint(0).pid).toBeGreaterThan(0);
      });
      expect(failed?.exitCode).toBeNull();
      await pool.close();
      expect(failed?.exitCode !== null || failed.signalCode !== null).toBe(true);
    } finally {
      failed?.kill("SIGKILL");
      await pool.close();
    }
  });
  it.each(["synchronous", "asynchronous"])(
    "retries a %s fork failure without stopping its fixed slot",
    async (kind) => {
      let attempts = 0;
      const pool = new DeliveryChildPool(
        1,
        DeliveryConfig.resolve({ port: 0 }),
        (entry, args, options) => {
          attempts++;
          if (attempts === 1 && kind === "synchronous") throw new Error("fork failed");
          if (attempts === 1)
            return fork(entry, args, { ...options, execPath: "/not-a-node-executable" });
          return fork(entry, args, options);
        },
      );
      try {
        await pool.start();
        await vi.waitFor(() => {
          expect(pool.endpoint(0).pid).toBeGreaterThan(0);
        });
        expect(attempts).toBeGreaterThanOrEqual(2);
      } finally {
        await pool.close();
      }
    },
  );
  it("runs distinct slots in distinct processes and restarts a failed slot", async () => {
    const pool = new DeliveryChildPool(
      2,
      DeliveryConfig.resolve({
        host: "127.0.0.1",
        port: 0,
        maxRetainedMessages: 2,
      }),
    );
    await pool.start();
    const first = pool.endpoint(0);
    const second = pool.endpoint(1);
    expect(first.pid).not.toBe(process.pid);
    expect(second.pid).not.toBe(first.pid);
    const sessions = new Http2SessionManager(second.baseUrl);
    const inbox = createClient(
      InboxService,
      createGrpcTransport({
        baseUrl: second.baseUrl,
        sessionManager: sessions,
      }),
    );
    const shard = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
    const row = domainMessage("healthy-slot", shard);
    if (row.id === undefined) throw new Error("Inbox fixture identity is missing.");
    try {
      await inbox.writeOne(
        { message: row },
        {
          headers: {
            authorization: second.credential,
            "x-spine-capacity-sequence": "1",
          },
        },
      );
      expect(pool.ledger.usage()).toEqual({ rows: 1, bytes: encodedBytes(row), shards: 1 });
      process.kill(first.pid, "SIGKILL");
      const found = await inbox.findOne(
        { index: shard, uuid: row.id.uuid },
        {
          headers: { authorization: second.credential },
        },
      );
      expect(found.message?.id?.uuid).toBe("healthy-slot");
      await vi.waitFor(() => {
        expect(pool.endpoint(0).generation).not.toBe(first.generation);
      });
      const replacement = pool.endpoint(0);
      process.kill(replacement.pid, "SIGKILL");
      await vi.waitFor(() => {
        expect(pool.endpoint(0).generation).not.toBe(replacement.generation);
      });
      expect(pool.endpoint(1).generation).toBe(second.generation);
    } finally {
      sessions.abort();
      await pool.close();
    }
  });
});
