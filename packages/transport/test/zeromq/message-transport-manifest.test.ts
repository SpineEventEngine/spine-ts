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
  chmod,
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
import { Pull, Push } from "zeromq";

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
      const structural = path.join(
        subscriberDirectory,
        "00000000-0000-4000-8000-000000000005.json",
      );
      const linked = path.join(subscriberDirectory, "linked.json");
      const stale = path.join(subscriberDirectory, "00000000-0000-4000-8000-000000000001.json");
      const dead = path.join(subscriberDirectory, "00000000-0000-4000-8000-000000000002.json");
      const foreign = path.join(subscriberDirectory, "00000000-0000-4000-8000-000000000003.json");
      const wrongMode = path.join(
        subscriberDirectory,
        "00000000-0000-4000-8000-000000000004.json",
      );
      const nonSocket = path.join(subscriberDirectory, "00000000-0000-4000-8000-000000000006.json");
      const nonSocketPath = path.join(
        ipcDirectory,
        "spine-message-channels",
        "sockets",
        "00000000-0000-4000-8000-000000000006.sock",
      );
      await writeFile(bad, "{");
      await zeroMqMessageAccess.writeManifest(structural, {
        ...sourceManifest,
        generation: structural.slice(-41, -5),
      });
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
      await writeFile(
        wrongMode,
        JSON.stringify({ ...sourceManifest, generation: wrongMode.slice(-41, -5) }),
      );
      await chmod(wrongMode, 0o644);
      await writeFile(nonSocketPath, "not-a-socket");
      await writeFile(
        nonSocket,
        JSON.stringify({
          ...sourceManifest,
          generation: nonSocket.slice(-41, -5),
          endpoint: `ipc://${nonSocketPath}`,
        }),
      );
      await chmod(nonSocket, 0o600);

      const publisher = await factory.createPublisher(channel());
      await publisher.publish(frameId(), frame());
      await eventually(
        async () => (await readFile(path.join(subscriberDirectory, source), "utf8")).length > 0,
      );
      for (const removed of [bad, linked, stale, dead, wrongMode, structural, nonSocket])
        await expect(access(removed)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(nonSocketPath)).resolves.toBeUndefined();
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

  it("preserves a freshly replaced manifest when discovery observes an identity race", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const subscriber = await factory.createSubscriber(channel());
      const manifestPath = await manifestPathFor(ipcDirectory);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Parameters<
        typeof zeroMqMessageAccess.writeManifest
      >[1];
      const openManifest = zeroMqMessageAccess.openManifest.bind(zeroMqMessageAccess);
      const replacement = vi
        .spyOn(zeroMqMessageAccess, "openManifest")
        .mockImplementationOnce(async (filePath) => {
          await zeroMqMessageAccess.writeManifest(filePath, manifest);
          return await openManifest(filePath);
        });
      const received: string[] = [];
      await subscriber.addConsumer((message) => {
        received.push(
          fromBinary(
            StringValueSchema,
            required(message.originalMessage, "race-safe original message").value,
          ).value,
        );
      });
      try {
        const publisher = await factory.createPublisher(channel());
        const message = frame("survives-race");
        await publisher.publish(required(message.id, "race-safe frame identity"), message);
        await eventually(() => Promise.resolve(received.length === 1));
        expect(received).toEqual(["survives-race"]);
        expect(await readFile(manifestPath, "utf8")).not.toEqual("");
        await publisher.close();
      } finally {
        replacement.mockRestore();
        await Promise.allSettled([subscriber.close(), factory.close()]);
      }
    });
  });

  it("preserves a replacement that races invalid-manifest quarantine", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const subscriber = await factory.createSubscriber(channel());
      const manifestPath = await manifestPathFor(ipcDirectory);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Parameters<
        typeof zeroMqMessageAccess.writeManifest
      >[1];
      await chmod(manifestPath, 0o644);
      const moveManifest = zeroMqMessageAccess.moveManifest.bind(zeroMqMessageAccess);
      const replacement = vi
        .spyOn(zeroMqMessageAccess, "moveManifest")
        .mockImplementationOnce(async (fromPath, toPath) => {
          await zeroMqMessageAccess.writeManifest(fromPath, manifest);
          await moveManifest(fromPath, toPath);
        });
      const received: string[] = [];
      await subscriber.addConsumer((message) => {
        received.push(
          fromBinary(
            StringValueSchema,
            required(message.originalMessage, "quarantine-race original message").value,
          ).value,
        );
      });
      try {
        const publisher = await factory.createPublisher(channel());
        const message = frame("survives-quarantine-race");
        await publisher.publish(required(message.id, "quarantine-race identity"), message);
        await eventually(() => Promise.resolve(received.length === 1));
        expect(received).toEqual(["survives-quarantine-race"]);
        await publisher.close();
      } finally {
        replacement.mockRestore();
        await Promise.allSettled([subscriber.close(), factory.close()]);
      }
    });
  });

  it("keeps the current manifest when quarantine movement fails", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const subscriber = await factory.createSubscriber(channel());
      const manifestPath = await manifestPathFor(ipcDirectory);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Parameters<
        typeof zeroMqMessageAccess.writeManifest
      >[1];
      const invalidPath = path.join(
        path.dirname(manifestPath),
        "00000000-0000-4000-8000-000000000009.json",
      );
      await zeroMqMessageAccess.writeManifest(invalidPath, {
        ...manifest,
        generation: invalidPath.slice(-41, -5),
      });
      const movement = vi
        .spyOn(zeroMqMessageAccess, "moveManifest")
        .mockRejectedValueOnce(new Error("injected quarantine failure"));
      const received: string[] = [];
      await subscriber.addConsumer((message) => {
        received.push(
          fromBinary(
            StringValueSchema,
            required(message.originalMessage, "move failure original message").value,
          ).value,
        );
      });
      try {
        const publisher = await factory.createPublisher(channel());
        await expect(access(invalidPath)).resolves.toBeUndefined();
        expect(
          (await readdir(path.dirname(invalidPath))).filter((entry) =>
            entry.includes(".quarantine"),
          ),
        ).toEqual([]);
        const message = frame("after-move-failure");
        await publisher.publish(required(message.id, "move failure identity"), message);
        await eventually(() => Promise.resolve(received.length === 1));
        await publisher.close();
      } finally {
        movement.mockRestore();
        await rm(invalidPath, { force: true });
        await Promise.allSettled([subscriber.close(), factory.close()]);
      }
    });
  });

  it("preserves a replacement that races stale-manifest quarantine", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const subscriber = await factory.createSubscriber(channel());
      const manifestPath = await manifestPathFor(ipcDirectory);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Parameters<
        typeof zeroMqMessageAccess.writeManifest
      >[1];
      await zeroMqMessageAccess.writeManifest(manifestPath, { ...manifest, heartbeatAtMs: 1 });
      const moveManifest = zeroMqMessageAccess.moveManifest.bind(zeroMqMessageAccess);
      const replacement = vi
        .spyOn(zeroMqMessageAccess, "moveManifest")
        .mockImplementationOnce(async (fromPath, toPath) => {
          await zeroMqMessageAccess.writeManifest(fromPath, manifest);
          await moveManifest(fromPath, toPath);
        });
      const received: string[] = [];
      await subscriber.addConsumer((message) => {
        received.push(
          fromBinary(
            StringValueSchema,
            required(message.originalMessage, "stale-race original message").value,
          ).value,
        );
      });
      try {
        const publisher = await factory.createPublisher(channel());
        const message = frame("survives-stale-race");
        await publisher.publish(required(message.id, "stale-race identity"), message);
        await eventually(() => Promise.resolve(received.length === 1));
        expect(received).toEqual(["survives-stale-race"]);
        await publisher.close();
      } finally {
        replacement.mockRestore();
        await Promise.allSettled([subscriber.close(), factory.close()]);
      }
    });
  });

  it("keeps a live owner's socket when a fresh manifest follows matched stale quarantine", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const subscriber = await factory.createSubscriber(channel());
      const manifestPath = await manifestPathFor(ipcDirectory);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Parameters<
        typeof zeroMqMessageAccess.writeManifest
      >[1];
      const socketPath = path.join(
        ipcDirectory,
        "spine-message-channels",
        "sockets",
        `${manifest.generation}.sock`,
      );
      await zeroMqMessageAccess.writeManifest(manifestPath, { ...manifest, heartbeatAtMs: 1 });
      const moveManifest = zeroMqMessageAccess.moveManifest.bind(zeroMqMessageAccess);
      const replacement = vi
        .spyOn(zeroMqMessageAccess, "moveManifest")
        .mockImplementationOnce(async (fromPath, toPath) => {
          await moveManifest(fromPath, toPath);
          await zeroMqMessageAccess.writeManifest(fromPath, manifest);
        });
      const received: string[] = [];
      await subscriber.addConsumer((message) => {
        received.push(
          fromBinary(
            StringValueSchema,
            required(message.originalMessage, "fresh-after-stale original message").value,
          ).value,
        );
      });
      try {
        const publisher = await factory.createPublisher(channel());
        const message = frame("fresh-after-stale");
        await publisher.publish(required(message.id, "fresh-after-stale identity"), message);
        await eventually(() => Promise.resolve(received.length === 1));
        await expect(access(socketPath)).resolves.toBeUndefined();
        expect(received).toEqual(["fresh-after-stale"]);
        await publisher.close();
      } finally {
        replacement.mockRestore();
        await Promise.allSettled([subscriber.close(), factory.close()]);
      }
    });
  });

  it("removes a dead owner's stale manifest and existing socket", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const subscriber = await factory.createSubscriber(channel());
      const manifestPath = await manifestPathFor(ipcDirectory);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Parameters<
        typeof zeroMqMessageAccess.writeManifest
      >[1];
      const generation = "00000000-0000-4000-8000-000000000008";
      const socketPath = path.join(
        ipcDirectory,
        "spine-message-channels",
        "sockets",
        `${generation}.sock`,
      );
      const deadManifestPath = path.join(path.dirname(manifestPath), `${generation}.json`);
      const deadSocket = new Pull({ linger: 0 });
      await deadSocket.bind(`ipc://${socketPath}`);
      await zeroMqMessageAccess.writeManifest(deadManifestPath, {
        ...manifest,
        generation,
        endpoint: `ipc://${socketPath}`,
        ownerPid: 2147483647,
        heartbeatAtMs: 1,
      });
      try {
        await factory.createPublisher(channel());
        await expect(access(deadManifestPath)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(access(socketPath)).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        deadSocket.close();
        await Promise.allSettled([subscriber.close(), factory.close()]);
      }
    });
  });

  it("treats EPERM owners as live when fresh and preserves their expired socket", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const subscriber = await factory.createSubscriber(channel());
      const manifestPath = await manifestPathFor(ipcDirectory);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Parameters<
        typeof zeroMqMessageAccess.writeManifest
      >[1];
      const socketPath = path.join(
        ipcDirectory,
        "spine-message-channels",
        "sockets",
        `${manifest.generation}.sock`,
      );
      await zeroMqMessageAccess.writeManifest(manifestPath, { ...manifest, heartbeatAtMs: 1 });
      const permission = vi.spyOn(process, "kill").mockImplementation(() => {
        throw Object.assign(new Error("denied"), { code: "EPERM" });
      });
      const received: string[] = [];
      await subscriber.addConsumer((message) => {
        received.push(
          fromBinary(
            StringValueSchema,
            required(message.originalMessage, "eperm original message").value,
          ).value,
        );
      });
      try {
        const publisher = await factory.createPublisher(channel());
        await expect(access(manifestPath)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(access(socketPath)).resolves.toBeUndefined();
        await zeroMqMessageAccess.writeManifest(manifestPath, manifest);
        const message = frame("eperm-fresh");
        await publisher.publish(required(message.id, "eperm identity"), message);
        await eventually(() => Promise.resolve(received.length === 1));
        expect(received).toEqual(["eperm-fresh"]);
        await publisher.close();
      } finally {
        permission.mockRestore();
        await Promise.allSettled([subscriber.close(), factory.close()]);
      }
    });
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

  it("drops a malformed raw native frame and continues with the next valid frame", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const subscriber = await factory.createSubscriber(channel());
      const manifest = JSON.parse(await readFile(await manifestPathFor(ipcDirectory), "utf8")) as {
        readonly endpoint: string;
      };
      const received: string[] = [];
      await subscriber.addConsumer((message) => {
        received.push(
          fromBinary(
            StringValueSchema,
            required(message.originalMessage, "valid original message").value,
          ).value,
        );
      });
      const raw = new Push({ linger: 0 });
      raw.connect(manifest.endpoint);
      await raw.send(new Uint8Array([255]));
      raw.close();
      const publisher = await factory.createPublisher(channel());
      const valid = frame("after-malformed");
      await publisher.publish(required(valid.id, "valid frame identity"), valid);
      await eventually(() => Promise.resolve(received.length === 1));
      expect(received).toEqual(["after-malformed"]);
      await Promise.all([publisher.close(), subscriber.close(), factory.close()]);
    });
  });

  it("rejects an oversized publication before native delivery", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const publisher = await factory.createPublisher(channel());
      const oversized = create(ExternalMessageSchema, {
        id: frameId("oversized"),
        originalMessage: create(AnySchema, {
          typeUrl: "type.spine.io/google.protobuf.StringValue",
          value: new Uint8Array(1024 * 1024),
        }),
        boundedContextName: { value: "Manifest" },
      });
      await expect(
        publisher.publish(required(oversized.id, "oversized identity"), oversized),
      ).rejects.toThrow(/frame-size limit/iu);
      await publisher.close().catch(() => undefined);
      await factory.close().catch(() => undefined);
    });
  });

  it("drops an oversized raw native frame and continues with a valid frame", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const subscriber = await factory.createSubscriber(channel());
      const manifest = JSON.parse(await readFile(await manifestPathFor(ipcDirectory), "utf8")) as {
        readonly endpoint: string;
      };
      const received: string[] = [];
      await subscriber.addConsumer((message) => {
        received.push(
          fromBinary(
            StringValueSchema,
            required(message.originalMessage, "oversized continuation original message").value,
          ).value,
        );
      });
      const raw = new Push({ linger: 0, maxMessageSize: 2 * 1024 * 1024 });
      raw.connect(manifest.endpoint);
      await raw.send(new Uint8Array(1024 * 1024 + 1));
      raw.close();
      const publisher = await factory.createPublisher(channel());
      const valid = frame("after-oversized");
      await publisher.publish(required(valid.id, "oversized continuation identity"), valid);
      await eventually(() => Promise.resolve(received.length === 1));
      expect(received).toEqual(["after-oversized"]);
      await Promise.all([publisher.close(), subscriber.close(), factory.close()]);
    });
  });

  it("continues after a consumer rejection and reports it when closed", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const subscriber = await factory.createSubscriber(channel());
      const received: string[] = [];
      let reject = true;
      await subscriber.addConsumer((message) => {
        const value = fromBinary(
          StringValueSchema,
          required(message.originalMessage, "consumer continuation original message").value,
        ).value;
        if (reject) {
          reject = false;
          throw new Error("first consumer failure");
        }
        received.push(value);
      });
      const publisher = await factory.createPublisher(channel());
      const first = frame("first");
      const second = frame("second");
      await publisher.publish(required(first.id, "first identity"), first);
      await publisher.publish(required(second.id, "second identity"), second);
      await eventually(() => Promise.resolve(received.length === 1));
      expect(received).toEqual(["second"]);
      await publisher.close();
      await expect(subscriber.close()).rejects.toThrow(/background processing failed/iu);
      await expect(factory.close()).resolves.toBeUndefined();
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

  it("retries failed factory cleanup while retaining closed admission", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      await factory.createSubscriber(channel());
      const manifestPath = await manifestPathFor(ipcDirectory);
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { generation: string };
      const socketPath = path.join(
        ipcDirectory,
        "spine-message-channels",
        "sockets",
        `${manifest.generation}.sock`,
      );
      const cleanup = vi
        .spyOn(zeroMqMessageAccess, "remove")
        .mockImplementationOnce(() => Promise.reject(new Error("manifest unlink failed")));
      try {
        await expect(factory.close()).rejects.toThrow(/transport close failed/iu);
        await expect(access(socketPath)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(access(manifestPath)).resolves.toBeUndefined();
        await expect(factory.createPublisher(channel())).rejects.toThrow(/closed/iu);
        await expect(factory.close()).resolves.toBeUndefined();
        await expect(access(manifestPath)).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        cleanup.mockRestore();
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
