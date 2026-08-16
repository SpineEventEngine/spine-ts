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
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";

import { describe, expect, it } from "vitest";
import { Reply } from "zeromq";

interface Factory {
  createPublisher(id: { targetType: string }): Promise<{
    publish(id: unknown, message: unknown): Promise<void>;
    close(): Promise<void>;
  }>;
  createSubscriber(id: { targetType: string }): Promise<{
    isStale(): boolean;
    addConsumer(consumer: (message: unknown) => void): Promise<{ close(): Promise<void> }>;
    close(): Promise<void>;
  }>;
  close(): Promise<void>;
}

async function discoverFactory(path: string, exportName: string): Promise<Factory> {
  let module: Record<string, unknown> = {};
  try {
    module = (await import(path)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Wave 13 message transport is unavailable at ${path}: ${String(error)}`);
  }
  expect(
    module[exportName],
    `${exportName} must implement the frozen TransportFactory SPI.`,
  ).toBeDefined();
  const factory = module[exportName];
  if (typeof factory !== "function") throw new Error(`${exportName} is not a constructor.`);
  return new (factory as new () => Factory)();
}

async function assertConformance(factory: Factory): Promise<void> {
  const proto = await import("@spine-event-engine/proto");
  const channel = create(proto.ChannelIdSchema, {
    targetType: "type.spine.io/wave13.Conformance",
  });
  const statusChannel = create(proto.ChannelIdSchema, {
    targetType: "type.spine.io/wave13.Status",
  });
  const first = await factory.createSubscriber(channel);
  const second = await factory.createSubscriber(channel);
  const received: string[] = [];
  const firstHandle = await first.addConsumer((message) => received.push(frameValue(message)));
  const secondHandle = await second.addConsumer((message) => received.push(frameValue(message)));
  const publisher = await factory.createPublisher(channel);
  const secondPublisher = await factory.createPublisher(channel);
  await publisher.publish(frameId("first"), frame(proto, "first"));
  await eventually(() => received.length === 2);
  expect(received).toEqual(["first", "first"]);
  await firstHandle.close();
  expect(first.isStale()).toBe(true);
  await publisher.publish(frameId("second"), frame(proto, "second"));
  await publisher.publish(frameId("third"), frame(proto, "third"));
  await secondPublisher.publish(frameId("fourth"), frame(proto, "fourth"));
  await eventually(() => received.length === 5);
  expect(received).toEqual(["first", "first", "second", "third", "fourth"]);
  const status = await factory.createSubscriber(statusChannel);
  const statusReceived: string[] = [];
  const statusHandle = await status.addConsumer((message) =>
    statusReceived.push(frameValue(message)),
  );
  const statusPublisher = await factory.createPublisher(statusChannel);
  await statusPublisher.publish(frameId("online"), frame(proto, "online"));
  await eventually(() => statusReceived.length === 1);
  expect(statusReceived).toEqual(["online"]);
  const lateJoin = await factory.createSubscriber(channel);
  const lateReceived: string[] = [];
  const lateHandle = await lateJoin.addConsumer((message) =>
    lateReceived.push(frameValue(message)),
  );
  await publisher.publish(frameId("late"), frame(proto, "late"));
  await eventually(() => lateReceived.length === 1);
  expect(lateReceived).toEqual(["late"]);
  await secondHandle.close();
  await statusHandle.close();
  await lateHandle.close();
  expect(second.isStale()).toBe(true);
  expect(status.isStale()).toBe(true);
  await Promise.all([
    publisher.close(),
    secondPublisher.close(),
    statusPublisher.close(),
    first.close(),
    second.close(),
    status.close(),
    lateJoin.close(),
    factory.close(),
  ]);
}

async function assertNativeManifestContract(directory: string, factory: Factory): Promise<void> {
  const proto = await import("@spine-event-engine/proto");
  const targetType = "type.spine.io/wave13.Manifest";
  const channel = { targetType };
  const subscriber = await factory.createSubscriber(channel);
  const live: string[] = [];
  const liveHandle = await subscriber.addConsumer((message) => live.push(frameValue(message)));
  const root = join(directory, "spine-message-channels");
  const digest = createHash("sha256").update(targetType).digest("hex");
  const subscribers = join(root, "channels", digest, "subscribers");
  const sockets = join(root, "sockets");
  expect((await lstat(root)).isDirectory()).toBe(true);
  const files = await readdir(subscribers);
  expect(files).toHaveLength(1);
  const manifestFile = required(files[0], "subscriber manifest");
  expect(manifestFile).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}\.json$/u);
  const manifest = JSON.parse(await readFile(join(subscribers, manifestFile), "utf8")) as Record<
    string,
    unknown
  >;
  expect(Object.keys(manifest).sort()).toEqual(
    ["adapterIdentity", "endpoint", "generation", "heartbeatAtMs", "ownerPid", "version"].sort(),
  );
  expect(manifest).toMatchObject({ version: 1, adapterIdentity: "wave13-red" });
  expect(manifest.generation).toBe(manifestFile.slice(0, -5));
  expect(manifest.endpoint).toBe(`ipc://${join(sockets, `${String(manifest.generation)}.sock`)}`);
  const oversize = "00000000-0000-4000-8000-000000000000.json";
  const linked = "00000000-0000-4000-8000-000000000001.json";
  const foreign = "00000000-0000-4000-8000-000000000002.json";
  const dead = "00000000-0000-4000-8000-000000000003.json";
  const expired = "00000000-0000-4000-8000-000000000004.json";
  const missing = "00000000-0000-4000-8000-000000000005.json";
  await writeFile(join(subscribers, oversize), "{".repeat(4097));
  await symlink(join(subscribers, manifestFile), join(subscribers, linked));
  await writeFile(
    join(subscribers, foreign),
    JSON.stringify({
      ...manifest,
      generation: "00000000-0000-4000-8000-000000000002",
      adapterIdentity: "foreign",
    }),
  );
  await writeFile(
    join(subscribers, dead),
    JSON.stringify({ ...manifest, generation: dead.slice(0, -5), ownerPid: 2147483647 }),
  );
  await writeFile(
    join(subscribers, expired),
    JSON.stringify({ ...manifest, generation: expired.slice(0, -5), heartbeatAtMs: 0 }),
  );
  await writeFile(
    join(subscribers, missing),
    JSON.stringify({
      ...manifest,
      generation: missing.slice(0, -5),
      endpoint: `ipc://${join(sockets, `${missing.slice(0, -5)}.sock`)}`,
    }),
  );
  const publisher = await factory.createPublisher(channel);
  await expect(publisher.publish(frameId("live"), frame(proto, "live"))).resolves.toBeUndefined();
  await eventually(() => live.length === 1);
  expect(live).toEqual(["live"]);
  for (const removed of [oversize, linked, dead, expired, missing])
    await expect(access(join(subscribers, removed))).rejects.toMatchObject({ code: "ENOENT" });
  expect((await lstat(join(subscribers, foreign))).isFile()).toBe(true);
  await liveHandle.close();
  await subscriber.close();
  expect(await readdir(subscribers)).not.toContain(manifestFile);
  const restarted = await factory.createSubscriber(channel);
  const restartedValues: string[] = [];
  const restartedHandle = await restarted.addConsumer((message) =>
    restartedValues.push(frameValue(message)),
  );
  await publisher.publish(frameId("restart"), frame(proto, "restart"));
  await eventually(() => restartedValues.length === 1);
  expect(restartedValues).toEqual(["restart"]);

  const incompatibleGeneration = "00000000-0000-4000-8000-000000000006";
  const incompatibleSocket = join(sockets, `${incompatibleGeneration}.sock`);
  const incompatibleManifest = join(subscribers, `${incompatibleGeneration}.json`);
  const incompatiblePeer = new Reply({ linger: 0 });
  await incompatiblePeer.bind(`ipc://${incompatibleSocket}`);
  await writeFile(
    incompatibleManifest,
    JSON.stringify({
      ...manifest,
      generation: incompatibleGeneration,
      endpoint: `ipc://${incompatibleSocket}`,
      heartbeatAtMs: Date.now(),
      ownerPid: process.pid,
    }),
  );
  await chmod(incompatibleManifest, 0o600);
  let aggregate: AggregateError | undefined;
  try {
    const attempted = publisher
      .publish(frameId("attempt-all"), frame(proto, "attempt-all"))
      .catch((error: unknown) => {
        aggregate = error as AggregateError;
        throw error;
      });
    await expect(attempted).rejects.toBeInstanceOf(AggregateError);
    expect(restartedValues).toContain("attempt-all");
    if (!(aggregate instanceof AggregateError)) throw new Error("Expected aggregate failure.");
    expect(aggregate.message).toContain(targetType);
    expect(JSON.stringify(aggregate.errors)).toContain(incompatibleGeneration);
    expect(`${aggregate.message}${JSON.stringify(aggregate.errors)}`).not.toMatch(
      /ipc:\/\/|\.sock|spine-message-channels|heartbeatAtMs|ownerPid|adapterIdentity/u,
    );
  } finally {
    incompatiblePeer.close();
    await rm(incompatibleManifest, { force: true });
    await rm(incompatibleSocket, { force: true });
  }

  let activeSubscriber = restarted;
  let activeHandle = restartedHandle;
  let activeValues = restartedValues;
  const descriptorCount = await fileDescriptorCount();
  for (let generation = 0; generation < 8; generation += 1) {
    await activeHandle.close();
    await activeSubscriber.close();
    activeSubscriber = await factory.createSubscriber(channel);
    const generationValues: string[] = [];
    activeValues = generationValues;
    activeHandle = await activeSubscriber.addConsumer((message) =>
      generationValues.push(frameValue(message)),
    );
    await publisher.publish(
      frameId(`generation-${String(generation)}`),
      frame(proto, `generation-${String(generation)}`),
    );
    await eventually(() => generationValues.length === 1);
    const currentManifests = (await readdir(subscribers)).filter(
      (name) => name.endsWith(".json") && name !== foreign,
    );
    expect(currentManifests).toHaveLength(1);
    const currentSockets = (await readdir(sockets)).filter((name) => name.endsWith(".sock"));
    expect(currentSockets).toHaveLength(1);
    await eventuallyAsync(async () => (await fileDescriptorCount()) <= descriptorCount + 2);
  }

  const boundEntries = Array.from(
    { length: 1022 },
    (_, index) =>
      `${index.toString(16).padStart(8, "0")}-0000-4000-8000-${index
        .toString(16)
        .padStart(12, "0")}.json`,
  );
  for (let offset = 0; offset < boundEntries.length; offset += 32) {
    await Promise.all(
      boundEntries.slice(offset, offset + 32).map((name) =>
        writeFile(
          join(subscribers, name),
          JSON.stringify({
            ...manifest,
            generation: name.slice(0, -5),
            adapterIdentity: "foreign",
          }),
        ),
      ),
    );
  }
  const beforeBounded = activeValues.length;
  await expect(
    publisher.publish(frameId("at-bound"), frame(proto, "at-bound")),
  ).resolves.toBeUndefined();
  await eventually(() => activeValues.length === beforeBounded + 1);
  const overBound = "ffffffff-ffff-4fff-8fff-ffffffffffff.json";
  await writeFile(
    join(subscribers, overBound),
    JSON.stringify({ ...manifest, generation: overBound.slice(0, -5), adapterIdentity: "foreign" }),
  );
  await expect(publisher.publish(frameId("bounded"), frame(proto, "bounded"))).rejects.toThrow(
    /1024|bound|manifest/iu,
  );
  await Promise.all([activeHandle.close(), activeSubscriber.close()]);
  await expect(publisher.close()).rejects.toBeInstanceOf(AggregateError);
  await factory.close();
}

describe("Wave 13 message transport conformance", () => {
  // prettier-ignore
  it(
    "RED-21 gives memory and ZeroMQ factories one typed channel, fan-out, stale, FIFO, and close contract",
    async () => {
    expectTransportContractToCompile();
    await assertConformance(await discoverFactory("../src/index.js", "InMemoryTransportFactory"));
    const zeroMqRoot = (await import("../src/zeromq/index.js")) as Record<string, unknown>;
    expect(zeroMqRoot.createZeroMqTransportFactory).toBeDefined();
    expect(zeroMqRoot.ZeroMqConfig).toBeDefined();
    const directory = await mkdtemp("/tmp/sz-");
    try {
      const config = (zeroMqRoot.ZeroMqConfig as { create(input: unknown): unknown }).create({
        ipcDirectory: directory,
        adapterIdentity: "wave13-red",
      });
      await assertConformance(
        (zeroMqRoot.createZeroMqTransportFactory as (config: unknown) => Factory)(config),
      );
      await assertNativeManifestContract(
        directory,
        (zeroMqRoot.createZeroMqTransportFactory as (config: unknown) => Factory)(config),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function frameId(value: string) {
  return {
    typeUrl: "type.spine.io/google.protobuf.StringValue",
    value: toBinary(StringValueSchema, create(StringValueSchema, { value })),
  };
}

function frame(proto: typeof import("@spine-event-engine/proto"), value: string) {
  return create(proto.ExternalMessageSchema, {
    id: frameId(value),
    originalMessage: frameId(value),
    boundedContextName: { value: "Wave13Transport" },
  });
}

function required<Value>(value: Value | undefined, label: string): Value {
  if (value === undefined) throw new Error(`Missing ${label}.`);
  return value;
}

function frameValue(message: unknown): string {
  const original = (message as { originalMessage: { value: Uint8Array } }).originalMessage;
  return fromBinary(StringValueSchema, original.value).value;
}

function expectTransportContractToCompile(): void {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const directory = mkdtempSync(join(packageRoot, ".wave13-contract-"));
  try {
    writeFileSync(join(directory, "contract.ts"), transportPublicContract, "utf8");
    writeFileSync(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        extends: join(repositoryRoot, "tsconfig.base.json"),
        compilerOptions: {
          composite: false,
          lib: ["ES2024", "DOM"],
          noEmit: true,
          rootDir: directory,
          skipLibCheck: true,
          types: ["node"],
        },
        include: ["contract.ts"],
      }),
      "utf8",
    );
    const result = spawnSync(
      process.execPath,
      [
        join(repositoryRoot, "node_modules/typescript/bin/tsc"),
        "-p",
        join(directory, "tsconfig.json"),
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    );
    expect(
      result.status,
      `Wave 13 transport declarations failed:\n${result.stdout}${result.stderr}`,
    ).toBe(0);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

const transportPublicContract = `
  import type { Any } from "@bufbuild/protobuf/wkt";
  import type { ChannelId, ExternalMessage } from "@spine-event-engine/proto";
  import {
    InMemoryTransportFactory,
    type ConsumerHandle,
    type ExternalMessageConsumer,
    type MessageChannel,
    type Publisher,
    type Subscriber,
    type TransportFactory,
  } from "@spine-event-engine/transport";
  import { createZeroMqTransportFactory, ZeroMqConfig } from "@spine-event-engine/transport/zeromq";

  declare const channel: ChannelId;
  declare const id: Any;
  declare const message: ExternalMessage;
  declare const consumer: ExternalMessageConsumer;
  declare const handle: ConsumerHandle;
  declare const base: MessageChannel;
  declare const publisher: Publisher;
  declare const subscriber: Subscriber;
  type Equal<Left, Right> =
    (<Value>() => Value extends Left ? 1 : 2) extends
    (<Value>() => Value extends Right ? 1 : 2) ? true : false;
  type Assert<Value extends true> = Value;
  type ChannelIdIsExact = Assert<Equal<MessageChannel["id"], ChannelId>>;
  type TargetTypeIsExact = Assert<Equal<MessageChannel["targetType"], string>>;
  type StaleIsExact = Assert<Equal<MessageChannel["isStale"], () => boolean>>;
  type ConsumerIsExact = Assert<
    Equal<ExternalMessageConsumer, (message: ExternalMessage) => void | Promise<void>>
  >;
  const memory: TransportFactory = new InMemoryTransportFactory();
  const native: TransportFactory = createZeroMqTransportFactory(
    ZeroMqConfig.create({ ipcDirectory: "/tmp/wave13", adapterIdentity: "wave13" }),
  );
  const publish: Promise<void> = publisher.publish(id, message);
  const attach: Promise<ConsumerHandle> = subscriber.addConsumer(consumer);
  const publisherCreation: Promise<Publisher> = memory.createPublisher(channel);
  const subscriberCreation: Promise<Subscriber> = native.createSubscriber(channel);
  const channelId: ChannelId = base.id;
  const targetType: string = base.targetType;
  const stale: boolean = base.isStale();
  const closes: Promise<void>[] = [handle.close(), base.close(), memory.close(), native.close()];
  // @ts-expect-error MessageChannel identity is immutable.
  base.id = channel;
  // @ts-expect-error MessageChannel target type is immutable.
  base.targetType = "replacement";
  void publish; void attach; void publisherCreation; void subscriberCreation; void closes;
  void channelId; void targetType; void stale;
  void (undefined as unknown as ChannelIdIsExact);
  void (undefined as unknown as TargetTypeIsExact);
  void (undefined as unknown as StaleIsExact);
  void (undefined as unknown as ConsumerIsExact);
`;

async function eventually(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for transport delivery.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function eventuallyAsync(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for bounded native resources.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function fileDescriptorCount(): Promise<number> {
  return (await readdir("/dev/fd")).length;
}
