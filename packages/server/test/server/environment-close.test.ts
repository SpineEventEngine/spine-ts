import { describe, expect, it, vi } from "vitest";

import { ServerEnvironment, serverEnvironmentAccess } from "../../src/server/server-environment.js";

describe("ServerEnvironment close", () => {
  it("refuses an in-use environment without closing owned facilities", async () => {
    const delivery = { close: vi.fn() };
    const environment = ServerEnvironment.local({ delivery, ownsDelivery: true });
    const attachment = await serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [],
    });

    await expect(environment.close()).rejects.toThrow(
      "ServerEnvironment cannot close while it is in use.",
    );

    expect(delivery.close).not.toHaveBeenCalled();
    await expect(
      serverEnvironmentAccess.attach(environment, {
        ownership: "caller",
        descriptors: [],
      }),
    ).resolves.toBeDefined();
    await serverEnvironmentAccess.detach(environment, attachment);
  });

  it("permanently closes an owner-free environment and rejects later lifecycle admission", async () => {
    const delivery = { close: vi.fn() };
    const environment = ServerEnvironment.local({ delivery, ownsDelivery: true });
    const first = environment.close();

    expect(environment.close()).toBe(first);
    await first;

    expect(delivery.close).toHaveBeenCalledTimes(1);
    await expect(
      serverEnvironmentAccess.attach(environment, { ownership: "caller", descriptors: [] }),
    ).rejects.toThrow("ServerEnvironment is closed.");
    await expect(serverEnvironmentAccess.stopDelivery(environment)).rejects.toThrow(
      "ServerEnvironment is closed.",
    );
    await expect(serverEnvironmentAccess.retryDeliveryStop(environment)).rejects.toThrow(
      "ServerEnvironment is closed.",
    );
    await expect(environment.close()).resolves.toBeUndefined();
    expect(delivery.close).toHaveBeenCalledTimes(1);
  });

  it("cancels a close-first provisional stop and settles its waiter while facilities remain pending", async () => {
    const facility = Promise.withResolvers<undefined>();
    const closeStarted = Promise.withResolvers<undefined>();
    const environment = ServerEnvironment.local({
      delivery: {
        close() {
          closeStarted.resolve(undefined);
          return facility.promise;
        },
      },
      ownsDelivery: true,
    });
    const closing = environment.close();
    const stopping = serverEnvironmentAccess.stopDelivery(environment);
    const waiting = serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [],
    });

    await closeStarted.promise;
    await expect(stopping).rejects.toThrow("ServerEnvironment is closed.");
    await expect(waiting).rejects.toThrow("ServerEnvironment is closed.");
    await expect(
      serverEnvironmentAccess.attach(environment, { ownership: "caller", descriptors: [] }),
    ).rejects.toThrow("ServerEnvironment is closed.");

    facility.resolve(undefined);
    await expect(closing).resolves.toBeUndefined();
  });

  it("leaves a completed stop-first no-generation operation to settle its waiter normally", async () => {
    const environment = ServerEnvironment.local();
    const stopping = serverEnvironmentAccess.stopDelivery(environment);
    const waiting = serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [],
    });
    const closing = environment.close();

    await expect(closing).resolves.toBeUndefined();
    await expect(waiting).rejects.toThrow("ServerEnvironment is closed.");
    await expect(stopping).resolves.toBeUndefined();
  });
});
