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

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
  StringValueSchema,
} from "@bufbuild/protobuf/wkt";
import { AnyMessages, SignalEnvelopes } from "@spine-event-engine/core";
import {
  EventContextSchema,
  EventIdSchema,
  UserIdSchema,
  VersionSchema,
  file_spine_options,
} from "@spine-event-engine/proto";
import {
  InMemoryStorageFactory,
  type RecordSpec,
  type RecordStorage,
  type StorageContext,
} from "@spine-event-engine/storage";
import {
  BoundedContext,
  EnvironmentType,
  Projection,
  ServerEnvironment,
  type ServerEnvironmentSettings,
} from "../../src/index.js";
import type { DeliveryRunObligation } from "../../src/delivery/delivery-run-coordinator.js";
import type { DeliveryWorkerEvidence } from "../../src/delivery/delivery-worker.js";
import type { ShardIndex } from "../../src/delivery/shard-index.js";
import type { EnvironmentGenerationWorker } from "../../src/server/environment-attachment.js";
import type { EnvironmentDeliveryRuntime } from "../../src/server/environment-delivery-worker.js";
import { serverEnvironmentAccess } from "../../src/server/server-environment.js";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

type LifecycleState = Message<"ProjectionState"> & { readonly id: string };

const lifecycleFile = fixtureFile(serverEntityMetadataTestFixtures.main.descriptorSetBase64);
const LifecycleStateSchema = messageDesc(lifecycleFile, 0) as GenMessage<LifecycleState>;

class LifecycleProjection extends Projection<string, typeof LifecycleStateSchema, number> {
  onEvent(event: LifecycleState): void {
    void event;
  }
}

export async function lifecycleFixture(
  options: {
    readonly events?: string[];
    readonly settings?: ServerEnvironmentSettings;
    readonly awaitFailure?: Error;
    readonly workers?: readonly HeldStartupWorker[];
  } = {},
) {
  const events = options.events ?? [];
  const configuredWorkers =
    options.workers === undefined ? undefined : Object.freeze([...options.workers]);
  if (configuredWorkers?.length === 0) {
    throw new Error("Lifecycle fixture requires at least one worker.");
  }
  const worker = configuredWorkers?.[0] ?? new HeldStartupWorker(events, options.awaitFailure);
  let generation = 0;
  ServerEnvironment.when(EnvironmentType.Local).use(options.settings ?? {});
  const environment = ServerEnvironment.instance();
  serverEnvironmentAccess.installTestAttachments(environment, () => {
    if (configuredWorkers === undefined) {
      return worker;
    }
    const next = configuredWorkers[generation];
    generation += 1;
    if (next === undefined) {
      throw new Error("Unexpected environment generation.");
    }
    return next;
  });
  const registry = generatedRegistry([
    {
      entityType: LifecycleProjection,
      stateSchema: LifecycleStateSchema,
      handlers: [
        {
          kind: "event-subscription" as const,
          methodName: "onEvent",
          origin: "domestic" as const,
          signalSchema: StringValueSchema,
          emittedSchemas: [],
          parameterCount: 1 as const,
        },
      ],
    },
  ]);
  const createBuilder = (name: string) =>
    BoundedContext.singleTenant(name)
      .withGeneratedRegistryRoot(registry.root)
      .add(LifecycleProjection);
  const createContext = (name: string) => createBuilder(name).buildAsync();
  const createMixedContext = (name: string) =>
    BoundedContext.singleTenant(name)
      .addCommandDispatcher({
        messageSchemas: () => [LifecycleStateSchema],
        dispatch: () => Promise.resolve(),
      })
      .addEventDispatcher({
        messageSchemas: () => [StringValueSchema],
        dispatch: () => Promise.resolve(),
      })
      .build();
  const createEventContext = (
    name: string,
    observed: string[],
    onDispatch?: (id: string) => Promise<void>,
  ) =>
    BoundedContext.singleTenant(name)
      .addEventDispatcher({
        messageSchemas: () => [StringValueSchema],
        dispatch: (event) => {
          const id = event.id?.value ?? "missing";
          observed.push(id);
          return onDispatch?.(id) ?? Promise.resolve();
        },
      })
      .build();
  const createEvent = (id: string) =>
    SignalEnvelopes.event({
      id: create(EventIdSchema, { value: id }),
      context: create(EventContextSchema, {
        producerId: AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: id })),
        version: create(VersionSchema, { number: 1 }),
      }),
      schema: StringValueSchema,
      message: create(StringValueSchema, { value: id }),
    });
  const context = await createContext("Lifecycle");

  return Object.freeze({
    context,
    environment,
    events,
    worker,
    createBuilder,
    createContext,
    createMixedContext,
    createEventContext,
    createEvent,
    postEvent(target: BoundedContext, id: string) {
      return target.eventBus().post(createEvent(id));
    },
    dispose() {
      rmSync(registry.directory, { recursive: true, force: true });
    },
  });
}

export class HeldStartupWorker implements EnvironmentGenerationWorker {
  readonly #release = Promise.withResolvers<undefined>();
  readonly #started = Promise.withResolvers<undefined>();
  readonly #events: string[];
  readonly #startupFailures: Error[] = [];
  readonly #startAttempts: (() => Promise<DeliveryLoopStatus>)[] = [];
  readonly #awaitAttempts: (() => Promise<void>)[] = [];
  readonly #retireAttempts: (() => Promise<void>)[] = [];
  #starts = 0;
  #stopCalls = 0;
  #awaitCalls = 0;
  #retireCalls = 0;

  constructor(events: string[], awaitFailure?: Error) {
    this.#events = events;
    if (awaitFailure !== undefined) {
      this.failNextAwait(awaitFailure);
    }
  }

  get starts(): number {
    return this.#starts;
  }

  get stopCalls(): number {
    return this.#stopCalls;
  }

  get awaitCalls(): number {
    return this.#awaitCalls;
  }

  get retireCalls(): number {
    return this.#retireCalls;
  }

  started(): Promise<void> {
    return this.#started.promise;
  }

  async startedWithin(ms = 250): Promise<void> {
    await Promise.race([
      this.started(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Attached startup recovery did not begin."));
        }, ms);
      }),
    ]);
  }

  release(): void {
    this.#release.resolve(undefined);
  }

  rejectNextStart(error: Error): void {
    this.#startupFailures.push(error);
  }

  holdNextStart(status: DeliveryLoopStatus = "IDLE"): () => void {
    const held = Promise.withResolvers<DeliveryLoopStatus>();
    this.#startAttempts.push(() => held.promise);
    return () => {
      held.resolve(status);
    };
  }

  failNextAwait(error: Error): void {
    this.#awaitAttempts.push(() => Promise.reject(error));
  }

  holdNextAwait(releaseFailure?: Error): () => void {
    const held = Promise.withResolvers<undefined>();
    this.#awaitAttempts.push(() => held.promise);
    return () => {
      if (releaseFailure === undefined) {
        held.resolve(undefined);
      } else {
        held.reject(releaseFailure);
      }
    };
  }

  failNextRetire(error: Error): void {
    this.#retireAttempts.push(() => Promise.reject(error));
  }

  holdNextRetire(): () => void {
    const held = Promise.withResolvers<undefined>();
    this.#retireAttempts.push(() => held.promise);
    return () => {
      held.resolve(undefined);
    };
  }

  add(runtime: EnvironmentDeliveryRuntime): void {
    void runtime;
  }

  async start(
    obligation: DeliveryRunObligation,
    shards: readonly ShardIndex[],
  ): Promise<DeliveryWorkerEvidence> {
    this.#starts += 1;
    this.#events.push("recovery");
    this.#started.resolve(undefined);
    await this.#release.promise;
    const failure = this.#startupFailures.shift();
    const status = failure === undefined ? await (this.#startAttempts.shift()?.() ?? "IDLE") : null;
    return Object.freeze({
      obligation,
      shards: Object.freeze(
        shards.map((shard) =>
          failure === undefined
            ? fulfilledEvidence(shard, obligation, status ?? "IDLE")
            : rejectedEvidence(shard, obligation, failure),
        ),
      ),
    });
  }

  stop(): void {
    this.#stopCalls += 1;
    this.#events.push("stop");
  }

  awaitSettled(): Promise<void> {
    this.#awaitCalls += 1;
    this.#events.push("await");
    return this.#awaitAttempts.shift()?.() ?? Promise.resolve();
  }

  retire(): Promise<void> {
    this.#retireCalls += 1;
    this.#events.push("retire");
    return this.#retireAttempts.shift()?.() ?? Promise.resolve();
  }

  stopOwners(ownerKeys: readonly string[]): void {
    void ownerKeys;
    this.stop();
  }

  awaitOwnersSettled(ownerKeys: readonly string[]): Promise<void> {
    void ownerKeys;
    return this.awaitSettled();
  }

  retireOwners(ownerKeys: readonly string[]): Promise<void> {
    void ownerKeys;
    return this.retire();
  }
}

export class LifecycleTrackingStorageFactory extends InMemoryStorageFactory {
  readonly storages: RecordStorage<never, Message>[] = [];
  readonly #events: string[];
  readonly #storageCloseCalls = new WeakMap<object, number>();
  #closeCalls = 0;

  constructor(events: string[]) {
    super();
    this.#events = events;
  }

  get closeCalls(): number {
    return this.#closeCalls;
  }

  override createRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    const storage = super.createRecordStorage(context, recordSpec);
    const closeStorage = storage.close.bind(storage);
    this.#storageCloseCalls.set(storage, 0);
    Object.defineProperty(storage, "close", {
      configurable: true,
      value: () => {
        this.#storageCloseCalls.set(storage, this.closeCallsFor(storage) + 1);
        closeStorage();
      },
    });
    this.storages.push(storage as unknown as RecordStorage<never, Message>);
    return storage;
  }

  closeCallsFor(storage: object): number {
    return this.#storageCloseCalls.get(storage) ?? 0;
  }

  override close(): void {
    this.#closeCalls += 1;
    this.#events.push("facility");
    super.close();
  }
}

type DeliveryLoopStatus = "IDLE" | "STOPPED";

function fulfilledEvidence(
  shard: ShardIndex,
  obligation: DeliveryRunObligation,
  status: DeliveryLoopStatus = "IDLE",
) {
  return Object.freeze({
    status: "fulfilled" as const,
    shard,
    obligation,
    run: Object.freeze({
      status,
      runs: 1,
      processed: 0,
      accepted: 0,
      delivered: 0,
      failed: 0,
      failures: Object.freeze([]),
    }),
    progress: Object.freeze({
      runs: 1,
      processed: 0,
      accepted: 0,
      delivered: 0,
      failed: 0,
      failures: Object.freeze([]),
    }),
  });
}

function rejectedEvidence(shard: ShardIndex, obligation: DeliveryRunObligation, cause: Error) {
  return Object.freeze({
    status: "rejected" as const,
    shard,
    obligation,
    cause,
    progress: Object.freeze({
      runs: 1,
      processed: 0,
      accepted: 0,
      delivered: 0,
      failed: 0,
      failures: Object.freeze([]),
    }),
  });
}

function fixtureFile(descriptorSetBase64: string) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];
  if (descriptor === undefined) {
    throw new Error("Lifecycle fixture descriptor set is empty.");
  }
  return fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [
    file_spine_options,
  ]);
}

function generatedRegistry(
  entities: readonly {
    readonly entityType: object;
    readonly stateSchema: GenMessage<Message>;
    readonly handlers: readonly {
      readonly kind: "event-subscription";
      readonly methodName: string;
      readonly origin: "domestic" | "external";
      readonly signalSchema: GenMessage<Message>;
      readonly emittedSchemas: readonly GenMessage<Message>[];
      readonly parameterCount: 1;
    }[];
  }[],
) {
  const slot = `__spineServerLifecycle_${Math.random().toString(36).slice(2)}`;
  const directory = mkdtempSync(join(tmpdir(), "spine-server-lifecycle-"));
  const moduleDirectory = join(directory, "generated/handler");
  const registryPath = join(moduleDirectory, "generated-handler-registry.js");
  mkdirSync(moduleDirectory, { recursive: true });
  (globalThis as Record<string, unknown>)[slot] = Object.freeze({ version: 3, entities });
  writeFileSync(
    registryPath,
    `export const generatedHandlerRegistry = globalThis[${JSON.stringify(slot)}];\n`,
    "utf8",
  );
  return Object.freeze({ directory, root: pathToFileURL(directory) });
}
