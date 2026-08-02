import { afterEach, describe, expect, it, vi } from "vitest";
import type { StorageContext } from "@spine-event-engine/storage";

import {
  ServerEnvironment,
  type ServerEnvironmentCloseable,
  serverEnvironmentAccess,
} from "../../src/server/server-environment.js";
import type { ContextDeliveryDescriptor } from "../../src/context/bounded-context.js";
import { DeliveryBuilder } from "../../src/delivery/delivery-builder.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import type { EnvironmentAttachmentHandle } from "../../src/server/environment-attachment.js";
import { EnvironmentType } from "../../src/server/environment.js";
import { resetServerEnvironmentForTest } from "../../src/testing/index.js";

afterEach(async () => {
  await resetServerEnvironmentForTest();
});

function configured(delivery: ServerEnvironmentCloseable & { open?: unknown }) {
  ServerEnvironment.when(EnvironmentType.Local).use({ delivery });
  return ServerEnvironment.instance();
}

describe("ServerEnvironment delivery lifecycle", () => {
  it("passes configured delivery ports to finite and supervisor environment paths", () => {
    const delivery = {
      open: () => undefined,
      close: () => undefined,
      inbox: {},
      workRegistry: {},
    };
    const environment = configured(delivery);

    expect(environment.delivery).toBe(delivery);
    expect("inbox" in delivery).toBe(true);
    expect("workRegistry" in delivery).toBe(true);
  });

  it("routes configured ports through the real attachment factory to finite and supervisor delivery", async () => {
    let finiteReads = 0;
    let finitePickups = 0;
    const inbox = {
      sessionKind: "EXCLUSIVE" as const,
      receive: () => Promise.resolve({}),
      read: () => {
        finiteReads += 1;
        return Promise.resolve([]);
      },
      readMessage: () => Promise.resolve(undefined),
      begin: () => Promise.resolve(undefined),
    };
    const workRegistry = {
      sessionKind: "EXCLUSIVE" as const,
      pickUp: () => {
        finitePickups += 1;
        return Promise.resolve(undefined);
      },
      release: () => Promise.resolve(false),
    };
    const withInbox = vi.spyOn(DeliveryBuilder.prototype, "withInbox");
    const withWorkRegistry = vi.spyOn(DeliveryBuilder.prototype, "withWorkRegistry");
    const environment = configured({
      open: () => undefined,
      close: () => undefined,
      inbox,
      workRegistry,
    });
    const descriptor = environmentDescriptor(environment);
    let attachment: EnvironmentAttachmentHandle | undefined;

    try {
      attachment = await serverEnvironmentAccess.attach(environment, {
        ownership: "caller",
        descriptors: [descriptor],
      });

      await waitFor(() => finitePickups > 0 && finiteReads > 0);
      expect(withInbox).toHaveBeenCalledWith(inbox);
      expect(withWorkRegistry).toHaveBeenCalledWith(workRegistry);
      await serverEnvironmentAccess.detach(environment, attachment);
      attachment = undefined;
    } finally {
      if (attachment !== undefined) await serverEnvironmentAccess.detach(environment, attachment);
      withInbox.mockRestore();
      withWorkRegistry.mockRestore();
    }
  });

  it("does not expose the internal delivery opener on the environment instance", () => {
    const environment = configured({ close: () => undefined });

    expect("openDelivery" in environment).toBe(false);
  });

  it("preserves a close-only delivery with an unrelated non-callable open property", async () => {
    const environment = configured({ close: () => undefined, open: "legacy metadata" });

    const attachment = await serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [],
    });
    await serverEnvironmentAccess.detach(environment, attachment);
  });

  it("rejects an incomplete callable delivery instead of reading invalid ports", async () => {
    const environment = configured({
      close: () => undefined,
      open: () => undefined,
    });

    const result: Error | EnvironmentAttachmentHandle = await serverEnvironmentAccess
      .attach(environment, { ownership: "caller", descriptors: [] })
      .then<Error | EnvironmentAttachmentHandle, Error | EnvironmentAttachmentHandle>(
        (attachment) => attachment,
        (error: unknown) => error as Error,
      );
    if (!(result instanceof Error)) await serverEnvironmentAccess.detach(environment, result);

    expect(result).toHaveProperty(
      "message",
      "ServerEnvironmentDelivery requires inbox and workRegistry ports.",
    );
  });

  it("opens configured delivery before the first environment attachment", async () => {
    let release: () => void = () => undefined;
    const environment = configured({
      open: () => new Promise<void>((resolve) => (release = resolve)),
      close: () => undefined,
      inbox: {},
      workRegistry: {},
    });

    const attaching = serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [],
    });
    let attached = false;
    void attaching.then(() => {
      attached = true;
    });
    await Promise.resolve();
    expect(attached).toBe(false);
    release();

    const attachment = await attaching;
    await serverEnvironmentAccess.detach(environment, attachment);
  });

  it("closes configured delivery while its attachment readiness remains pending", async () => {
    let release: () => void = () => undefined;
    const events: string[] = [];
    const environment = configured({
      open: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      close: () => events.push("delivery"),
      inbox: {},
      workRegistry: {},
    });
    const attaching = serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [],
    });
    await Promise.resolve();

    const closing = environment.close();
    release();

    await expect(attaching).rejects.toThrow("ServerEnvironment is closed.");
    await expect(closing).resolves.toBeUndefined();
    expect(events).toEqual(["delivery"]);
  });

  it("does not create an attachment when configured delivery open rejects", async () => {
    const failure = new Error("delivery unavailable");
    const environment = configured({
      open: () => Promise.reject(failure),
      close: () => undefined,
      inbox: {},
      workRegistry: {},
    });

    const result: Error | EnvironmentAttachmentHandle = await serverEnvironmentAccess
      .attach(environment, { ownership: "caller", descriptors: [] })
      .then<Error | EnvironmentAttachmentHandle, Error | EnvironmentAttachmentHandle>(
        (attachment) => attachment,
        (error: unknown) => error as Error,
      );
    if (!(result instanceof Error)) await serverEnvironmentAccess.detach(environment, result);
    expect(result).toBe(failure);
  });

  it("coalesces delivery open across concurrent attachment attempts", async () => {
    let opens = 0;
    const environment = configured({
      open: () => {
        opens += 1;
      },
      close: () => undefined,
      inbox: {},
      workRegistry: {},
    });

    const attachments = await Promise.all([
      serverEnvironmentAccess.attach(environment, { ownership: "caller", descriptors: [] }),
      serverEnvironmentAccess.attach(environment, { ownership: "caller", descriptors: [] }),
    ]);
    await Promise.all(
      attachments.map((attachment) => serverEnvironmentAccess.detach(environment, attachment)),
    );
    const later = await serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [],
    });
    await serverEnvironmentAccess.detach(environment, later);

    expect(opens).toBe(1);
  });

  it("keeps existing close-only local delivery configuration compatible", async () => {
    const environment = configured({ close: () => undefined });

    const attachment = await serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [],
    });
    await serverEnvironmentAccess.detach(environment, attachment);
  });

  it("closes delivery transport tracer and storage in the approved order", async () => {
    const events: string[] = [];
    ServerEnvironment.when(EnvironmentType.Local).use({
      delivery: { close: () => events.push("delivery") },
      transport: { close: () => events.push("transport") } as never,
      tracerFactory: { close: () => events.push("tracer") },
      storageFactory: { close: () => events.push("storage") } as never,
    });

    await ServerEnvironment.instance().close();

    expect(events).toEqual(["delivery", "transport", "tracer", "storage"]);
  });

  it("retries only unfinished environment close phases after partial failure", async () => {
    const events: string[] = [];
    let fail = true;
    const environment = configured({
      close: () => {
        events.push("delivery");
        if (fail) {
          fail = false;
          throw new Error("delivery close failed");
        }
      },
    });

    await expect(environment.close()).rejects.toThrow("ServerEnvironment close failed.");
    await expect(environment.close()).resolves.toBeUndefined();

    expect(events).toEqual(["delivery", "delivery"]);
  });
});

function environmentDescriptor(environment: ServerEnvironment): ContextDeliveryDescriptor {
  const ready = {
    label: "UPDATE_SUBSCRIBER" as const,
    targetTypeUrl: "type.googleapis.com/example.EnvironmentPort",
    shard: ShardIndex.single(),
  };
  return Object.freeze({
    storageFactory: environment.storageFactory,
    startupScopes: () => Promise.resolve([{}]),
    storageContext: () =>
      Object.freeze({ name: "environment-port-integration", multitenant: false }) as StorageContext,
    endpoints: () => [ready],
    replay: () => Promise.resolve(),
    onReady: () => () => undefined,
    transition: (_scopes, onReady) => {
      onReady(ready);
      return Promise.resolve();
    },
  });
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempts = 0; attempts < 40; attempts += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for configured finite delivery ports.");
}
