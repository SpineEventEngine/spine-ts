import * as http2 from "node:http2";

import { describe, expect, it } from "vitest";

import { Server } from "../../src/index.js";
import { lifecycleFixture } from "./server-lifecycle-fixture.js";

describe("Server lifecycle integration", () => {
  it("waits for attached startup recovery before opening the listener", async () => {
    const fixture = await lifecycleFixture();
    const starting = Server.atPort(0, { environment: fixture.environment })
      .add(fixture.context)
      .start();

    try {
      await fixture.worker.startedWithin();
      let settled = false;
      void starting.then(() => {
        settled = true;
      });
      await nextTurn();

      expect(fixture.worker.starts).toBe(1);
      expect(settled).toBe(false);

      fixture.worker.release();
      const server = await starting;
      expect(server.host).toBe("127.0.0.1");
      expect(server.port).toBeGreaterThan(0);
      expect(server.baseUrl).toBe(`http://127.0.0.1:${server.port.toString()}`);
      await server.close();
      await server.close();
      await expect(fixture.environment.close()).resolves.toBeUndefined();
    } finally {
      fixture.worker.release();
      await starting.then(
        (server) => server.close(),
        () => undefined,
      );
      fixture.dispose();
    }
  });

  it("closes sessions, attachment delivery, resources, and owned facilities in order", async () => {
    const events: string[] = [];
    const fixture = await lifecycleFixture({ events });
    const server = Server.atPort(0, {
      environment: fixture.environment,
      ownsEnvironment: true,
    })
      .add(fixture.context)
      .addResource({ close: () => events.push("resource") });
    const starting = server.start();

    try {
      await fixture.worker.startedWithin();
      fixture.worker.release();
      const running = await starting;
      const session = http2.connect(running.baseUrl);
      session.on("error", () => undefined);
      session.on("close", () => events.push("session"));
      await once(session, "remoteSettings");

      await running.close();
      await running.close();

      expect(events).toEqual(["recovery", "session", "stop", "await", "retire", "resource"]);
    } finally {
      fixture.worker.release();
      await starting.then(
        (running) => running.close(),
        () => undefined,
      );
      fixture.dispose();
    }
  });
});

function once(target: NodeJS.EventEmitter, event: string): Promise<void> {
  return new Promise((resolve) => target.once(event, resolve));
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
