import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createTransportSubscription, createTransportTopic } from "../../src/index.js";
import { createZeroMqAdapterConfig, createZeroMqSignalTransport } from "../../src/zeromq/index.js";

const receiveTimeoutMs = 2_000;
const publishCadenceMs = 20;

describe("ZeroMQ SignalTransport", () => {
  it("publishes subscribed envelopes through the SignalTransport contract", async () => {
    await withZeroMqTransport(async (transport) => {
      const topic = createTransportTopic({
        signalKind: "event",
        messageTypeUrl: "type.spine.io/example.TaskCreated",
      });
      const subscription = createTransportSubscription({
        subscriberId: "projection-worker-1",
        topic,
      });
      const received: string[] = [];

      const handle = await transport.subscribe<{ readonly taskId: string }, "event">(
        subscription,
        (operation) => {
          received.push(operation.envelope.taskId);
        },
      );

      await publishUntil(
        () =>
          transport.publish({
            topic,
            envelope: { taskId: "task-123" },
          }),
        () => received.length > 0,
      );

      expect(received).toEqual(["task-123"]);

      await handle.close();
    });
  });

  it("round-trips request and response envelopes through the SignalTransport contract", async () => {
    await withZeroMqTransport(async (transport) => {
      const topic = createTransportTopic({
        signalKind: "command",
        messageTypeUrl: "type.spine.io/example.LookupTask",
      });
      const subscription = createTransportSubscription({
        subscriberId: "command-worker-1",
        topic,
        mode: "competing-consumer",
      });

      const handle = await transport.respond<
        { readonly taskId: string },
        { readonly found: boolean; readonly taskId: string },
        "command"
      >(subscription, (operation) => ({
        found: true,
        taskId: operation.envelope.taskId,
      }));

      const response = await transport.request<
        { readonly taskId: string },
        { readonly found: boolean; readonly taskId: string },
        "command"
      >({
        topic,
        envelope: { taskId: "task-456" },
      });

      expect(response).toEqual({ found: true, taskId: "task-456" });

      await handle.close();
    });
  });

  it("connects subscribers without binding the publish endpoint", async () => {
    const topic = createTransportTopic({
      signalKind: "event",
      messageTypeUrl: "type.spine.io/example.SharedPublishedTask",
    });
    const subscriberOne = createTransportSubscription({
      subscriberId: "projection-worker-1",
      topic,
    });
    const subscriberTwo = createTransportSubscription({
      subscriberId: "projection-worker-2",
      topic,
    });

    await withSharedZeroMqTransports(async (firstTransport, secondTransport) => {
      const firstHandle = await firstTransport.subscribe(subscriberOne, () => {});
      const secondHandle = await secondTransport.subscribe(subscriberTwo, () => {});

      await firstHandle.close();
      await secondHandle.close();
    });
  });

  it("does not create publish IPC socket files when subscribing", async () => {
    await withZeroMqTransport(async (transport, ipcDirectory) => {
      const topic = createTransportTopic({
        signalKind: "event",
        messageTypeUrl: "type.spine.io/example.ConnectOnlySubscriptionTask",
      });
      const subscription = createTransportSubscription({
        subscriberId: "projection-worker-1",
        topic,
      });

      const handle = await transport.subscribe(subscription, () => {});

      expect(await readdir(ipcDirectory)).toEqual([]);

      await handle.close();
    });
  });

  it("shares the first publisher bind across concurrent publishes", async () => {
    await withZeroMqTransport(async (transport) => {
      const topic = createTransportTopic({
        signalKind: "event",
        messageTypeUrl: "type.spine.io/example.ConcurrentPublishedTask",
      });

      await expect(
        Promise.all(
          Array.from({ length: 8 }, (_ignored, index) =>
            transport.publish({
              topic,
              envelope: { index },
            }),
          ),
        ),
      ).resolves.toHaveLength(8);
    });
  });

  it("records subscriber handler failures without stopping later deliveries", async () => {
    const failures: Error[] = [];

    await withZeroMqTransport(
      async (transport) => {
        const topic = createTransportTopic({
          signalKind: "event",
          messageTypeUrl: "type.spine.io/example.FailingSubscriberTask",
        });
        const subscription = createTransportSubscription({
          subscriberId: "projection-worker-1",
          topic,
        });
        const received: string[] = [];

        const handle = await transport.subscribe<{ readonly taskId: string }, "event">(
          subscription,
          (operation) => {
            received.push(operation.envelope.taskId);

            if (operation.envelope.taskId === "task-fails") {
              throw new Error("subscriber secret");
            }
          },
        );

        await publishUntil(
          () =>
            transport.publish({
              topic,
              envelope: { taskId: "task-fails" },
            }),
          () => failures.length > 0,
        );
        await publishUntil(
          () =>
            transport.publish({
              topic,
              envelope: { taskId: "task-recovers" },
            }),
          () => received.includes("task-recovers"),
        );

        expect(failures.length).toBeGreaterThan(0);
        expect(failures.every((failure) => failure.message === "subscriber secret")).toBe(true);
        expect(received).toContain("task-fails");
        expect(received.lastIndexOf("task-recovers")).toBeGreaterThan(
          received.indexOf("task-fails"),
        );

        await handle.close();
      },
      { onBackgroundFailure: (error) => failures.push(error) },
    );
  });

  it("records subscriber handler failures that look like socket stops", async () => {
    const failures: Error[] = [];

    await withZeroMqTransport(
      async (transport) => {
        const topic = createTransportTopic({
          signalKind: "event",
          messageTypeUrl: "type.spine.io/example.SocketNamedFailureTask",
        });
        const subscription = createTransportSubscription({
          subscriberId: "projection-worker-1",
          topic,
        });
        const handle = await transport.subscribe<{ readonly taskId: string }, "event">(
          subscription,
          () => {
            throw new Error("timed out");
          },
        );

        await publishUntil(
          () =>
            transport.publish({
              topic,
              envelope: { taskId: "task-fails" },
            }),
          () => failures.length > 0,
        );

        expect(failures.map((failure) => failure.message)).toContain("timed out");

        await handle.close();
      },
      { onBackgroundFailure: (error) => failures.push(error) },
    );
  });

  it("sanitizes request handler failures returned to requesters", async () => {
    await withZeroMqTransport(async (transport) => {
      const topic = createTransportTopic({
        signalKind: "command",
        messageTypeUrl: "type.spine.io/example.SecretFailingTask",
      });
      const subscription = createTransportSubscription({
        subscriberId: "command-worker-1",
        topic,
        mode: "competing-consumer",
      });

      const handle = await transport.respond(subscription, () => {
        throw new Error("database password leaked");
      });

      await expect(
        transport.request({
          topic,
          envelope: { taskId: "task-456" },
        }),
      ).rejects.toThrow("ZeroMQ request handler failed.");
      await expect(
        transport.request({
          topic,
          envelope: { taskId: "task-456" },
        }),
      ).rejects.not.toThrow("database password leaked");

      await handle.close();
    });
  });

  it("sanitizes request handler failures that look like socket stops", async () => {
    const failures: Error[] = [];

    await withZeroMqTransport(
      async (transport) => {
        const topic = createTransportTopic({
          signalKind: "command",
          messageTypeUrl: "type.spine.io/example.SocketNamedCommandFailure",
        });
        const subscription = createTransportSubscription({
          subscriberId: "command-worker-1",
          topic,
          mode: "competing-consumer",
        });

        const handle = await transport.respond(subscription, () => {
          throw new Error("EAGAIN");
        });

        await expect(
          transport.request({
            topic,
            envelope: { taskId: "task-456" },
          }),
        ).rejects.toThrow("ZeroMQ request handler failed.");
        expect(failures.map((failure) => failure.message)).toContain("EAGAIN");

        await handle.close();
      },
      { onBackgroundFailure: (error) => failures.push(error) },
    );
  });

  it("rejects unsafe IPC directories before publish, request, or response work", async () => {
    const ipcDirectory = await mkdtemp(path.join(tmpdir(), "sz-transport-open-"));
    const transport = createZeroMqSignalTransport(
      createZeroMqAdapterConfig({
        ipcDirectory,
        adapterIdentity: `open-${process.pid}-${Date.now()}`,
      }),
    );
    const topic = createTransportTopic({
      signalKind: "event",
      messageTypeUrl: "type.spine.io/example.OpenDirectoryTask",
    });

    try {
      await chmod(ipcDirectory, 0o755);

      await expect(transport.publish({ topic, envelope: "unsafe" })).rejects.toThrow(
        "ZeroMQ adapter ipcDirectory must be private to the current user.",
      );
      await expect(transport.request({ topic, envelope: "unsafe" })).rejects.toThrow(
        "ZeroMQ adapter ipcDirectory must be private to the current user.",
      );
      await expect(
        transport.respond(
          createTransportSubscription({
            subscriberId: "unsafe-command-worker",
            topic,
            mode: "competing-consumer",
          }),
          () => "unsafe",
        ),
      ).rejects.toThrow("ZeroMQ adapter ipcDirectory must be private to the current user.");
    } finally {
      await transport.close();
      await rm(ipcDirectory, { recursive: true, force: true });
    }
  });

  it("closes registrations and rejects later operations without exposing adapter details", async () => {
    await withZeroMqTransport(async (transport) => {
      const topic = createTransportTopic({
        signalKind: "command",
        messageTypeUrl: "type.spine.io/example.CloseTask",
      });
      const subscription = createTransportSubscription({
        subscriberId: "command-worker-1",
        topic,
        mode: "competing-consumer",
      });
      const handle = await transport.respond(subscription, () => ({ closed: false }));

      await handle.close();
      await handle.close();
      await transport.close();
      await transport.close();

      await expect(
        transport.request({
          topic,
          envelope: { taskId: "task-789" },
        }),
      ).rejects.toThrow(/closed/);
      expect(transport).not.toHaveProperty("endpoint");
      expect(transport).not.toHaveProperty("socket");
    });
  });
});

async function withZeroMqTransport<T>(
  runTest: (
    transport: ReturnType<typeof createZeroMqSignalTransport>,
    ipcDirectory: string,
  ) => Promise<T>,
  options: Parameters<typeof createZeroMqSignalTransport>[1] & {
    readonly onBackgroundFailure?: (error: Error) => void;
  } = {},
): Promise<T> {
  const ipcDirectory = await mkdtemp(path.join(tmpdir(), "sz-transport-"));
  const transport = createZeroMqSignalTransport(
    createZeroMqAdapterConfig({
      ipcDirectory,
      adapterIdentity: `test-${process.pid}-${Date.now()}`,
    }),
    options,
  );

  try {
    return await runTest(transport, ipcDirectory);
  } finally {
    await transport.close();
    await rm(ipcDirectory, { recursive: true, force: true });
  }
}

async function withSharedZeroMqTransports<T>(
  runTest: (
    firstTransport: ReturnType<typeof createZeroMqSignalTransport>,
    secondTransport: ReturnType<typeof createZeroMqSignalTransport>,
  ) => Promise<T>,
): Promise<T> {
  const ipcDirectory = await mkdtemp(path.join(tmpdir(), "sz-transport-"));
  const config = createZeroMqAdapterConfig({
    ipcDirectory,
    adapterIdentity: `test-${process.pid}-${Date.now()}`,
  });
  const firstTransport = createZeroMqSignalTransport(config);
  const secondTransport = createZeroMqSignalTransport(config);

  try {
    return await runTest(firstTransport, secondTransport);
  } finally {
    await Promise.all([firstTransport.close(), secondTransport.close()]);
    await rm(ipcDirectory, { recursive: true, force: true });
  }
}

async function publishUntil(publish: () => Promise<void>, received: () => boolean): Promise<void> {
  const maxPublishAttempts = Math.ceil(receiveTimeoutMs / publishCadenceMs);

  for (let attempt = 0; attempt < maxPublishAttempts; attempt += 1) {
    await publish();

    if (received()) {
      return;
    }

    await waitFor(publishCadenceMs);
  }

  expect(received()).toBe(true);
}

async function waitFor(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
