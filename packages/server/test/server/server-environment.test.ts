import { afterEach, describe, expect, it } from "vitest";

import {
  ServerEnvironment,
  type ServerEnvironmentCloseable,
  serverEnvironmentAccess,
} from "../../src/server/server-environment.js";
import type { EnvironmentAttachmentHandle } from "../../src/server/environment-attachment.js";
import { EnvironmentType } from "../../src/server/environment.js";
import { resetServerEnvironmentForTest } from "../../src/testing/index.js";

afterEach(async () => {
  await resetServerEnvironmentForTest();
});

function configured(delivery: ServerEnvironmentCloseable & { open?: () => unknown }) {
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
    expect("inbox" in environment.delivery!).toBe(true);
    expect("workRegistry" in environment.delivery!).toBe(true);
  });

  it("opens configured delivery before the first environment attachment", async () => {
    let release: () => void = () => undefined;
    const environment = configured({
      open: () => new Promise<void>((resolve) => (release = resolve)),
      close: () => undefined,
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

  it("does not create an attachment when configured delivery open rejects", async () => {
    const failure = new Error("delivery unavailable");
    const environment = configured({ open: () => Promise.reject(failure), close: () => undefined });

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
