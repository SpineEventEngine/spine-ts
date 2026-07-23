import { create } from "@bufbuild/protobuf";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { InboxService, OptionalInboxMessageSchema } from "@spine-ts/proto/delivery-server";
import { ShardIndex } from "@spine-ts/server";
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
