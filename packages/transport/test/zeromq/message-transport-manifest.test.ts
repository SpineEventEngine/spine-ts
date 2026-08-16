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

import { createHash } from "node:crypto";
import {
  access,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { AnySchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import {
  ChannelIdSchema,
  ExternalEventsWantedSchema,
  ExternalMessageSchema,
} from "@spine-event-engine/proto";
import { describe, expect, it, vi } from "vitest";

import { ZeroMqConfig } from "../../src/zeromq/adapter-config.js";
import { ChannelEndpoints } from "../../src/zeromq/channel-endpoints.js";
import {
  createZeroMqTransportFactory,
  zeroMqMessageAccess,
} from "../../src/zeromq/message-transport.js";

const targetType = "type.spine.io/wave13.Manifest";

describe("ZeroMQ message transport manifest lifecycle", () => {
  it("writes an exact v1 manifest before it becomes discoverable and removes it before close", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const subscriber = await factory.createSubscriber(channel());
      const manifestPath = await manifestPathFor(ipcDirectory);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;

      expect(Object.keys(manifest).sort()).toEqual([
        "adapterIdentity",
        "endpoint",
        "generation",
        "heartbeatAtMs",
        "ownerPid",
        "version",
      ]);
      expect(manifest.version).toBe(1);
      expect(manifest.ownerPid).toBe(process.pid);
      expect(manifest.endpoint).toBe(
        `ipc://${path.join(
          ipcDirectory,
          "spine-message-channels",
          "sockets",
          `${manifest.generation as string}.sock`,
        )}`,
      );
      expect((await lstat(manifestPath)).mode & 0o777).toBe(0o600);

      await subscriber.close();
      await expect(access(manifestPath)).rejects.toMatchObject({ code: "ENOENT" });
      await factory.close();
    });
  });

  // prettier-ignore
  it(
    "removes malformed, symlinked, stale, and dead manifests while leaving valid foreign identity untouched",
    async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const subscriber = await factory.createSubscriber(channel());
      const subscriberDirectory = subscriberDirectoryFor(ipcDirectory);
      const [source] = await readdir(subscriberDirectory);
      if (source === undefined) throw new Error("Expected a live subscriber manifest.");
      const sourceManifest = JSON.parse(
        await readFile(path.join(subscriberDirectory, source), "utf8"),
      ) as Record<string, unknown>;
      const bad = path.join(subscriberDirectory, "bad.json");
      const linked = path.join(subscriberDirectory, "linked.json");
      const stale = path.join(subscriberDirectory, "00000000-0000-4000-8000-000000000001.json");
      const dead = path.join(subscriberDirectory, "00000000-0000-4000-8000-000000000002.json");
      const foreign = path.join(subscriberDirectory, "00000000-0000-4000-8000-000000000003.json");
      await writeFile(bad, "{");
      await symlink(path.join(subscriberDirectory, source), linked);
      await writeFile(
        stale,
        JSON.stringify({ ...sourceManifest, generation: stale.slice(0, -5), heartbeatAtMs: 1 }),
      );
      await writeFile(
        dead,
        JSON.stringify({ ...sourceManifest, generation: dead.slice(0, -5), ownerPid: 2147483647 }),
      );
      await writeFile(
        foreign,
        JSON.stringify({
          ...sourceManifest,
          generation: foreign.slice(0, -5),
          adapterIdentity: "foreign",
        }),
      );

      const publisher = await factory.createPublisher(channel());
      await publisher.publish(frameId(), frame());
      await eventually(
        async () => (await readFile(path.join(subscriberDirectory, source), "utf8")).length > 0,
      );
      for (const removed of [bad, linked, stale, dead])
        await expect(access(removed)).rejects.toMatchObject({ code: "ENOENT" });
      expect((await lstat(foreign)).isFile()).toBe(true);

      await Promise.all([publisher.close(), subscriber.close(), factory.close()]);
    });
  });

  it("rejects a socket pathname that cannot be represented by native IPC", async () => {
    const ipcDirectory = await mkdtemp(path.join("/tmp", "spine-wave13-path-limit-"));
    try {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      await expect(factory.createSubscriber(channel())).rejects.toThrow(/path limit/iu);
      await factory.close();
    } finally {
      await rm(ipcDirectory, { recursive: true, force: true });
    }
  });

  it("serializes concurrently accepted publication work and rejects mismatched frame identity", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const subscriber = await factory.createSubscriber(channel());
      const received: string[] = [];
      await subscriber.addConsumer((message) => {
        received.push(
          fromBinary(
            StringValueSchema,
            required(message.originalMessage, "first original message").value,
          ).value,
        );
      });
      const publisher = await factory.createPublisher(channel());
      const first = frame("first");
      const second = frame("second");
      if (first.id === undefined || second.id === undefined)
        throw new Error("Expected external-message wrapper identities.");
      await Promise.all([publisher.publish(first.id, first), publisher.publish(second.id, second)]);
      await eventually(() => Promise.resolve(received.length === 2));
      expect(received).toEqual(["first", "second"]);
      await expect(publisher.publish(frameId(), first)).rejects.toThrow(/identity must match/iu);
      await Promise.all([publisher.close(), subscriber.close(), factory.close()]);
    });
  });

  it("delivers an original message whose valid protobuf payload is empty", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const subscriber = await factory.createSubscriber(channel());
      const received: { readonly typeUrl: string; readonly value: Uint8Array }[] = [];
      await subscriber.addConsumer((message) => {
        const original = required(message.originalMessage, "empty original message");
        received.push({ typeUrl: original.typeUrl, value: original.value });
      });
      const publisher = await factory.createPublisher(channel());
      const emptyPayload = toBinary(ExternalEventsWantedSchema, create(ExternalEventsWantedSchema));
      expect(emptyPayload).toEqual(new Uint8Array());
      const message = create(ExternalMessageSchema, {
        id: frameId("empty-protobuf"),
        originalMessage: create(AnySchema, {
          typeUrl: "type.spine.io/spine.server.integration.ExternalEventsWanted",
          value: emptyPayload,
        }),
        boundedContextName: { value: "Manifest" },
      });
      const id = required(message.id, "empty protobuf frame identity");

      await expect(publisher.publish(id, message)).resolves.toBeUndefined();
      await eventually(() => Promise.resolve(received.length === 1));
      expect(received).toEqual([
        {
          typeUrl: "type.spine.io/spine.server.integration.ExternalEventsWanted",
          value: new Uint8Array(),
        },
      ]);
      await Promise.all([publisher.close(), subscriber.close(), factory.close()]);
    });
  });

  it("shares publisher and factory close completion across racing callers", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const publisher = await factory.createPublisher(channel());
      const publisherClose = publisher.close();
      expect(publisher.close()).toBe(publisherClose);
      await publisherClose;
      const factoryClose = factory.close();
      expect(factory.close()).toBe(factoryClose);
      await factoryClose;
    });
  });

  it("withdraws its manifest and socket when its final consumer handle closes", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const subscriber = await factory.createSubscriber(channel());
      const manifestPath = await manifestPathFor(ipcDirectory);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { generation: string };
      const socketPath = path.join(
        ipcDirectory,
        "spine-message-channels",
        "sockets",
        `${manifest.generation}.sock`,
      );
      const handle = await subscriber.addConsumer(() => undefined);

      await handle.close();

      await expect(access(manifestPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(socketPath)).rejects.toMatchObject({ code: "ENOENT" });
      await factory.close();
    });
  });

  it("drains a gated subscriber open when factory close races it without leaving endpoints", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const prepare = ChannelEndpoints.prepare.bind(ChannelEndpoints);
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const preparation = vi
        .spyOn(ChannelEndpoints, "prepare")
        .mockImplementationOnce(async (directory, createComponent) => {
          entered();
          await gate;
          return await prepare(directory, createComponent);
        });
      try {
        const factory = createZeroMqTransportFactory(config(ipcDirectory));
        const opening = factory.createSubscriber(channel());
        await started;
        const close = factory.close();
        let settled = false;
        void close.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );
        await Promise.resolve();
        expect(settled).toBe(false);
        const openingFailure = expect(opening).rejects.toThrow(/closed while subscriber opened/iu);
        release();
        await expect(close).rejects.toThrow(/transport close failed/iu);
        await openingFailure;
        expect(await readdir(path.join(ipcDirectory, "spine-message-channels", "sockets"))).toEqual(
          [],
        );
      } finally {
        preparation.mockRestore();
      }
    });
  });

  it("drains a gated publisher creation before factory close settles", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const prepare = ChannelEndpoints.prepare.bind(ChannelEndpoints);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const preparation = vi
        .spyOn(ChannelEndpoints, "prepare")
        .mockImplementationOnce(async (directory, createComponent) => {
          await gate;
          return await prepare(directory, createComponent);
        });
      try {
        const factory = createZeroMqTransportFactory(config(ipcDirectory));
        const creation = factory.createPublisher(channel());
        await Promise.resolve();
        const close = factory.close();
        release();
        await expect(close).rejects.toThrow(/transport close failed/iu);
        await expect(creation).rejects.toThrow(/closed while publisher opened/iu);
      } finally {
        preparation.mockRestore();
      }
    });
  });

  it("reports an accepted consumer failure when subscriber close drains delivery", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const subscriber = await factory.createSubscriber(channel());
      const publisher = await factory.createPublisher(channel());
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await subscriber.addConsumer(async () => {
        entered();
        await gate;
        throw new Error("consumer failed after close");
      });
      const message = frame();
      if (message.id === undefined)
        throw new Error("Expected an external-message wrapper identity.");
      const publication = publisher.publish(message.id, message);
      await started;

      const close = subscriber.close();
      let settled = false;
      void close.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await Promise.resolve();
      expect(settled).toBe(false);
      release();
      await expect(close).rejects.toThrow(/background processing failed/iu);
      await publication;

      await Promise.allSettled([publisher.close(), factory.close()]);
    });
  });

  it("does not resurrect a manifest when an in-flight heartbeat loses a close race", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const subscriber = await factory.createSubscriber(channel());
      const manifestPath = await manifestPathFor(ipcDirectory);
      const write = zeroMqMessageAccess.writeManifest.bind(zeroMqMessageAccess);
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const heartbeat = vi
        .spyOn(zeroMqMessageAccess, "writeManifest")
        .mockImplementationOnce(async (filePath, manifest) => {
          entered();
          await gate;
          await write(filePath, manifest);
        });
      vi.useFakeTimers();
      try {
        await vi.advanceTimersByTimeAsync(3000);
        await started;
        expect(heartbeat).toHaveBeenCalledTimes(1);
        const close = subscriber.close();
        release();
        await close;
        await expect(access(manifestPath)).rejects.toMatchObject({ code: "ENOENT" });
        await factory.close();
      } finally {
        vi.useRealTimers();
        heartbeat.mockRestore();
      }
    });
  });

  it("attempts socket cleanup when manifest removal fails and reports the failure", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const subscriber = await factory.createSubscriber(channel());
      const manifestPath = await manifestPathFor(ipcDirectory);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { generation: string };
      const socketPath = path.join(
        ipcDirectory,
        "spine-message-channels",
        "sockets",
        `${manifest.generation}.sock`,
      );
      const remove = zeroMqMessageAccess.remove.bind(zeroMqMessageAccess);
      const cleanup = vi
        .spyOn(zeroMqMessageAccess, "remove")
        .mockImplementationOnce(() => Promise.reject(new Error("manifest unlink failed")));
      try {
        await expect(subscriber.close()).rejects.toThrow(/background processing failed/iu);
        await expect(access(socketPath)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(access(manifestPath)).resolves.toBeUndefined();
      } finally {
        cleanup.mockRestore();
        await remove(manifestPath);
        await factory.close().catch(() => undefined);
      }
    });
  });

  it("bounds every lexical subscriber directory entry before filtering manifests", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const subscriber = await factory.createSubscriber(channel());
      const directory = subscriberDirectoryFor(ipcDirectory);
      await Promise.all(
        Array.from({ length: 1024 }, (_, index) =>
          writeFile(path.join(directory, `non-json-${String(index)}.entry`), "x"),
        ),
      );
      await expect(factory.createPublisher(channel())).rejects.toThrow(
        /1024 subscriber manifests/iu,
      );
      await Promise.allSettled([subscriber.close(), factory.close()]);
    });
  });

  it("returns rejected promises for invalid and closed SPI creation calls", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      let invalid!: ReturnType<typeof factory.createPublisher>;
      expect(() => {
        invalid = factory.createPublisher(create(ChannelIdSchema));
      }).not.toThrow();
      await expect(invalid).rejects.toThrow(/targetType/iu);
      const subscriber = await factory.createSubscriber(channel());
      await factory.close();
      let consumer!: ReturnType<typeof subscriber.addConsumer>;
      expect(() => {
        consumer = subscriber.addConsumer(() => undefined);
      }).not.toThrow();
      await expect(consumer).rejects.toThrow(/closed/iu);
      let closed!: ReturnType<typeof factory.createPublisher>;
      expect(() => {
        closed = factory.createPublisher(channel());
      }).not.toThrow();
      await expect(closed).rejects.toThrow(/closed/iu);
    });
  });

  it("fans out frames published by independent publishers through one discovered subscriber", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const subscriber = await factory.createSubscriber(channel());
      const received: string[] = [];
      await subscriber.addConsumer((message) => {
        received.push(
          fromBinary(
            StringValueSchema,
            required(message.originalMessage, "second original message").value,
          ).value,
        );
      });
      const left = await factory.createPublisher(channel());
      const right = await factory.createPublisher(channel());
      const leftFrame = frame("left");
      const rightFrame = frame("right");
      if (leftFrame.id === undefined || rightFrame.id === undefined)
        throw new Error("Expected external-message wrapper identities.");
      await Promise.all([
        left.publish(leftFrame.id, leftFrame),
        right.publish(rightFrame.id, rightFrame),
      ]);
      await eventually(() => Promise.resolve(received.length === 2));
      expect(received.sort()).toEqual(["left", "right"]);
      await Promise.all([left.close(), right.close(), subscriber.close(), factory.close()]);
    });
  });
});

function config(ipcDirectory: string): ZeroMqConfig {
  return ZeroMqConfig.create({ ipcDirectory, adapterIdentity: "manifest-test" });
}

function channel() {
  return create(ChannelIdSchema, { targetType });
}

function frameId(value = "manifest") {
  return create(AnySchema, {
    typeUrl: "type.spine.io/google.protobuf.StringValue",
    value: toBinary(StringValueSchema, create(StringValueSchema, { value })),
  });
}

function required<Value>(value: Value | undefined, label: string): Value {
  if (value === undefined) throw new Error(`Expected ${label}.`);
  return value;
}

function frame(value = "manifest") {
  return create(ExternalMessageSchema, {
    id: frameId(value),
    originalMessage: frameId(value),
    boundedContextName: { value: "Manifest" },
  });
}

function subscriberDirectoryFor(ipcDirectory: string): string {
  return path.join(
    ipcDirectory,
    "spine-message-channels",
    "channels",
    createHash("sha256").update(targetType).digest("hex"),
    "subscribers",
  );
}

async function manifestPathFor(ipcDirectory: string): Promise<string> {
  const directory = subscriberDirectoryFor(ipcDirectory);
  const [entry] = await readdir(directory);
  if (entry === undefined) throw new Error("Expected a subscriber manifest.");
  return path.join(directory, entry);
}

async function withIpcDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp("/tmp/sz-");
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function eventually(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for manifest scan.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
