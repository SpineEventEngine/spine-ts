import { create } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { describe, expect, it } from "vitest";

import { AdminService } from "@spine-event-engine/proto/delivery-server";

import { DeliveryServer } from "../../src/index.js";

describe("DeliveryServer terminal lifecycle", () => {
  it("is terminal when closed before startup and never binds", async () => {
    const server = new DeliveryServer({ port: 0 });
    await expect(server.close()).resolves.toBeUndefined();
    await expect(server.start()).rejects.toThrow("Delivery server is closed.");
  });

  it("shares concurrent and repeated close calls before startup", async () => {
    const server = new DeliveryServer({ port: 0 });
    const first = server.close();
    expect(server.close()).toBe(first);
    await expect(Promise.all([first, server.close()])).resolves.toEqual([undefined, undefined]);
  });

  it("closes a concurrent start attempt and leaves no listener", async () => {
    const server = new DeliveryServer({ port: 0 });
    const starting = server.start();
    const closing = server.close();
    await expect(Promise.allSettled([starting, closing])).resolves.toHaveLength(2);
    await expect(server.start()).rejects.toThrow();
  });

  it("completes an active Admin stream and allows the port to be reused after close", async () => {
    const server = new DeliveryServer({ port: 0 });
    await server.start();
    const port = server.port;
    const sessions = new Http2SessionManager(server.baseUrl);
    const admin = createClient(
      AdminService,
      createGrpcTransport({ baseUrl: server.baseUrl, sessionManager: sessions }),
    );
    const stream = admin.subscribeToShardUpdates(create(EmptySchema));
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { value: { case: "created", value: true } },
    });
    await server.close();
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
    sessions.abort();
    const replacement = new DeliveryServer({ port });
    await expect(replacement.start()).resolves.toBe(replacement);
    await replacement.close();
  });

  it("cleans a failed port-collision start and preserves the owner listener", async () => {
    const owner = new DeliveryServer({ port: 0 });
    await owner.start();
    const failed = new DeliveryServer({ host: owner.host, port: owner.port });
    await expect(failed.start()).rejects.toThrow();
    await expect(owner.start()).resolves.toBe(owner);
    await owner.close();
    await expect(failed.close()).resolves.toBeUndefined();
  });
});
