import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { Publisher, Reply, Request, Subscriber, type MessageLike, type Socket } from "zeromq";

import { ZeroMqConfig } from "../../src/zeromq/adapter-config.js";

const smokeTimeoutMs = 2_000;
const publishCadenceMs = 10;

describe("ZeroMQ adapter-private local IPC smoke tests", () => {
  it("publishes subscribed messages over a temporary local IPC endpoint", async () => {
    await withTemporaryIpcDirectory(async (ipcDirectory) => {
      const config = ZeroMqConfig.create({
        ipcDirectory,
        adapterIdentity: "pub-sub-smoke",
      });
      const endpoint = createIpcEndpoint(config.ipcDirectory, "p.sock");
      const topic = "event:type.spine.io/example.TaskCreated";
      const publisher = new Publisher({ linger: 0 });
      const subscriber = new Subscriber({ linger: 0, receiveTimeout: smokeTimeoutMs });

      try {
        await publisher.bind(endpoint);
        subscriber.subscribe(topic);
        subscriber.connect(endpoint);

        const [receivedTopic, receivedPayload] = await publishUntilReceived(
          publisher,
          [topic, "task-123"],
          subscriber,
        );

        expect(readFrame(receivedTopic)).toBe(topic);
        expect(readFrame(receivedPayload)).toBe("task-123");
      } finally {
        closeSockets(subscriber, publisher);
      }
    });
  });

  it("round-trips request and reply messages over a temporary local IPC endpoint", async () => {
    await withTemporaryIpcDirectory(async (ipcDirectory) => {
      const config = ZeroMqConfig.create({
        ipcDirectory,
        adapterIdentity: "req-rep-smoke",
      });
      const endpoint = createIpcEndpoint(config.ipcDirectory, "r.sock");
      const requester = new Request({
        linger: 0,
        receiveTimeout: smokeTimeoutMs,
        sendTimeout: smokeTimeoutMs,
      });
      const replier = new Reply({
        linger: 0,
        receiveTimeout: smokeTimeoutMs,
        sendTimeout: smokeTimeoutMs,
      });

      try {
        await replier.bind(endpoint);
        requester.connect(endpoint);

        const replyTask = replyOnce(replier);
        await requester.send("lookup task-456");
        const [response] = await requester.receive();
        const request = await replyTask;

        expect(readFrame(request)).toBe("lookup task-456");
        expect(readFrame(response)).toBe("found task-456");
      } finally {
        closeSockets(requester, replier);
      }
    });
  });
});

async function withTemporaryIpcDirectory<T>(
  runSmoke: (ipcDirectory: string) => Promise<T>,
): Promise<T> {
  const ipcDirectory = await mkdtemp(path.join(tmpdir(), "sz-"));

  try {
    return await runSmoke(ipcDirectory);
  } finally {
    await rm(ipcDirectory, { recursive: true, force: true });
  }
}

function createIpcEndpoint(ipcDirectory: string, fileName: string): string {
  return `ipc://${path.join(ipcDirectory, fileName)}`;
}

async function publishUntilReceived(
  publisher: Publisher,
  message: readonly MessageLike[],
  subscriber: Subscriber,
): Promise<Buffer[]> {
  const received = subscriber.receive();
  const maxPublishAttempts = Math.ceil(smokeTimeoutMs / publishCadenceMs);

  for (let attempt = 0; attempt < maxPublishAttempts; attempt += 1) {
    await publisher.send([...message]);

    const result = await raceReceiveWithDelay(received);
    if (result.state === "received") {
      return result.value;
    }
  }

  return await received;
}

async function raceReceiveWithDelay<T>(
  receive: Promise<T>,
): Promise<{ readonly state: "pending" } | { readonly state: "received"; readonly value: T }> {
  return await Promise.race([
    receive.then((value) => ({ state: "received", value }) as const),
    waitFor(publishCadenceMs).then(() => ({ state: "pending" }) as const),
  ]);
}

async function replyOnce(replier: Reply): Promise<Buffer> {
  const [request] = await replier.receive();
  const requestFrame = requireFrame(request);

  await replier.send("found task-456");

  return requestFrame;
}

function closeSockets(...sockets: Socket[]): void {
  for (const socket of sockets) {
    socket.close();
  }
}

function readFrame(frame: Buffer | undefined): string {
  return requireFrame(frame).toString("utf8");
}

function requireFrame(frame: Buffer | undefined): Buffer {
  expect(frame).toBeDefined();

  if (frame === undefined) {
    throw new Error("Expected ZeroMQ smoke-test message frame.");
  }

  return frame;
}

async function waitFor(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
