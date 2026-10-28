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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BoundedContext,
  type ListenerLifecycle,
  Server,
  ServerEnvironment,
} from "../../src/index.js";
import { BrowserServer, type StandaloneBrowserServerOptions } from "../../src/browser/index.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import { serverEnvironmentAccess } from "../../src/server/server-environment.js";
import { resetServerEnvironmentForTest } from "../../src/testing/index.js";

const createHttp2Server = vi.hoisted(() =>
  vi.fn<(server: import("node:http2").Http2Server) => void>(),
);

vi.mock("node:http2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http2")>();
  return {
    ...actual,
    createServer(...args: Parameters<typeof actual.createServer>) {
      const server = actual.createServer(...args);
      createHttp2Server(server);
      return server;
    },
  };
});

describe("Server lifecycle integration", () => {
  it("exports the listener lifecycle contract", () => {
    const lifecycle: ListenerLifecycle = { start: () => undefined, close: () => undefined };
    expect(lifecycle).toBeDefined();
  });

  it("starts listener lifecycles after readiness and closes them before network intake", async () => {
    const events: string[] = [];
    const server = Server.atPort(0).addListenerLifecycle({
      start: () => events.push("start"),
      close: () => events.push("close"),
    });
    const running = await server.start();
    expect(events).toEqual(["start"]);
    await running.close();
    expect(events).toEqual(["start", "close"]);
  });

  it("retries only a failed listener lifecycle close", async () => {
    let attempts = 0;
    const successful = vi.fn();
    const failing = vi.fn(() => {
      attempts += 1;
      if (attempts === 1) throw new Error("close failed");
    });
    const running = await Server.atPort(0)
      .addListenerLifecycle({ start: () => undefined, close: successful })
      .addListenerLifecycle({ start: () => undefined, close: failing })
      .start();
    await expect(running.close()).rejects.toThrow("close failed");
    await running.close();
    expect(successful).toHaveBeenCalledOnce();
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("rolls back only listener lifecycles admitted before a start failure", async () => {
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const thirdClose = vi.fn();
    const server = Server.atPort(0)
      .addListenerLifecycle({ start: () => undefined, close: firstClose })
      .addListenerLifecycle({
        start: () => {
          throw new Error("start failed");
        },
        close: secondClose,
      })
      .addListenerLifecycle({ start: () => undefined, close: thirdClose });
    await expect(server.start()).rejects.toThrow("start failed");
    expect(firstClose).toHaveBeenCalledOnce();
    expect(secondClose).not.toHaveBeenCalled();
    expect(thirdClose).not.toHaveBeenCalled();
  });

  it("rolls back admitted listener lifecycles in reverse start order", async () => {
    const closed: string[] = [];
    const server = Server.atPort(0)
      .addListenerLifecycle({ start: () => undefined, close: () => closed.push("first") })
      .addListenerLifecycle({ start: () => undefined, close: () => closed.push("second") })
      .addListenerLifecycle({
        start: () => {
          throw new Error("start failed");
        },
        close: () => undefined,
      });

    await expect(server.start()).rejects.toThrow("start failed");
    expect(closed).toEqual(["second", "first"]);
  });

  it("does not restart after a listener-start failure rolls back cleanly", async () => {
    const start = vi.fn(() => {
      throw new Error("start failed");
    });
    const server = Server.atPort(0).addListenerLifecycle({ start, close: () => undefined });

    await expect(server.start()).rejects.toThrow("start failed");
    await expect(server.start()).rejects.toThrow("cannot restart after failed-start cleanup");
    expect(start).toHaveBeenCalledOnce();
  });

  it("retries later server cleanup after listener rollback before becoming terminal", async () => {
    const startFailure = new Error("listener start failed");
    const networkFailure = new Error("network close failed");
    const closed: string[] = [];
    let network: NetworkCloseProbe | undefined;
    createHttp2Server.mockImplementationOnce((httpServer) => {
      network = trackNetworkClose(httpServer, [networkFailure]);
    });
    const server = Server.atPort(0)
      .addListenerLifecycle({ start: () => undefined, close: () => closed.push("admitted") })
      .addListenerLifecycle({
        start: () => {
          throw startFailure;
        },
        close: () => undefined,
      });

    const first = await server.start().catch((error: unknown) => error);
    expect(first).toBeInstanceOf(AggregateError);
    expect((first as AggregateError).errors).toEqual([startFailure, networkFailure]);
    expect(closed).toEqual(["admitted"]);
    expect(network?.calls()).toBe(1);

    const completion = await server.start().catch((error: unknown) => error);
    expectDeferredCleanupCompletion(completion);
    expect(network?.calls()).toBe(2);

    const terminal = await server.start().catch((error: unknown) => error);
    expectConsumedFailedStartServer(terminal);
  });

  it("aggregates listener start and admitted rollback failures in order", async () => {
    const startFailure = new Error("start failed");
    const rollbackFailure = new Error("rollback failed");
    const laterClose = vi.fn();
    const server = Server.atPort(0)
      .addListenerLifecycle({
        start: () => undefined,
        close: vi.fn().mockImplementationOnce(() => {
          throw rollbackFailure;
        }),
      })
      .addListenerLifecycle({
        start: () => {
          throw startFailure;
        },
        close: vi.fn(),
      })
      .addListenerLifecycle({ start: () => undefined, close: laterClose });
    const failure = await server.start().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([startFailure, rollbackFailure]);
    expect(laterClose).not.toHaveBeenCalled();
    await expect(server.start()).rejects.toThrow("deferred cleanup");
  });

  it("keeps the listener open until a failed lifecycle close retries", async () => {
    let attempts = 0;
    const running = await Server.atPort(0)
      .addListenerLifecycle({
        start: () => undefined,
        close: () => {
          attempts += 1;
          if (attempts === 1) throw new Error("close failed");
        },
      })
      .start();
    await expect(running.close()).rejects.toThrow("close failed");
    const session = http2.connect(running.baseUrl);
    session.on("error", () => undefined);
    await once(session, "remoteSettings");
    session.close();
    await once(session, "close");
    await running.close();
  });

  it("rejects incomplete standalone browser options without starting a native lifecycle", async () => {
    const start = vi.fn();
    const close = vi.fn();
    new Server().addListenerLifecycle({ start, close });
    await expect(
      BrowserServer.run({
        backend: { baseUrls: ["http://10.0.0.1"] },
      } as StandaloneBrowserServerOptions),
    ).rejects.toThrow("Standalone browser server");
    expect(start).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("shares one environment Delivery across sibling servers until both listeners close", async () => {
    const environment = ServerEnvironment.instance();
    const delivery = environment.delivery;
    const firstContext = await BoundedContext.singleTenant("SharedFirst").build();
    const secondContext = await BoundedContext.singleTenant("SharedSecond").build();
    const first = await Server.atPort(0).add(firstContext).start();
    const second = await Server.atPort(0).add(secondContext).start();
    try {
      expect(serverEnvironmentAccess.openContexts(environment)).toHaveLength(2);
      await first.close();
      expect(serverEnvironmentAccess.openContexts(environment)).toEqual([secondContext]);
      expect(environment.delivery).toBe(delivery);
      await expect(delivery.inbox.read(ShardIndex.single())).resolves.toEqual([]);
      await second.close();
      expect(serverEnvironmentAccess.openContexts(environment)).toEqual([]);
    } finally {
      await first.close();
      await second.close();
    }
    await environment.close();
  });
  beforeEach(async () => {
    await resetServerEnvironmentForTest();
    await ServerEnvironment.instance().completeSetup();
    createHttp2Server.mockReset();
  });
  afterEach(async () => {
    for (const context of serverEnvironmentAccess.openContexts(ServerEnvironment.instance()))
      await context.close();
  });
});

function once(target: NodeJS.EventEmitter, event: string): Promise<void> {
  return new Promise((resolve) => target.once(event, resolve));
}

function expectDeferredCleanupCompletion(error: unknown): void {
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(AggregateError);
  expect((error as Error).constructor).toBe(Error);
  expect((error as Error).message).toBe(
    "Server deferred cleanup completed after an earlier failed start.",
  );
  expect(Object.hasOwn(error as object, "cause")).toBe(false);
}

function expectConsumedFailedStartServer(error: unknown): void {
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(AggregateError);
  expect((error as Error).constructor).toBe(Error);
  expect((error as Error).message).toBe(
    "Server cannot restart after failed-start cleanup has completed.",
  );
  expect(Object.hasOwn(error as object, "cause")).toBe(false);
}

interface NetworkCloseProbe {
  calls(): number;
}

function trackNetworkClose(
  server: http2.Http2Server,
  closeFailures: readonly Error[] = [],
  onClosed: () => void = () => undefined,
): NetworkCloseProbe {
  const failures = [...closeFailures];
  const close = server.close.bind(server);
  let calls = 0;
  Object.defineProperty(server, "close", {
    configurable: true,
    value: (callback?: (error?: Error) => void) => {
      calls += 1;
      const failure = failures.shift();
      if (failure !== undefined) {
        setImmediate(() => callback?.(failure));
        return server;
      }
      return close((error) => {
        if (error === undefined) onClosed();
        callback?.(error);
      });
    },
  });
  return Object.freeze({ calls: () => calls });
}
