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
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { ChannelIdSchema, ExternalMessageSchema } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import { ZeroMqConfig } from "../../src/zeromq/adapter-config.js";
import { createZeroMqTransportFactory } from "../../src/zeromq/message-transport.js";

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

  it("removes malformed, symlinked, stale, and dead manifests while leaving valid foreign identity untouched", async () => {
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
        received.push(fromBinary(StringValueSchema, message.originalMessage.value).value);
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

  it("fans out frames published by independent publishers through one discovered subscriber", async () => {
    await withIpcDirectory(async (ipcDirectory) => {
      const factory = createZeroMqTransportFactory(config(ipcDirectory));
      const subscriber = await factory.createSubscriber(channel());
      const received: string[] = [];
      await subscriber.addConsumer((message) => {
        received.push(fromBinary(StringValueSchema, message.originalMessage.value).value);
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
  return {
    typeUrl: "type.spine.io/google.protobuf.StringValue",
    value: toBinary(StringValueSchema, create(StringValueSchema, { value })),
  };
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
