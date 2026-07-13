import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { file_spine_options } from "@spine-ts/proto";
import {
  InMemoryStorageFactory,
  type RecordSpec,
  type RecordStorage,
  type StorageContext,
} from "@spine-ts/storage";
import {
  BoundedContext,
  Projection,
  ServerEnvironment,
  type ServerEnvironmentLocalOptions,
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
    readonly environment?: ServerEnvironmentLocalOptions;
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
  const environment = ServerEnvironment.local(options.environment);
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
          signalSchema: LifecycleStateSchema,
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
  const context = await createContext("Lifecycle");

  return Object.freeze({
    context,
    environment,
    events,
    worker,
    createBuilder,
    createContext,
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
  readonly #awaitAttempts: (() => Promise<void>)[] = [];
  readonly #retireFailures: Error[] = [];
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
    this.#retireFailures.push(error);
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
    return Object.freeze({
      obligation,
      shards: Object.freeze(
        shards.map((shard) =>
          failure === undefined
            ? fulfilledEvidence(shard, obligation)
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
    const failure = this.#retireFailures.shift();
    return failure === undefined ? Promise.resolve() : Promise.reject(failure);
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
  readonly storages: RecordStorage<unknown, Message>[] = [];
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
    this.storages.push(storage);
    return storage;
  }

  closeCallsFor(storage: RecordStorage<unknown, Message>): number {
    return this.#storageCloseCalls.get(storage) ?? 0;
  }

  override close(): void {
    this.#closeCalls += 1;
    this.#events.push("facility");
    super.close();
  }
}

function fulfilledEvidence(shard: ShardIndex, obligation: DeliveryRunObligation) {
  return Object.freeze({
    status: "fulfilled" as const,
    shard,
    obligation,
    run: Object.freeze({
      status: "IDLE" as const,
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
  (globalThis as Record<string, unknown>)[slot] = Object.freeze({ version: 1, entities });
  writeFileSync(
    registryPath,
    `export const generatedHandlerRegistry = globalThis[${JSON.stringify(slot)}];\n`,
    "utf8",
  );
  return Object.freeze({ directory, root: pathToFileURL(directory) });
}
