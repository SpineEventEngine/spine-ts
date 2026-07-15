import { chmod, mkdir, mkdtemp, readdir, realpath, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deserialize, serialize } from "node:v8";

import { create, toBinary } from "@bufbuild/protobuf";
import { CommandSchema, EventSchema, type Command, type Event } from "@spine-ts/proto";
import { describe, expect, it, vi } from "vitest";
import { Publisher, Reply, Request, Subscriber } from "zeromq";

import { createTransportSubscription, createTransportTopic } from "../../src/index.js";
import { endpointFileAccess } from "../../src/zeromq/endpoint-files.js";
import {
  createZeroMqAdapterConfig,
  createZeroMqTransport,
  type ZeroMqTransportOptions,
} from "../../src/zeromq/index.js";
import { zeroMqSocketAccess } from "../../src/zeromq/signal-transport.js";

const receiveTimeoutMs = 2_000;
const publishCadenceMs = 20;
const unansweredRequestTimeoutMs = 25;
const closeDeadlineMs = 275;
const ipcTemporaryRoot = process.platform === "darwin" ? "/tmp" : tmpdir();

type IsExact<T, Expected> = [T] extends [Expected]
  ? [Expected] extends [T]
    ? true
    : false
  : false;
const zeroMqOptionKeys: IsExact<
  keyof ZeroMqTransportOptions,
  "requestTimeoutMs" | "receiveTimeoutMs"
> = true;
void zeroMqOptionKeys;

describe("ZeroMQ SignalTransport", () => {
  it("rejects invalid request timeouts before IPC preparation", async () => {
    const ipcDirectory = await mkdtemp(path.join(tmpdir(), "sz-timeout-validation-"));
    const prepare = vi.spyOn(zeroMqSocketAccess, "prepareIpcDirectory");
    const config = createZeroMqAdapterConfig({
      ipcDirectory,
      adapterIdentity: `timeout-validation-${String(process.pid)}-${String(Date.now())}`,
    });

    try {
      for (const requestTimeoutMs of [
        0,
        -1,
        -2,
        1.5,
        Number.NaN,
        Infinity,
        -Infinity,
        2_147_483_648,
      ]) {
        expect(() => createZeroMqTransport(config, { requestTimeoutMs })).toThrow(
          new TypeError(
            "ZeroMQ transport requestTimeoutMs must be an integer from 1 through 2147483647.",
          ),
        );
      }
      expect(() => createZeroMqTransport(config)).not.toThrow();
      expect(() => createZeroMqTransport(config, { requestTimeoutMs: 1 })).not.toThrow();
      expect(() =>
        createZeroMqTransport(config, { requestTimeoutMs: 2_147_483_647 }),
      ).not.toThrow();
      expect(prepare).not.toHaveBeenCalled();
    } finally {
      prepare.mockRestore();
      await rm(ipcDirectory, { recursive: true, force: true });
    }
  });

  it("keeps publishers at the native default send timeout", async () => {
    const topic = createTransportTopic({
      signalKind: "system",
      messageTypeUrl: "type.spine.io/example.PublisherTimeoutScope",
    });
    const requestTimeoutMs = 123;
    let publisherSendTimeout: number | undefined;
    const bindPublisher = vi
      .spyOn(zeroMqSocketAccess, "bindPublisher")
      .mockImplementation((publisher) => {
        publisherSendTimeout = publisher.sendTimeout;
        return Promise.reject(new Error("stop after observing publisher options"));
      });

    try {
      await withZeroMqTransport(
        async (transport) => {
          await expect(
            transport.publish({ topic, envelope: { taskId: "task-timeout" } }),
          ).rejects.toThrow("stop after observing publisher options");
          expect(publisherSendTimeout).toBe(-1);
        },
        { requestTimeoutMs },
      );
    } finally {
      bindPublisher.mockRestore();
    }
  });

  it("sets receiver message caps before native endpoint work", async () => {
    const observed = new Map<string, number>();
    const connect = vi.spyOn(zeroMqSocketAccess, "connect").mockImplementation((socket) => {
      observed.set(socket.constructor.name, socket.maxMessageSize);
      throw new Error("stop after observing receiver options");
    });
    const bindReply = vi.spyOn(zeroMqSocketAccess, "bindReply").mockImplementation((socket) => {
      observed.set(socket.constructor.name, socket.maxMessageSize);
      return Promise.reject(new Error("stop after observing receiver options"));
    });

    try {
      await withZeroMqTransport(async (transport) => {
        const eventTopic = createTransportTopic({
          signalKind: "system",
          messageTypeUrl: "type.spine.io/example.ReceiverCapEvent",
        });
        await expect(
          transport.subscribe(
            createTransportSubscription({
              subscriberId: "receiver-cap-subscriber",
              topic: eventTopic,
            }),
            () => undefined,
          ),
        ).rejects.toThrow("stop after observing receiver options");
      });
      await withZeroMqTransport(async (transport) => {
        const commandTopic = createTransportTopic({
          signalKind: "system",
          messageTypeUrl: "type.spine.io/example.ReceiverCapCommand",
        });
        await expect(
          transport.request({ topic: commandTopic, envelope: { observed: true } }),
        ).rejects.toThrow("stop after observing receiver options");
        await expect(
          transport.respond(
            createTransportSubscription({
              subscriberId: "receiver-cap-replier",
              topic: commandTopic,
              mode: "competing-consumer",
            }),
            () => ({ observed: true }),
          ),
        ).rejects.toThrow("stop after observing receiver options");
      });

      expect(observed).toEqual(
        new Map([
          [Subscriber.name, 8_388_608],
          [Request.name, 8_388_608],
          [Reply.name, 8_388_608],
        ]),
      );
    } finally {
      bindReply.mockRestore();
      connect.mockRestore();
    }
  });

  it("sends command and event envelopes as their exact Buf binary bytes", async () => {
    const eventTopic = createTransportTopic({
      signalKind: "event",
      messageTypeUrl: "type.spine.io/example.BufOutboundEvent",
    });
    const commandTopic = createTransportTopic({
      signalKind: "command",
      messageTypeUrl: "type.spine.io/example.BufOutboundCommand",
    });
    const event = create(EventSchema);
    const command = create(CommandSchema);
    const sendPublisher = vi.spyOn(zeroMqSocketAccess, "sendPublisher");
    const sendRequest = vi
      .spyOn(zeroMqSocketAccess, "sendRequest")
      .mockRejectedValue(new Error("stop after observing request bytes"));

    try {
      await withZeroMqTransport(async (transport) => {
        await transport.publish({ topic: eventTopic, envelope: event });
        await expect(transport.request({ topic: commandTopic, envelope: command })).rejects.toThrow(
          "stop after observing request bytes",
        );

        expect(sendPublisher).toHaveBeenCalledWith(expect.any(Publisher), [
          eventTopic.routing.routingKey,
          Buffer.from(toBinary(EventSchema, event, { writeUnknownFields: false })),
        ]);
        expect(sendRequest).toHaveBeenCalledWith(expect.any(Request), [
          commandTopic.routing.routingKey,
          Buffer.from(toBinary(CommandSchema, command, { writeUnknownFields: false })),
        ]);
      });
    } finally {
      sendRequest.mockRestore();
      sendPublisher.mockRestore();
    }
  });

  it("decodes raw Buf event frames, ignores publish trailers, and continues after malformed bytes", async () => {
    const connectSocket = zeroMqSocketAccess.connect.bind(zeroMqSocketAccess);
    let subscriberAddress: string | undefined;
    const connect = vi
      .spyOn(zeroMqSocketAccess, "connect")
      .mockImplementation((socket, address) => {
        subscriberAddress = address;
        connectSocket(socket, address);
      });
    const topic = createTransportTopic({
      signalKind: "event",
      messageTypeUrl: "type.spine.io/example.BufInboundEvent",
    });
    const received: Event[] = [];
    const failures: Error[] = [];

    try {
      await withZeroMqTransport(
        async (transport) => {
          const handle = await transport.subscribe<Event, "event">(
            createTransportSubscription({ subscriberId: "buf-inbound-event", topic }),
            ({ envelope }) => {
              received.push(envelope);
            },
          );
          if (subscriberAddress === undefined) {
            throw new Error("Expected subscriber endpoint address.");
          }
          const publisher = new Publisher({ linger: 0 });
          const event = create(EventSchema);

          try {
            await publisher.bind(subscriberAddress);
            await waitFor(25);
            await publishUntil(
              () =>
                publisher.send([topic.routing.routingKey, Buffer.from([0x80]), "ignored trailer"]),
              () => failures.length > 0,
            );
            await publishUntil(
              () =>
                publisher.send([
                  topic.routing.routingKey,
                  Buffer.from(toBinary(EventSchema, event, { writeUnknownFields: false })),
                  "ignored trailer",
                ]),
              () => received.length === 1,
            );
            expect(received).toEqual([event]);
          } finally {
            publisher.close();
            await handle.close();
          }
        },
        { onBackgroundFailure: (error) => failures.push(error) },
      );
    } finally {
      connect.mockRestore();
    }
  });

  it("decodes raw Buf command frames, returns generic malformed failures, and ignores request trailers", async () => {
    const bindSocket = zeroMqSocketAccess.bindReply.bind(zeroMqSocketAccess);
    let replyAddress: string | undefined;
    const bind = vi.spyOn(zeroMqSocketAccess, "bindReply").mockImplementation((socket, address) => {
      replyAddress = address;
      return bindSocket(socket, address);
    });
    const topic = createTransportTopic({
      signalKind: "command",
      messageTypeUrl: "type.spine.io/example.BufInboundCommand",
    });
    const received: Command[] = [];

    try {
      await withZeroMqTransport(async (transport) => {
        const handle = await transport.respond<Command, { readonly status: string }, "command">(
          createTransportSubscription({
            subscriberId: "buf-inbound-command",
            topic,
            mode: "competing-consumer",
          }),
          ({ envelope }) => {
            received.push(envelope);
            return { status: "accepted" };
          },
        );
        if (replyAddress === undefined) {
          throw new Error("Expected replier endpoint address.");
        }
        const requester = new Request({ linger: 0, receiveTimeout: 500, sendTimeout: 500 });
        const command = create(CommandSchema);

        try {
          requester.connect(replyAddress);
          await requester.send([topic.routing.routingKey, Buffer.from([0x80])]);
          const [malformedReply] = await requester.receive();
          if (malformedReply === undefined) {
            throw new Error("Expected malformed-command failure reply.");
          }
          expect(deserialize(malformedReply)).toEqual({
            status: "failed",
            message: "ZeroMQ request handler failed.",
          });
          expect(received).toEqual([]);

          await requester.send([
            topic.routing.routingKey,
            Buffer.from(toBinary(CommandSchema, command, { writeUnknownFields: false })),
            "ignored trailer",
          ]);
          await expect(requester.receive()).resolves.toHaveLength(1);
          expect(received).toEqual([command]);
        } finally {
          requester.close();
          await handle.close();
        }
      });
    } finally {
      bind.mockRestore();
    }
  });

  it("consumes only the first raw reply frame when trailers follow a valid private reply", async () => {
    const connectSocket = zeroMqSocketAccess.connect.bind(zeroMqSocketAccess);
    const addressReady = deferred<string>();
    let captured = false;
    const connect = vi
      .spyOn(zeroMqSocketAccess, "connect")
      .mockImplementation((socket, address) => {
        connectSocket(socket, address);
        if (socket instanceof Request && !captured) {
          captured = true;
          addressReady.resolve(address);
        }
      });
    const replier = new Reply({ linger: 0, receiveTimeout: 1_000, sendTimeout: 1_000 });
    const topic = createTransportTopic({
      signalKind: "command",
      messageTypeUrl: "type.spine.io/example.RawReplyTrailers",
    });
    const command = create(CommandSchema);

    try {
      await withZeroMqTransport(async (transport) => {
        const request = transport.request<Command, { readonly accepted: boolean }, "command">({
          topic,
          envelope: command,
        });
        await replier.bind(await addressReady.promise);
        const requestFrames = await replier.receive();

        expect(requestFrames).toEqual([
          Buffer.from(topic.routing.routingKey),
          Buffer.from(toBinary(CommandSchema, command, { writeUnknownFields: false })),
        ]);
        await replier.send([
          serialize({ status: "accepted", envelope: { accepted: true } }),
          "ignored trailer",
          "another ignored trailer",
        ]);
        await expect(request).resolves.toEqual({ accepted: true });
      });
    } finally {
      replier.close();
      connect.mockRestore();
    }
  });

  it("rejects a generated Proto successful reply and serves a later plain result", async () => {
    const commandTopic = createTransportTopic({
      signalKind: "command",
      messageTypeUrl: "type.spine.io/example.ProtoReplyRejected",
    });
    const subscription = createTransportSubscription({
      subscriberId: "proto-reply-rejected",
      topic: commandTopic,
      mode: "competing-consumer",
    });

    await withZeroMqTransport(async (transport) => {
      let attempt = 0;
      const handle = await transport.respond<
        Command,
        Event | { readonly accepted: boolean },
        "command"
      >(subscription, () => {
        attempt += 1;
        return attempt === 1 ? create(EventSchema) : { accepted: true };
      });

      await expect(
        transport.request<Command, Event | { readonly accepted: boolean }, "command">({
          topic: commandTopic,
          envelope: create(CommandSchema),
        }),
      ).rejects.toThrow("ZeroMQ request handler failed.");
      await expect(
        transport.request<Command, { readonly accepted: boolean }, "command">({
          topic: commandTopic,
          envelope: create(CommandSchema),
        }),
      ).resolves.toEqual({ accepted: true });
      expect(attempt).toBe(2);
      await handle.close();
    });
  });

  it("reserves string $typeName on private successful replies", async () => {
    const topic = createTransportTopic({
      signalKind: "command",
      messageTypeUrl: "type.spine.io/example.ReservedReplyTypeName",
    });

    await withZeroMqTransport(async (transport) => {
      const handle = await transport.respond<
        Command,
        { readonly $typeName: string; readonly accepted: boolean },
        "command"
      >(
        createTransportSubscription({
          subscriberId: "reserved-reply-type-name",
          topic,
          mode: "competing-consumer",
        }),
        () => ({ $typeName: "private.Result", accepted: true }),
      );

      await expect(
        transport.request<
          Command,
          { readonly $typeName: string; readonly accepted: boolean },
          "command"
        >({ topic, envelope: create(CommandSchema) }),
      ).rejects.toThrow("ZeroMQ request handler failed.");
      await handle.close();
    });
  });

  it("drops an oversized raw publish frame and receives a later valid delivery", async () => {
    const connectSocket = zeroMqSocketAccess.connect.bind(zeroMqSocketAccess);
    let subscriberAddress: string | undefined;
    const connect = vi
      .spyOn(zeroMqSocketAccess, "connect")
      .mockImplementation((socket, address) => {
        subscriberAddress = address;
        connectSocket(socket, address);
      });

    try {
      await withZeroMqTransport(async (transport) => {
        const topic = createTransportTopic({
          signalKind: "system",
          messageTypeUrl: "type.spine.io/example.OversizedRawPublish",
        });
        const received: string[] = [];
        const handle = await transport.subscribe<{ readonly value: string }, "system">(
          createTransportSubscription({ subscriberId: "oversized-raw-publish", topic }),
          ({ envelope }) => {
            received.push(envelope.value);
          },
        );
        if (subscriberAddress === undefined) {
          throw new Error("Expected subscriber endpoint address.");
        }
        const publisher = new Publisher({ linger: 0 });

        try {
          await publisher.bind(subscriberAddress);
          await waitFor(25);
          await publisher.send([topic.routing.routingKey, Buffer.alloc(8_388_609, 0x61)]);
          await waitFor(receiveTimeoutMs + 25);
          expect(received).toEqual([]);

          await publishUntil(
            async () => {
              await publisher.send([topic.routing.routingKey, serialize({ value: "valid" })]);
            },
            () => received.includes("valid"),
          );
          expect(received).toEqual(["valid"]);
        } finally {
          publisher.close();
          await handle.close();
        }
      });
    } finally {
      connect.mockRestore();
    }
  });

  it("drops an oversized raw request frame and serves a later valid request", async () => {
    const bindSocket = zeroMqSocketAccess.bindReply.bind(zeroMqSocketAccess);
    let replyAddress: string | undefined;
    const bind = vi.spyOn(zeroMqSocketAccess, "bindReply").mockImplementation((socket, address) => {
      replyAddress = address;
      return bindSocket(socket, address);
    });

    try {
      await withZeroMqTransport(async (transport) => {
        const topic = createTransportTopic({
          signalKind: "system",
          messageTypeUrl: "type.spine.io/example.OversizedRawRequest",
        });
        const received: string[] = [];
        const handle = await transport.respond<
          { readonly value: string },
          { readonly ok: boolean },
          "system"
        >(
          createTransportSubscription({
            subscriberId: "oversized-raw-request",
            topic,
            mode: "competing-consumer",
          }),
          ({ envelope }) => {
            received.push(envelope.value);
            return { ok: true };
          },
        );
        if (replyAddress === undefined) {
          throw new Error("Expected replier endpoint address.");
        }
        const requester = new Request({ linger: 0, receiveTimeout: 100, sendTimeout: 100 });

        try {
          requester.connect(replyAddress);
          await requester.send([topic.routing.routingKey, Buffer.alloc(8_388_609, 0x61)]);
          await expect(requester.receive()).rejects.toBeInstanceOf(Error);
          expect(received).toEqual([]);
        } finally {
          requester.close();
        }

        await expect(
          transport.request<{ readonly value: string }, { readonly ok: boolean }, "system">({
            topic,
            envelope: { value: "valid" },
          }),
        ).resolves.toEqual({ ok: true });
        expect(received).toEqual(["valid"]);
        await handle.close();
      });
    } finally {
      bind.mockRestore();
    }
  });

  it("bounds an oversized raw reply and accepts a later valid reply", async () => {
    const connectSocket = zeroMqSocketAccess.connect.bind(zeroMqSocketAccess);
    const addressReady = deferred<string>();
    let captured = false;
    const connect = vi
      .spyOn(zeroMqSocketAccess, "connect")
      .mockImplementation((socket, address) => {
        connectSocket(socket, address);
        if (socket instanceof Request && !captured) {
          captured = true;
          addressReady.resolve(address);
        }
      });
    const replier = new Reply({ linger: 0, receiveTimeout: 1_000, sendTimeout: 1_000 });

    try {
      await withZeroMqTransport(
        async (transport) => {
          const topic = createTransportTopic({
            signalKind: "system",
            messageTypeUrl: "type.spine.io/example.OversizedRawReply",
          });
          const oversized = transport.request({ topic, envelope: { value: "oversized" } });
          await replier.bind(await addressReady.promise);
          await replier.receive();
          await replier.send(Buffer.alloc(8_388_609, 0xff));

          await expect(
            withHarnessDeadline(oversized, "oversized raw reply timeout", 1_000),
          ).rejects.toThrow(/temporarily unavailable|timed out|EAGAIN/iu);

          const valid = transport.request<
            { readonly value: string },
            { readonly ok: boolean },
            "system"
          >({
            topic,
            envelope: { value: "valid" },
          });
          await replier.receive();
          await replier.send(serialize({ status: "accepted", envelope: { ok: true } }));
          await expect(valid).resolves.toEqual({ ok: true });
        },
        { requestTimeoutMs: 500 },
      );
    } finally {
      replier.close();
      connect.mockRestore();
    }
  });

  it("blocks a pre-bound publish when close starts after publisher lookup", async () => {
    const topic = createTransportTopic({
      signalKind: "system",
      messageTypeUrl: "type.spine.io/example.PreBoundClosingPublish",
    });
    await withZeroMqTransport(async (transport) => {
      await transport.publish({ topic, envelope: { sequence: 1 } });
      const send = vi.spyOn(Publisher.prototype, "send");

      try {
        const publish = transport.publish({ topic, envelope: { sequence: 2 } });
        const close = transport.close();

        await expect(publish).rejects.toThrow("ZeroMQ signal transport is closed.");
        await close;
        expect(send).not.toHaveBeenCalled();
      } finally {
        send.mockRestore();
      }
    });
  });

  it("closes a publisher before draining its already-started send", async () => {
    const topic = createTransportTopic({
      signalKind: "system",
      messageTypeUrl: "type.spine.io/example.PausedClosingPublish",
    });
    const removeEndpoint = endpointFileAccess.remove.bind(endpointFileAccess);
    const pathnameRemoved = deferred<undefined>();
    const remove = vi.spyOn(endpointFileAccess, "remove").mockImplementation(async (filePath) => {
      await removeEndpoint(filePath);
      pathnameRemoved.resolve(undefined);
    });

    try {
      await withZeroMqTransport(async (transport, ipcDirectory) => {
        await transport.publish({ topic, envelope: { sequence: 1 } });
        const sendFailure = new Error("injected publisher send failure");
        const sendStarted = deferred<undefined>();
        const sendReleased = deferred<undefined>();
        const send = vi.spyOn(Publisher.prototype, "send").mockImplementationOnce(async () => {
          sendStarted.resolve(undefined);
          await sendReleased.promise;
          throw sendFailure;
        });
        const order: string[] = [];
        let closeSettled = false;

        const publish = transport.publish({ topic, envelope: { sequence: 2 } });
        const publishOutcome = publish.then(
          () => undefined,
          (error: unknown) => {
            order.push("publish-settled");
            return error;
          },
        );
        await sendStarted.promise;
        const close = transport.close().then(() => {
          closeSettled = true;
          order.push("close-complete");
        });

        try {
          await pathnameRemoved.promise;
          await waitFor(0);
          expect(closeSettled).toBe(false);

          sendReleased.resolve(undefined);
          await expect(publishOutcome).resolves.toBe(sendFailure);
          await close;

          expect(order).toEqual(["publish-settled", "close-complete"]);
          expect(await readdir(ipcDirectory)).toEqual([]);
        } finally {
          sendReleased.resolve(undefined);
          await Promise.allSettled([publishOutcome, close]);
          send.mockRestore();
        }
      });
    } finally {
      remove.mockRestore();
    }
  });

  it("keeps paused publish and cleanup failures with their initiating callers", async () => {
    const topic = createTransportTopic({
      signalKind: "system",
      messageTypeUrl: "type.spine.io/example.PausedClosingCleanupFailure",
    });
    const removeEndpoint = endpointFileAccess.remove.bind(endpointFileAccess);
    const cleanupFailure = new Error("injected publisher pathname cleanup failure");
    const cleanupAttempted = deferred<undefined>();
    const remove = vi
      .spyOn(endpointFileAccess, "remove")
      .mockImplementationOnce(() => {
        cleanupAttempted.resolve(undefined);
        return Promise.reject(cleanupFailure);
      })
      .mockImplementation(removeEndpoint);

    try {
      await withZeroMqTransport(async (transport, ipcDirectory) => {
        await transport.publish({ topic, envelope: { sequence: 1 } });
        const sendFailure = new Error("injected paused publisher send failure");
        const sendStarted = deferred<undefined>();
        const sendReleased = deferred<undefined>();
        const send = vi.spyOn(Publisher.prototype, "send").mockImplementationOnce(async () => {
          sendStarted.resolve(undefined);
          await sendReleased.promise;
          throw sendFailure;
        });
        const order: string[] = [];
        let closeSettled = false;

        const publish = transport.publish({ topic, envelope: { sequence: 2 } });
        const publishOutcome = publish.then(
          () => undefined,
          (error: unknown) => {
            order.push("publish-settled");
            return error;
          },
        );
        await sendStarted.promise;
        const closeOutcome = transport.close().then(
          () => undefined,
          (error: unknown) => {
            closeSettled = true;
            order.push("close-settled");
            return error;
          },
        );

        try {
          await cleanupAttempted.promise;
          await waitFor(0);
          const closeSettledBeforeSend = closeSettled;

          sendReleased.resolve(undefined);
          await expect(publishOutcome).resolves.toBe(sendFailure);
          await expect(closeOutcome).resolves.toBe(cleanupFailure);
          expect(order).toEqual(["publish-settled", "close-settled"]);

          await transport.close();
          expect(await readdir(ipcDirectory)).toEqual([]);
          expect(remove).toHaveBeenCalledTimes(2);
          expect(closeSettledBeforeSend).toBe(false);
        } finally {
          sendReleased.resolve(undefined);
          await Promise.allSettled([publishOutcome, closeOutcome]);
          send.mockRestore();
        }
      });
    } finally {
      remove.mockRestore();
    }
  });

  it("publishes subscribed envelopes through the SignalTransport contract", async () => {
    await withZeroMqTransport(async (transport) => {
      const topic = createTransportTopic({
        signalKind: "system",
        messageTypeUrl: "type.spine.io/example.TaskCreated",
      });
      const subscription = createTransportSubscription({
        subscriberId: "projection-worker-1",
        topic,
      });
      const received: string[] = [];

      const handle = await transport.subscribe<{ readonly taskId: string }, "system">(
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
        signalKind: "system",
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
        "system"
      >(subscription, (operation) => ({
        found: true,
        taskId: operation.envelope.taskId,
      }));

      const response = await transport.request<
        { readonly taskId: string },
        { readonly found: boolean; readonly taskId: string },
        "system"
      >({
        topic,
        envelope: { taskId: "task-456" },
      });

      expect(response).toEqual({ found: true, taskId: "task-456" });

      await handle.close();
    });
  });

  it("closes the successful request socket exactly once before resolving", async () => {
    const topic = createTransportTopic({
      signalKind: "system",
      messageTypeUrl: "type.spine.io/example.SuccessfulRequestCleanup",
    });
    const sendRequest = zeroMqSocketAccess.sendRequest.bind(zeroMqSocketAccess);
    let requester!: Parameters<typeof zeroMqSocketAccess.sendRequest>[0];
    const send = vi
      .spyOn(zeroMqSocketAccess, "sendRequest")
      .mockImplementation(async (socket, frames) => {
        requester = socket;
        await sendRequest(socket, frames);
      });
    const close = vi.spyOn(zeroMqSocketAccess, "close");

    try {
      await withZeroMqTransport(async (transport) => {
        const handle = await transport.respond(
          createTransportSubscription({
            subscriberId: "successful-request-cleanup-worker",
            topic,
            mode: "competing-consumer",
          }),
          () => ({ accepted: true }),
        );

        await expect(transport.request({ topic, envelope: { requested: true } })).resolves.toEqual({
          accepted: true,
        });
        expect(close.mock.calls.filter(([socket]) => socket === requester)).toHaveLength(1);

        await handle.close();
      });
    } finally {
      close.mockRestore();
      send.mockRestore();
    }
  });

  it("surfaces successful request cleanup failure without aggregation", async () => {
    const topic = createTransportTopic({
      signalKind: "system",
      messageTypeUrl: "type.spine.io/example.SuccessfulRequestCleanupFailure",
    });
    const sendRequest = zeroMqSocketAccess.sendRequest.bind(zeroMqSocketAccess);
    const closeSocket = zeroMqSocketAccess.close.bind(zeroMqSocketAccess);
    const cleanupFailure = new Error("injected successful requester cleanup failure");
    let requester!: Parameters<typeof zeroMqSocketAccess.sendRequest>[0];
    const send = vi
      .spyOn(zeroMqSocketAccess, "sendRequest")
      .mockImplementation(async (socket, frames) => {
        requester = socket;
        await sendRequest(socket, frames);
      });
    const close = vi.spyOn(zeroMqSocketAccess, "close").mockImplementation((socket) => {
      closeSocket(socket);
      if (socket === requester) {
        throw cleanupFailure;
      }
    });

    try {
      await withZeroMqTransport(async (transport) => {
        const handle = await transport.respond(
          createTransportSubscription({
            subscriberId: "successful-request-cleanup-failure-worker",
            topic,
            mode: "competing-consumer",
          }),
          () => ({ accepted: true }),
        );

        await expect(transport.request({ topic, envelope: { requested: true } })).rejects.toBe(
          cleanupFailure,
        );

        await handle.close();
      });
    } finally {
      close.mockRestore();
      send.mockRestore();
    }
  });

  it("bounds close after an already-sent unanswered request", async () => {
    await withZeroMqTransport(
      async (transport) => {
        const topic = createTransportTopic({
          signalKind: "system",
          messageTypeUrl: "type.spine.io/example.UnansweredCloseRequest",
        });
        const started = deferred<undefined>();
        await transport.respond(
          createTransportSubscription({
            subscriberId: "unanswered-close-worker",
            topic,
            mode: "competing-consumer",
          }),
          async () => {
            started.resolve(undefined);
            return await new Promise<never>(() => undefined);
          },
        );

        const order: string[] = [];
        const request = transport.request({ topic, envelope: { requested: true } });
        const observedRequest = request.catch((error: unknown) => {
          order.push("request-settled");
          return error;
        });
        await started.promise;

        const close = transport.close().then(() => {
          order.push("close-complete");
        });
        await expect(
          withHarnessDeadline(close, "unanswered request close", closeDeadlineMs),
        ).resolves.toBeUndefined();
        await expect(request).rejects.toBeInstanceOf(Error);
        await expect(observedRequest).resolves.toBeInstanceOf(Error);
        expect(order).toEqual(["request-settled", "close-complete"]);
      },
      { requestTimeoutMs: unansweredRequestTimeoutMs },
    );
  });

  it("removes a replier IPC pathname when its registration closes", async () => {
    await withZeroMqTransport(async (transport, ipcDirectory) => {
      const topic = createTransportTopic({
        signalKind: "system",
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
      signalKind: "system",
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

  it("preserves request failure before socket cleanup failure", async () => {
    const requestFailure = new Error("injected request send failure");
    const send = vi.spyOn(zeroMqSocketAccess, "sendRequest").mockRejectedValue(requestFailure);

    try {
      await withZeroMqTransport(async (transport) => {
        const nativeClose = zeroMqSocketAccess.close.bind(zeroMqSocketAccess);
        const closeFailure = new Error("injected requester close failure");
        const close = vi.spyOn(zeroMqSocketAccess, "close").mockImplementation((socket) => {
          nativeClose(socket);
          throw closeFailure;
        });
        const topic = createTransportTopic({
          signalKind: "system",
          messageTypeUrl: "type.spine.io/example.RequestCleanupFailureTask",
        });

        try {
          let failure: unknown;
          try {
            await transport.request({ topic, envelope: { requested: true } });
          } catch (error) {
            failure = error;
          }

          expect(failure).toBeInstanceOf(AggregateError);
          expect((failure as AggregateError).errors).toEqual([requestFailure, closeFailure]);
          expect((failure as AggregateError).message).toBe("ZeroMQ request and cleanup failed.");
        } finally {
          close.mockRestore();
        }
      });
    } finally {
      send.mockRestore();
    }
  });

  it("preserves publisher bind failure before socket cleanup failure", async () => {
    const bindFailure = new Error("injected publisher bind failure");
    const bind = vi.spyOn(zeroMqSocketAccess, "bindPublisher").mockRejectedValue(bindFailure);

    try {
      await withZeroMqTransport(async (transport) => {
        const nativeClose = zeroMqSocketAccess.close.bind(zeroMqSocketAccess);
        const closeFailure = new Error("injected pre-bound publisher close failure");
        const close = vi.spyOn(zeroMqSocketAccess, "close").mockImplementation((socket) => {
          nativeClose(socket);
          throw closeFailure;
        });
        const topic = createTransportTopic({
          signalKind: "system",
          messageTypeUrl: "type.spine.io/example.PublisherCleanupFailureTask",
        });

        try {
          let failure: unknown;
          try {
            await transport.publish({ topic, envelope: { published: true } });
          } catch (error) {
            failure = error;
          }

          expect(failure).toBeInstanceOf(AggregateError);
          expect((failure as AggregateError).errors).toEqual([bindFailure, closeFailure]);
          expect((failure as AggregateError).message).toBe(
            "ZeroMQ publisher bind and cleanup failed.",
          );
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
      signalKind: "system",
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
        signalKind: "system",
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
        return await prepareIpcDirectory(ipcDirectory);
      });

    try {
      await withSharedZeroMqTransports(async (publisherTransport, subscriberTransport) => {
        const topic = createTransportTopic({
          signalKind: "system",
          messageTypeUrl: "type.spine.io/example.ClosingSubscriberSetupTask",
        });
        const subscription = createTransportSubscription({
          subscriberId: "closing-projection-worker",
          topic,
        });
        const received: string[] = [];
        const subscribe = subscriberTransport.subscribe<{ readonly taskId: string }, "system">(
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

  it("bounds shared fixture cleanup when a transport is paused during preparation", async () => {
    await expectPausedSharedClose({
      transport: "first",
      messageTypeUrl: "type.spine.io/example.PausedSharedFixturePreparation",
      subscriberId: "paused-shared-fixture",
      outerDeadlineLabel: "outer shared fixture cleanup",
      expectedCloseTimeout: "Timed out waiting for first ZeroMQ shared test fixture close.",
    });
  });

  it("bounds the second shared fixture close when its transport is paused during preparation", async () => {
    await expectPausedSharedClose({
      transport: "second",
      messageTypeUrl: "type.spine.io/example.PausedSecondSharedFixturePreparation",
      subscriberId: "paused-second-shared-fixture",
      outerDeadlineLabel: "outer second shared fixture cleanup",
      expectedCloseTimeout: "Timed out waiting for second ZeroMQ shared test fixture close.",
    });
  });

  it("waits for a pending sibling bounded close before removing the shared fixture directory", async () => {
    const firstCloseFailure = new Error("first shared fixture close failure");
    const pendingSecondClose = deferred<undefined>();
    let ipcDirectory: string | undefined;
    let fixtureOutcome: Promise<unknown> = Promise.resolve<unknown>(undefined);
    let restoreFirstClose: (() => void) | undefined;
    let restoreSecondClose: (() => void) | undefined;

    try {
      fixtureOutcome = withSharedZeroMqTransports((firstTransport, secondTransport, directory) => {
        ipcDirectory = directory;
        const firstClose = vi
          .spyOn(firstTransport, "close")
          .mockRejectedValueOnce(firstCloseFailure);
        const secondClose = vi
          .spyOn(secondTransport, "close")
          .mockImplementationOnce(() => pendingSecondClose.promise);
        restoreFirstClose = () => {
          firstClose.mockRestore();
        };
        restoreSecondClose = () => {
          secondClose.mockRestore();
        };
        return Promise.resolve();
      }).catch((error: unknown) => error);

      await waitFor(closeDeadlineMs / 4);
      await expect(readdir(ipcDirectory ?? "")).resolves.toEqual([]);
      await expect(
        withHarnessDeadline(
          fixtureOutcome,
          "outer pending sibling shared fixture cleanup",
          closeDeadlineMs * 2,
        ),
      ).resolves.toBe(firstCloseFailure);
    } finally {
      pendingSecondClose.resolve(undefined);
      await fixtureOutcome;
      restoreFirstClose?.();
      restoreSecondClose?.();
    }
  });

  it.each([
    ["subscriber-connect", "preparation"],
    ["subscriber-connect", "recheck"],
    ["responder-bind", "preparation"],
    ["responder-bind", "recheck"],
    ["publisher-bind", "preparation"],
    ["publisher-bind", "recheck"],
    ["request-connect", "preparation"],
    ["request-connect", "recheck"],
  ] as const)("blocks %s native work when close starts during %s", async (operation, boundary) => {
    await expectCloseBlocksNative(operation, boundary);
  });

  it("leaves sibling-owned pathnames intact when connect-only sockets close", async () => {
    await withSharedZeroMqTransports(async (ownerTransport, connectorTransport, ipcDirectory) => {
      const eventTopic = createTransportTopic({
        signalKind: "system",
        messageTypeUrl: "type.spine.io/example.ConnectOnlyOwnershipEvent",
      });
      const commandTopic = createTransportTopic({
        signalKind: "system",
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
        signalKind: "system",
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
        signalKind: "system",
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
          signalKind: "system",
          messageTypeUrl: "type.spine.io/example.RetryCleanupCommand",
        });
        const eventTopic = createTransportTopic({
          signalKind: "system",
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
          signalKind: "system",
          messageTypeUrl: "type.spine.io/example.StableCleanupCommand",
        });
        const eventTopic = createTransportTopic({
          signalKind: "system",
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
        signalKind: "system",
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
        signalKind: "system",
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
          signalKind: "system",
          messageTypeUrl: "type.spine.io/example.FailingSubscriberTask",
        });
        const subscription = createTransportSubscription({
          subscriberId: "projection-worker-1",
          topic,
        });
        const received: string[] = [];

        const handle = await transport.subscribe<{ readonly taskId: string }, "system">(
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
      {
        onBackgroundFailure: (error) => {
          failures.push(error);
          throw new Error("observer failure");
        },
      },
    );
  });

  it("records subscriber handler failures that look like socket stops", async () => {
    const failures: Error[] = [];

    await withZeroMqTransport(
      async (transport) => {
        const topic = createTransportTopic({
          signalKind: "system",
          messageTypeUrl: "type.spine.io/example.SocketNamedFailureTask",
        });
        const subscription = createTransportSubscription({
          subscriberId: "projection-worker-1",
          topic,
        });
        const handle = await transport.subscribe<{ readonly taskId: string }, "system">(
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
        signalKind: "system",
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
          signalKind: "system",
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
      signalKind: "system",
      messageTypeUrl: "type.spine.io/example.OpenDirectoryTask",
    });

    try {
      await chmod(ipcDirectory, 0o755);

      await expect(transport.publish({ topic, envelope: "unsafe" })).rejects.toThrow(
        "ZeroMQ adapter ipcDirectory must have exact POSIX mode 0700.",
      );
      await expect(transport.request({ topic, envelope: "unsafe" })).rejects.toThrow(
        "ZeroMQ adapter ipcDirectory must have exact POSIX mode 0700.",
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
      ).rejects.toThrow("ZeroMQ adapter ipcDirectory must have exact POSIX mode 0700.");
    } finally {
      await transport.close();
      await rm(ipcDirectory, { recursive: true, force: true });
    }
  });

  it("rejects a final IPC directory symlink", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "sz-final-link-"));
    const target = path.join(parent, "target");
    const link = path.join(parent, "ipc-link");

    try {
      await mkdir(target, { mode: 0o700 });
      await symlink(target, link, "dir");

      await expect(zeroMqSocketAccess.prepareIpcDirectory(link)).rejects.toThrow(/symlink/iu);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "rejects a user-owned ancestor IPC directory symlink",
    async () => {
      const parent = await mkdtemp(path.join(tmpdir(), "sz-ancestor-link-"));
      const target = path.join(parent, "target");
      const link = path.join(parent, "alias");

      try {
        await mkdir(path.join(target, "ipc"), { recursive: true, mode: 0o700 });
        await symlink(target, link, "dir");

        await expect(
          zeroMqSocketAccess.prepareIpcDirectory(path.join(link, "ipc")),
        ).rejects.toThrow(/ancestor symlink/iu);
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "uses the canonical endpoint behind the macOS system temporary-directory alias",
    async () => {
      const ipcDirectory = await mkdtemp(path.join(ipcTemporaryRoot, "sz-ca-"));
      const canonicalDirectory = await realpath(ipcDirectory);
      const config = createZeroMqAdapterConfig({
        ipcDirectory,
        adapterIdentity: `system-alias-${String(process.pid)}`,
      });
      const transport = createZeroMqTransport(config);
      const nativeBind = zeroMqSocketAccess.bindReply.bind(zeroMqSocketAccess);
      let boundAddress: string | undefined;
      const bind = vi
        .spyOn(zeroMqSocketAccess, "bindReply")
        .mockImplementation((socket, address) => {
          boundAddress = address;
          return nativeBind(socket, address);
        });

      try {
        const topic = createTransportTopic({
          signalKind: "system",
          messageTypeUrl: "type.spine.io/example.CanonicalAliasTask",
        });
        const handle = await transport.respond(
          createTransportSubscription({
            subscriberId: "canonical-alias-worker",
            topic,
            mode: "competing-consumer",
          }),
          () => ({ accepted: true }),
        );

        expect(canonicalDirectory).not.toBe(ipcDirectory);
        expect(boundAddress?.startsWith(`ipc://${canonicalDirectory}${path.sep}`)).toBe(true);
        await handle.close();
      } finally {
        bind.mockRestore();
        await transport.close();
        await rm(ipcDirectory, { recursive: true, force: true });
      }
    },
  );

  it("rejects replacement of a prepared IPC directory by device/inode identity", async () => {
    const ipcDirectory = await mkdtemp(path.join(tmpdir(), "sz-replaced-"));
    const prepared = await zeroMqSocketAccess.prepareIpcDirectory(ipcDirectory);
    const replaced = `${prepared.path}-replaced`;

    try {
      await rename(prepared.path, replaced);
      await mkdir(prepared.path, { mode: 0o700 });

      await expect(zeroMqSocketAccess.recheckIpcDirectory(prepared)).rejects.toThrow(
        /identity changed/iu,
      );
    } finally {
      await rm(prepared.path, { recursive: true, force: true });
      await rm(replaced, { recursive: true, force: true });
    }
  });

  it("rejects a suffix directory replaced immediately after successful creation", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "sz-created-race-"));
    const target = path.join(parent, "target");
    const requested = path.join(parent, "missing", "child");
    const createIpcDirectoryComponent =
      zeroMqSocketAccess.createIpcDirectoryComponent.bind(zeroMqSocketAccess);
    let replacementPath: string | undefined;
    const createComponent = vi
      .spyOn(zeroMqSocketAccess, "createIpcDirectoryComponent")
      .mockImplementation(async (directory) => {
        await createIpcDirectoryComponent(directory);
        if (replacementPath === undefined) {
          replacementPath = `${directory}-original`;
          await rename(directory, replacementPath);
          await symlink(target, directory, "dir");
        }
      });

    try {
      await mkdir(target, { mode: 0o700 });

      await expect(zeroMqSocketAccess.prepareIpcDirectory(requested)).rejects.toThrow(
        "ZeroMQ adapter ipcDirectory creation encountered an unsafe path.",
      );
      expect(createComponent).toHaveBeenCalledTimes(1);
      expect(await readdir(target)).toEqual([]);
    } finally {
      createComponent.mockRestore();
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("prevents all native operations after prepared-directory replacement", async () => {
    const topic = createTransportTopic({
      signalKind: "system",
      messageTypeUrl: "type.spine.io/example.RecheckReplacementTask",
    });
    const subscription = createTransportSubscription({
      subscriberId: "recheck-worker",
      topic,
      mode: "competing-consumer",
    });

    await expectNativeOperationBlocked("subscriber-connect", async (transport) => {
      await transport.subscribe(subscription, () => undefined);
    });
    await expectNativeOperationBlocked("request-connect", async (transport) => {
      await transport.request({ topic, envelope: { requested: true } });
    });
    await expectNativeOperationBlocked("responder-bind", async (transport) => {
      await transport.respond(subscription, () => ({ accepted: true }));
    });
    await expectNativeOperationBlocked("publisher-bind", async (transport) => {
      await transport.publish({ topic, envelope: { published: true } });
    });
  });

  it.skipIf(process.platform === "win32")(
    "requires exact POSIX 0700 mode including special bits",
    async () => {
      const ipcDirectory = await mkdtemp(path.join(tmpdir(), "sz-exact-mode-"));

      try {
        await chmod(ipcDirectory, 0o700);
        await expect(zeroMqSocketAccess.prepareIpcDirectory(ipcDirectory)).resolves.toBeDefined();

        for (const mode of [0o710, 0o1700]) {
          await chmod(ipcDirectory, mode);
          await expect(zeroMqSocketAccess.prepareIpcDirectory(ipcDirectory)).rejects.toThrow(
            /exact POSIX mode 0700/iu,
          );
        }
      } finally {
        await rm(ipcDirectory, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects an IPC directory owned by a different effective user",
    async () => {
      const ipcDirectory = await mkdtemp(path.join(tmpdir(), "sz-foreign-owner-"));
      const getEuid = vi.spyOn(process, "geteuid").mockReturnValue((process.geteuid?.() ?? 0) + 1);

      try {
        await expect(zeroMqSocketAccess.prepareIpcDirectory(ipcDirectory)).rejects.toThrow(
          /effective user/iu,
        );
      } finally {
        getEuid.mockRestore();
        await rm(ipcDirectory, { recursive: true, force: true });
      }
    },
  );

  it("closes registrations and rejects later operations without exposing adapter details", async () => {
    await withZeroMqTransport(async (transport) => {
      const topic = createTransportTopic({
        signalKind: "system",
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
  options: TestTransportOptions = {},
): Promise<T> {
  const ipcDirectory = await mkdtemp(path.join(ipcTemporaryRoot, "sz-transport-"));
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
    try {
      await withHarnessDeadline(transport.close(), "ZeroMQ test fixture close", closeDeadlineMs);
    } finally {
      await rm(ipcDirectory, { recursive: true, force: true });
    }
  }
}

type TestTransportOptions = Parameters<typeof createZeroMqTransport>[1] & {
  readonly onBackgroundFailure?: (error: Error) => void;
};

async function withSharedZeroMqTransports<T>(
  runTest: (
    firstTransport: ReturnType<typeof createZeroMqTransport>,
    secondTransport: ReturnType<typeof createZeroMqTransport>,
    ipcDirectory: string,
  ) => Promise<T>,
): Promise<T> {
  const ipcDirectory = await mkdtemp(path.join(ipcTemporaryRoot, "sz-transport-"));
  const config = createZeroMqAdapterConfig({
    ipcDirectory,
    adapterIdentity: `test-${String(process.pid)}-${String(Date.now())}`,
  });
  const firstTransport = createZeroMqTransport(config);
  const secondTransport = createZeroMqTransport(config);

  try {
    return await runTest(firstTransport, secondTransport, ipcDirectory);
  } finally {
    await closeSharedTransports(firstTransport, secondTransport, ipcDirectory);
  }
}

async function closeSharedTransports(
  firstTransport: ReturnType<typeof createZeroMqTransport>,
  secondTransport: ReturnType<typeof createZeroMqTransport>,
  ipcDirectory: string,
): Promise<void> {
  const closeOutcomes = await Promise.allSettled([
    withHarnessDeadline(
      firstTransport.close(),
      "first ZeroMQ shared test fixture close",
      closeDeadlineMs,
    ),
    withHarnessDeadline(
      secondTransport.close(),
      "second ZeroMQ shared test fixture close",
      closeDeadlineMs,
    ),
  ]);
  const firstCloseFailure = closeOutcomes.find(
    (closeOutcome) => closeOutcome.status === "rejected",
  );
  let removalFailure: Error | undefined;
  try {
    await rm(ipcDirectory, { recursive: true, force: true });
  } catch (error) {
    removalFailure =
      error instanceof Error
        ? error
        : new Error("ZeroMQ shared test fixture directory removal failed.");
  }

  if (firstCloseFailure?.status === "rejected") {
    throw firstCloseFailure.reason;
  }
  if (removalFailure !== undefined) {
    throw removalFailure;
  }
}

async function expectPausedSharedClose({
  transport,
  messageTypeUrl,
  subscriberId,
  outerDeadlineLabel,
  expectedCloseTimeout,
}: {
  readonly transport: "first" | "second";
  readonly messageTypeUrl: string;
  readonly subscriberId: string;
  readonly outerDeadlineLabel: string;
  readonly expectedCloseTimeout: string;
}): Promise<void> {
  const prepareIpcDirectory = zeroMqSocketAccess.prepareIpcDirectory.bind(zeroMqSocketAccess);
  const preparationStarted = deferred<undefined>();
  const preparationReleased = deferred<undefined>();
  const prepare = vi
    .spyOn(zeroMqSocketAccess, "prepareIpcDirectory")
    .mockImplementationOnce(async (ipcDirectory) => {
      preparationStarted.resolve(undefined);
      await preparationReleased.promise;
      return await prepareIpcDirectory(ipcDirectory);
    });
  let opening: Promise<unknown> | undefined;

  try {
    const fixture = withSharedZeroMqTransports(async (firstTransport, secondTransport) => {
      const topic = createTransportTopic({ signalKind: "system", messageTypeUrl });
      const selectedTransport = transport === "first" ? firstTransport : secondTransport;
      opening = selectedTransport.subscribe(
        createTransportSubscription({ subscriberId, topic }),
        () => undefined,
      );
      await preparationStarted.promise;
    });

    await expect(
      withHarnessDeadline(fixture, outerDeadlineLabel, closeDeadlineMs * 2),
    ).rejects.toThrow(expectedCloseTimeout);
  } finally {
    preparationReleased.resolve(undefined);
    await opening?.catch(() => undefined);
    prepare.mockRestore();
  }
}

async function expectNativeOperationBlocked(
  operation: "publisher-bind" | "request-connect" | "responder-bind" | "subscriber-connect",
  run: (transport: ReturnType<typeof createZeroMqTransport>) => Promise<unknown>,
): Promise<void> {
  const ipcDirectory = await mkdtemp(path.join(tmpdir(), `sz-recheck-${operation}-`));
  const transport = createZeroMqTransport(
    createZeroMqAdapterConfig({
      ipcDirectory,
      adapterIdentity: `recheck-${operation}-${String(process.pid)}-${String(Date.now())}`,
    }),
  );
  const prepareIpcDirectory = zeroMqSocketAccess.prepareIpcDirectory.bind(zeroMqSocketAccess);
  let replacedPath: string | undefined;
  const prepare = vi
    .spyOn(zeroMqSocketAccess, "prepareIpcDirectory")
    .mockImplementationOnce(async (directory) => {
      const prepared = await prepareIpcDirectory(directory);
      replacedPath = `${prepared.path}-original`;
      await rename(prepared.path, replacedPath);
      await mkdir(prepared.path, { mode: 0o700 });
      return prepared;
    });
  const nativeOperation = operation.endsWith("connect")
    ? vi.spyOn(zeroMqSocketAccess, "connect").mockImplementation(() => {
        throw new Error("native connect reached");
      })
    : operation === "publisher-bind"
      ? vi
          .spyOn(zeroMqSocketAccess, "bindPublisher")
          .mockRejectedValue(new Error("native bind reached"))
      : vi
          .spyOn(zeroMqSocketAccess, "bindReply")
          .mockRejectedValue(new Error("native bind reached"));

  try {
    await expect(run(transport)).rejects.toThrow(/identity changed/iu);
    expect(nativeOperation).not.toHaveBeenCalled();
  } finally {
    nativeOperation.mockRestore();
    prepare.mockRestore();
    await transport.close();
    await rm(ipcDirectory, { recursive: true, force: true });
    if (replacedPath !== undefined) {
      await rm(replacedPath, { recursive: true, force: true });
    }
  }
}

type CloseBlockedOperation =
  "publisher-bind" | "request-connect" | "responder-bind" | "subscriber-connect";
type CloseBoundary = "preparation" | "recheck";

interface NativeCallGuard {
  expectNotCalled(): void;
  restore(): void;
}

interface PausedBoundary {
  readonly started: Promise<undefined>;
  release(): void;
  restore(): void;
}

interface CloseBlockedOperationCase {
  readonly signalKind: "system" | "event";
  readonly nativeGuards: readonly (() => NativeCallGuard)[];
  open(
    transport: ReturnType<typeof createZeroMqTransport>,
    topic: ReturnType<typeof createTransportTopic>,
    subscriberId: string,
  ): Promise<unknown>;
}

const closeBlockedOperations: Record<CloseBlockedOperation, CloseBlockedOperationCase> = {
  "subscriber-connect": {
    signalKind: "system",
    nativeGuards: [guardNativeConnect],
    open: (transport, topic, subscriberId) =>
      transport.subscribe(createTransportSubscription({ subscriberId, topic }), () => undefined),
  },
  "responder-bind": {
    signalKind: "system",
    nativeGuards: [guardNativeReplyBind],
    open: (transport, topic, subscriberId) =>
      transport.respond(
        createTransportSubscription({
          subscriberId,
          topic,
          mode: "competing-consumer",
        }),
        () => ({ accepted: true }),
      ),
  },
  "publisher-bind": {
    signalKind: "system",
    nativeGuards: [guardNativePublisherBind],
    open: (transport, topic) => transport.publish({ topic, envelope: { published: true } }),
  },
  "request-connect": {
    signalKind: "system",
    nativeGuards: [guardNativeConnect, guardNativeRequestSend],
    open: (transport, topic) => transport.request({ topic, envelope: { requested: true } }),
  },
};

async function expectCloseBlocksNative(
  operation: CloseBlockedOperation,
  boundary: CloseBoundary,
): Promise<void> {
  const operationCase = closeBlockedOperations[operation];
  const pausedBoundary = pauseBoundary(boundary);
  const nativeGuards = operationCase.nativeGuards.map((guard) => guard());

  try {
    await withZeroMqTransport(async (transport) => {
      const topic = createTransportTopic({
        signalKind: operationCase.signalKind,
        messageTypeUrl: `type.spine.io/example.Closing${operation}${boundary}`,
      });
      const opening = operationCase.open(transport, topic, `closing-${operation}-${boundary}`);

      await expectCloseDrainsOpening(transport, opening, pausedBoundary, nativeGuards);
    });
  } finally {
    for (const guard of nativeGuards.toReversed()) {
      guard.restore();
    }
    pausedBoundary.restore();
  }
}

function pauseBoundary(boundary: CloseBoundary): PausedBoundary {
  const preparation = zeroMqSocketAccess.prepareIpcDirectory.bind(zeroMqSocketAccess);
  const recheck = zeroMqSocketAccess.recheckIpcDirectory.bind(zeroMqSocketAccess);
  const boundaryStarted = deferred<undefined>();
  const boundaryReleased = deferred<undefined>();
  const boundarySpy =
    boundary === "preparation"
      ? vi
          .spyOn(zeroMqSocketAccess, "prepareIpcDirectory")
          .mockImplementationOnce(async (ipcDirectory) => {
            boundaryStarted.resolve(undefined);
            await boundaryReleased.promise;
            return await preparation(ipcDirectory);
          })
      : vi
          .spyOn(zeroMqSocketAccess, "recheckIpcDirectory")
          .mockImplementationOnce(async (prepared) => {
            boundaryStarted.resolve(undefined);
            await boundaryReleased.promise;
            await recheck(prepared);
          });

  return {
    started: boundaryStarted.promise,
    release: () => {
      boundaryReleased.resolve(undefined);
    },
    restore: () => {
      boundarySpy.mockRestore();
    },
  };
}

async function expectCloseDrainsOpening(
  transport: ReturnType<typeof createZeroMqTransport>,
  opening: Promise<unknown>,
  boundary: PausedBoundary,
  nativeGuards: readonly NativeCallGuard[],
): Promise<void> {
  await boundary.started;
  let closeSettled = false;
  const close = transport.close().finally(() => {
    closeSettled = true;
  });

  try {
    await waitFor(0);
    expect(closeSettled).toBe(false);

    boundary.release();
    await expect(opening).rejects.toThrow("ZeroMQ signal transport is closed.");
    await close;
    for (const guard of nativeGuards) {
      guard.expectNotCalled();
    }
  } finally {
    boundary.release();
    await Promise.allSettled([opening, close]);
  }
}

function guardNativeConnect(): NativeCallGuard {
  return nativeCallGuard(
    vi.spyOn(zeroMqSocketAccess, "connect").mockImplementation(() => {
      throw new Error("native connect reached");
    }),
  );
}

function guardNativeRequestSend(): NativeCallGuard {
  return nativeCallGuard(
    vi.spyOn(zeroMqSocketAccess, "sendRequest").mockRejectedValue(new Error("native send reached")),
  );
}

function guardNativePublisherBind(): NativeCallGuard {
  return nativeCallGuard(
    vi
      .spyOn(zeroMqSocketAccess, "bindPublisher")
      .mockRejectedValue(new Error("native publisher bind reached")),
  );
}

function guardNativeReplyBind(): NativeCallGuard {
  return nativeCallGuard(
    vi
      .spyOn(zeroMqSocketAccess, "bindReply")
      .mockRejectedValue(new Error("native responder bind reached")),
  );
}

function nativeCallGuard(spy: { mockRestore(): void }): NativeCallGuard {
  return {
    expectNotCalled: () => {
      expect(spy).not.toHaveBeenCalled();
    },
    restore: () => {
      spy.mockRestore();
    },
  };
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

async function withHarnessDeadline<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Timed out waiting for ${label}.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
