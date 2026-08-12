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
import { create } from "@bufbuild/protobuf";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import {
  InboxService,
  OptionalInboxMessageSchema,
} from "@spine-event-engine/proto/delivery-server";
import { ShardIndex } from "@spine-event-engine/server";
import * as http2 from "node:http2";
import { afterEach, describe, expect, it } from "vitest";

import { DeliveryClient } from "../src/index.js";

describe("DeliveryClient.connectTo", () => {
  let server: http2.Http2Server | undefined;

  afterEach(async () => {
    const testServer = server;
    if (!testServer?.listening) return;
    await new Promise<void>((resolve, reject) =>
      testServer.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      }),
    );
    server = undefined;
  });

  it("crosses a real HTTP/2 gRPC serialization boundary and releases its session", async () => {
    let requests = 0;
    server = http2.createServer(
      connectNodeAdapter({
        routes: (router) =>
          router.service(InboxService, {
            findOne: () => {
              requests += 1;
              return create(OptionalInboxMessageSchema);
            },
          }),
      }),
    );
    const testServer = server;
    await new Promise<void>((resolve, reject) => {
      testServer.once("error", reject);
      testServer.listen(0, "127.0.0.1", resolve);
    });
    const address = testServer.address();
    if (address === null || typeof address === "string")
      throw new Error("Test server has no port.");
    const client = DeliveryClient.connectTo(`http://127.0.0.1:${String(address.port)}`);

    await expect(
      client.findOne({ value: "wire-message", shard: ShardIndex.single() }),
    ).resolves.toBeUndefined();
    expect(requests).toBe(1);
    client.close();
  });
});
