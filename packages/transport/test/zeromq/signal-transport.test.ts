import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createTransportSubscription, createTransportTopic } from "../../src/index.js";
import { endpointFileAccess } from "../../src/zeromq/endpoint-files.js";
import { createZeroMqAdapterConfig, createZeroMqTransport } from "../../src/zeromq/index.js";
import { zeroMqSocketAccess } from "../../src/zeromq/signal-transport.js";

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

  it("removes a replier IPC pathname when its registration closes", async () => {
    await withZeroMqTransport(async (transport, ipcDirectory) => {
      const topic = createTransportTopic({
        signalKind: "command",
        messageTypeUrl: "type.spine.io/example.ReplierCleanupTask",
      });
      const subscription = createTransportSubscription({
        subscriberId: "command-worker-cleanup",
        topic,
        mode: "competing-consumer",
      });

      const handle = await transport.respond(subscription, () => ({ accepted: true }));
      expect(await readdir(ipcDirectory)).toHaveLength(1);

      await handle.close();

      expect(await readdir(ipcDirectory)).toEqual([]);
    });
  });

  it("closes a replier after bind failure and preserves cleanup failure second", async () => {
    const topic = createTransportTopic({
      signalKind: "command",
      messageTypeUrl: "type.spine.io/example.DuplicateResponderCleanupTask",
    });
    const subscription = createTransportSubscription({
      subscriberId: "duplicate-command-worker",
      topic,
      mode: "competing-consumer",
    });

    const bindFailure = new Error("injected responder bind failure");
    const bind = vi.spyOn(zeroMqSocketAccess, "bindReply").mockRejectedValue(bindFailure);

    try {
      await withZeroMqTransport(async (transport) => {
        const nativeClose = zeroMqSocketAccess.close.bind(zeroMqSocketAccess);
        const closeFailure = new Error("injected failed-bind replier close failure");
        const close = vi.spyOn(zeroMqSocketAccess, "close").mockImplementation((socket) => {
          nativeClose(socket);
          throw closeFailure;
        });

        try {
          let failure: unknown;
          try {
            await transport.respond(subscription, () => ({ accepted: false }));
          } catch (error) {
            failure = error;
          }

          expect(bind).toHaveBeenCalledTimes(1);
          expect(close).toHaveBeenCalledTimes(1);
          expect(failure).toBeInstanceOf(AggregateError);
          const errors = (failure as AggregateError).errors;
          expect(errors).toHaveLength(2);
          expect(errors[0]).toBe(bindFailure);
          expect(errors[1]).toBe(closeFailure);
        } finally {
          close.mockRestore();
        }
      });
    } finally {
      bind.mockRestore();
    }
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
      const firstHandle = await firstTransport.subscribe(subscriberOne, () => undefined);
      const secondHandle = await secondTransport.subscribe(subscriberTwo, () => undefined);

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

      const handle = await transport.subscribe(subscription, () => undefined);

      expect(await readdir(ipcDirectory)).toEqual([]);

      await handle.close();
    });
  });

  it("waits for a racing subscriber open and retires it before close settles", async () => {
    const prepareIpcDirectory = zeroMqSocketAccess.prepareIpcDirectory.bind(zeroMqSocketAccess);
    let preparationStarted!: () => void;
    let releasePreparation!: () => void;
    const started = new Promise<void>((resolve) => {
      preparationStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    const prepare = vi
      .spyOn(zeroMqSocketAccess, "prepareIpcDirectory")
      .mockImplementationOnce(async (ipcDirectory) => {
        preparationStarted();
        await released;
        await prepareIpcDirectory(ipcDirectory);
      });

    try {
      await withSharedZeroMqTransports(async (publisherTransport, subscriberTransport) => {
        const topic = createTransportTopic({
          signalKind: "event",
          messageTypeUrl: "type.spine.io/example.ClosingSubscriberSetupTask",
        });
        const subscription = createTransportSubscription({
          subscriberId: "closing-projection-worker",
          topic,
        });
        const received: string[] = [];
        const subscribe = subscriberTransport.subscribe<{ readonly taskId: string }, "event">(
          subscription,
          (operation) => {
            received.push(operation.envelope.taskId);
          },
        );
        await started;

        let closeSettled = false;
        const close = subscriberTransport.close().finally(() => {
          closeSettled = true;
        });

        try {
          await waitFor(0);
          expect(closeSettled).toBe(false);

          releasePreparation();
          await expect(subscribe).rejects.toThrow("ZeroMQ signal transport is closed.");
          await close;

          for (let attempt = 0; attempt < 5; attempt += 1) {
            await publisherTransport.publish({ topic, envelope: { taskId: "retired" } });
            await waitFor(publishCadenceMs);
          }
          await waitFor(100);

          expect(received).toEqual([]);
        } finally {
          releasePreparation();
          await Promise.allSettled([subscribe, close]);
        }
      });
    } finally {
      prepare.mockRestore();
    }
  });

  it("leaves sibling-owned pathnames intact when connect-only sockets close", async () => {
    await withSharedZeroMqTransports(async (ownerTransport, connectorTransport, ipcDirectory) => {
      const eventTopic = createTransportTopic({
        signalKind: "event",
        messageTypeUrl: "type.spine.io/example.ConnectOnlyOwnershipEvent",
      });
      const commandTopic = createTransportTopic({
        signalKind: "command",
        messageTypeUrl: "type.spine.io/example.ConnectOnlyOwnershipCommand",
      });
      const eventHandle = await connectorTransport.subscribe(
        createTransportSubscription({
          subscriberId: "connect-only-projection",
          topic: eventTopic,
        }),
        () => undefined,
      );
      const commandHandle = await ownerTransport.respond(
        createTransportSubscription({
          subscriberId: "owned-command-worker",
          topic: commandTopic,
          mode: "competing-consumer",
        }),
        () => ({ accepted: true }),
      );

      await ownerTransport.publish({ topic: eventTopic, envelope: { published: true } });
      await connectorTransport.request({ topic: commandTopic, envelope: { requested: true } });
      expect(await readdir(ipcDirectory)).toHaveLength(2);

      await eventHandle.close();
      await connectorTransport.close();

      expect(await readdir(ipcDirectory)).toHaveLength(2);

      await commandHandle.close();
      await ownerTransport.close();
      expect(await readdir(ipcDirectory)).toEqual([]);
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

  it("removes a publisher IPC pathname when the transport closes", async () => {
    await withZeroMqTransport(async (transport, ipcDirectory) => {
      const topic = createTransportTopic({
        signalKind: "event",
        messageTypeUrl: "type.spine.io/example.PublisherCleanupTask",
      });

      await transport.publish({ topic, envelope: { taskId: "task-published" } });
      expect(await readdir(ipcDirectory)).toHaveLength(1);

      await transport.close();

      expect(await readdir(ipcDirectory)).toEqual([]);
    });
  });

  it("attempts every bound pathname cleanup and retries only a failed unlink", async () => {
    const removeEndpointFile = endpointFileAccess.remove.bind(endpointFileAccess);
    const unlinkFailure = new Error("injected endpoint unlink failure");
    const remove = vi
      .spyOn(endpointFileAccess, "remove")
      .mockRejectedValueOnce(unlinkFailure)
      .mockImplementation(removeEndpointFile);

    try {
      await withZeroMqTransport(async (transport, ipcDirectory) => {
        const commandTopic = createTransportTopic({
          signalKind: "command",
          messageTypeUrl: "type.spine.io/example.RetryCleanupCommand",
        });
        const eventTopic = createTransportTopic({
          signalKind: "event",
          messageTypeUrl: "type.spine.io/example.RetryCleanupEvent",
        });
        await transport.respond(
          createTransportSubscription({
            subscriberId: "retry-cleanup-command-worker",
            topic: commandTopic,
            mode: "competing-consumer",
          }),
          () => ({ accepted: true }),
        );
        await transport.publish({ topic: eventTopic, envelope: { published: true } });
        expect(await readdir(ipcDirectory)).toHaveLength(2);

        const firstClose = transport.close();
        expect(transport.close()).toBe(firstClose);
        await expect(firstClose).rejects.toBe(unlinkFailure);
        expect(await readdir(ipcDirectory)).toHaveLength(1);

        const retry = transport.close();
        expect(transport.close()).toBe(retry);
        await retry;

        expect(await readdir(ipcDirectory)).toEqual([]);
        expect(remove).toHaveBeenCalledTimes(3);
      });
    } finally {
      remove.mockRestore();
    }
  });

  it("reports bound pathname cleanup failures in stable order and retries all of them", async () => {
    const removeEndpointFile = endpointFileAccess.remove.bind(endpointFileAccess);
    const replierFailure = new Error("injected replier unlink failure");
    const publisherFailure = new Error("injected publisher unlink failure");
    const remove = vi
      .spyOn(endpointFileAccess, "remove")
      .mockRejectedValueOnce(replierFailure)
      .mockRejectedValueOnce(publisherFailure)
      .mockImplementation(removeEndpointFile);

    try {
      await withZeroMqTransport(async (transport, ipcDirectory) => {
        const commandTopic = createTransportTopic({
          signalKind: "command",
          messageTypeUrl: "type.spine.io/example.StableCleanupCommand",
        });
        const eventTopic = createTransportTopic({
          signalKind: "event",
          messageTypeUrl: "type.spine.io/example.StableCleanupEvent",
        });
        await transport.respond(
          createTransportSubscription({
            subscriberId: "stable-cleanup-command-worker",
            topic: commandTopic,
            mode: "competing-consumer",
          }),
          () => ({ accepted: true }),
        );
        await transport.publish({ topic: eventTopic, envelope: { published: true } });

        let failure: unknown;
        try {
          await transport.close();
        } catch (error) {
          failure = error;
        }

        expect(failure).toBeInstanceOf(AggregateError);
        expect((failure as AggregateError).errors).toEqual([replierFailure, publisherFailure]);
        expect(await readdir(ipcDirectory)).toHaveLength(2);

        await transport.close();

        expect(await readdir(ipcDirectory)).toEqual([]);
        expect(remove).toHaveBeenCalledTimes(4);
      });
    } finally {
      remove.mockRestore();
    }
  });

  it("treats an already absent owned pathname as closed", async () => {
    await withZeroMqTransport(async (transport, ipcDirectory) => {
      const topic = createTransportTopic({
        signalKind: "event",
        messageTypeUrl: "type.spine.io/example.MissingCleanupTask",
      });
      await transport.publish({ topic, envelope: { published: true } });
      const [endpointFile] = await readdir(ipcDirectory);
      if (endpointFile === undefined) {
        throw new Error("Expected the publisher to bind an IPC pathname.");
      }
      await rm(path.join(ipcDirectory, endpointFile));

      await expect(transport.close()).resolves.toBeUndefined();
      expect(await readdir(ipcDirectory)).toEqual([]);
    });
  });

  it("removes a publisher pathname when close wins the bind race", async () => {
    await withZeroMqTransport(async (transport, ipcDirectory) => {
      const topic = createTransportTopic({
        signalKind: "event",
        messageTypeUrl: "type.spine.io/example.ClosingPublisherSetupTask",
      });

      const publish = transport.publish({ topic, envelope: { published: true } });
      const close = transport.close();

      await expect(publish).rejects.toThrow("ZeroMQ signal transport is closed.");
      await close;
      expect(await readdir(ipcDirectory)).toEqual([]);
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
    const transport = createZeroMqTransport(
      createZeroMqAdapterConfig({
        ipcDirectory,
        adapterIdentity: `open-${String(process.pid)}-${String(Date.now())}`,
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

      const handleClose = handle.close();
      expect(handle.close()).toBe(handleClose);
      await handleClose;
      const transportClose = transport.close();
      expect(transport.close()).toBe(transportClose);
      await transportClose;

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
    transport: ReturnType<typeof createZeroMqTransport>,
    ipcDirectory: string,
  ) => Promise<T>,
  options: Parameters<typeof createZeroMqTransport>[1] & {
    readonly onBackgroundFailure?: (error: Error) => void;
  } = {},
): Promise<T> {
  const ipcDirectory = await mkdtemp(path.join(tmpdir(), "sz-transport-"));
  const transport = createZeroMqTransport(
    createZeroMqAdapterConfig({
      ipcDirectory,
      adapterIdentity: `test-${String(process.pid)}-${String(Date.now())}`,
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
    firstTransport: ReturnType<typeof createZeroMqTransport>,
    secondTransport: ReturnType<typeof createZeroMqTransport>,
    ipcDirectory: string,
  ) => Promise<T>,
): Promise<T> {
  const ipcDirectory = await mkdtemp(path.join(tmpdir(), "sz-transport-"));
  const config = createZeroMqAdapterConfig({
    ipcDirectory,
    adapterIdentity: `test-${String(process.pid)}-${String(Date.now())}`,
  });
  const firstTransport = createZeroMqTransport(config);
  const secondTransport = createZeroMqTransport(config);

  try {
    return await runTest(firstTransport, secondTransport, ipcDirectory);
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
