import * as http2 from "node:http2";

import { create } from "@bufbuild/protobuf";
import { CommandSchema } from "@spine-ts/proto";
import { describe, expect, it } from "vitest";

import { BoundedContext, Server } from "../../src/index.js";

describe("Server", () => {
  it("starts on 127.0.0.1 by default and exposes its local base URL", async () => {
    const server = await Server.atPort(0).start();

    try {
      expect(server.host).toBe("127.0.0.1");
      expect(server.port).toBeGreaterThan(0);
      expect(server.baseUrl).toBe(`http://127.0.0.1:${server.port.toString()}`);
    } finally {
      await server.close();
    }
  });

  it("honors an explicit host and port", async () => {
    const server = await new Server({ host: "127.0.0.1", port: 0 }).start();

    try {
      expect(server.host).toBe("127.0.0.1");
      expect(server.port).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });

  it("closes active HTTP/2 sessions before owned resources", async () => {
    const order: string[] = [];
    const server = await Server.atPort(0)
      .addResource({
        close() {
          order.push("resource");
        },
      })
      .start();
    const session = http2.connect(server.baseUrl);
    session.on("error", () => undefined);
    session.on("close", () => order.push("session"));
    await once(session, "remoteSettings");

    await server.close();

    expect(order).toEqual(["session", "resource"]);
  });

  it("destroys non-draining HTTP/2 streams and still closes owned resources", async () => {
    const context = BoundedContext.singleTenant("Tasks").build();
    const closed: string[] = [];
    const server = await Server.atPort(0)
      .add(context)
      .addResource({
        close() {
          closed.push("resource");
        },
      })
      .start();
    const session = http2.connect(server.baseUrl);
    session.on("error", () => undefined);
    const request = session.request({
      [http2.constants.HTTP2_HEADER_METHOD]: "POST",
      [http2.constants.HTTP2_HEADER_PATH]: "/spine.client.SubscriptionService/Activate",
      [http2.constants.HTTP2_HEADER_CONTENT_TYPE]: "application/connect+proto",
    });
    request.on("error", () => undefined);
    request.on("close", () => closed.push("stream"));
    await once(session, "remoteSettings");
    request.write(Buffer.from([0]));
    await nextTurn();

    const close = server.close();
    const result = await Promise.race([
      close.then(() => "closed"),
      delay(500).then(() => "timed-out"),
    ]);
    if (result !== "closed") {
      request.close();
      session.destroy();
      await close.catch(() => undefined);
    }

    expect(result).toBe("closed");
    expect(closed).toContain("stream");
    expect(closed).toContain("resource");
    await expect(context.commandBus().post(create(CommandSchema))).rejects.toMatchObject({
      operation: "enqueue",
      state: "closed",
    });
  });

  it("ignores sessions already destroyed before server shutdown", async () => {
    const server = await Server.atPort(0).start();
    const session = http2.connect(server.baseUrl);
    session.on("error", () => undefined);
    await once(session, "remoteSettings");

    session.destroy();
    await server.close();
  });

  it("attempts all owned resource closes and reports aggregate failure", async () => {
    const firstError = new Error("first close failed");
    const closed: string[] = [];
    const server = await Server.atPort(0)
      .addResource({
        close() {
          closed.push("first");
          throw firstError;
        },
      })
      .addResource({
        close() {
          closed.push("second");
        },
      })
      .start();

    await expect(server.close()).rejects.toMatchObject({
      errors: [firstError],
      message: "Server close failed while closing owned contexts/resources.",
    });
    await expect(server.close()).rejects.toMatchObject({
      errors: [firstError],
    });
    expect(closed).toEqual(["first", "second"]);
  });

  it("ignores non-closeable resources and flattens aggregate close failures", async () => {
    const firstError = new Error("first nested close failed");
    const secondError = new Error("second nested close failed");
    const closed: string[] = [];
    const server = await new Server({
      resources: [
        null as unknown as { close(): unknown },
        {} as { close(): unknown },
        {
          close() {
            throw new AggregateError([firstError, secondError], "Nested close failed.");
          },
        },
        {
          close() {
            closed.push("after aggregate");
          },
        },
      ],
    }).start();

    await expect(server.close()).rejects.toMatchObject({
      errors: [firstError, secondError],
      message: "Server close failed while closing owned contexts/resources.",
    });
    expect(closed).toEqual(["after aggregate"]);
  });

  it("closes built bounded contexts and rejects later context work", async () => {
    const context = BoundedContext.singleTenant("Tasks").build();
    const server = await Server.atPort(0).add(context).start();

    await server.close();
    await server.close();

    await expect(context.commandBus().post(create(CommandSchema))).rejects.toMatchObject({
      operation: "enqueue",
      state: "closed",
    });
    expect(() => context.stand().stateTypes()).toThrow("Stand is closed.");
  });
});

function once(target: NodeJS.EventEmitter, event: string): Promise<void> {
  return new Promise((resolve) => {
    target.once(event, () => {
      resolve();
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
