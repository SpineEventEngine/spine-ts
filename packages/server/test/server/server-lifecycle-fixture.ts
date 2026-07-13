import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { file_spine_options } from "@spine-ts/proto";
import { BoundedContext, Projection, ServerEnvironment } from "../../src/index.js";
import type { DeliveryRunObligation } from "../../src/delivery/delivery-run-coordinator.js";
import type { DeliveryWorkerEvidence } from "../../src/delivery/delivery-worker.js";
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

export async function lifecycleFixture(options: { readonly events?: string[] } = {}) {
  const events = options.events ?? [];
  const worker = new HeldStartupWorker(events);
  const environment = ServerEnvironment.local();
  serverEnvironmentAccess.installTestAttachments(environment, { createWorker: () => worker });
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
  const context = await BoundedContext.singleTenant("Lifecycle")
    .withGeneratedRegistryRoot(registry.root)
    .add(LifecycleProjection)
    .buildAsync();

  return Object.freeze({
    context,
    environment,
    events,
    worker,
    dispose() {
      rmSync(registry.directory, { recursive: true, force: true });
    },
  });
}

export class HeldStartupWorker implements EnvironmentGenerationWorker {
  readonly #release = Promise.withResolvers<undefined>();
  readonly #started = Promise.withResolvers<undefined>();
  readonly #events: string[];
  #starts = 0;

  constructor(events: string[]) {
    this.#events = events;
  }

  get starts(): number {
    return this.#starts;
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

  add(runtime: EnvironmentDeliveryRuntime): void {
    void runtime;
  }

  async start(
    obligation: DeliveryRunObligation,
    shards: readonly { readonly index: number; readonly ofTotal: number }[],
  ): Promise<DeliveryWorkerEvidence> {
    this.#starts += 1;
    this.#events.push("recovery");
    this.#started.resolve(undefined);
    await this.#release.promise;
    return Object.freeze({
      obligation,
      shards: Object.freeze(
        shards.map((shard) =>
          Object.freeze({
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
          }),
        ),
      ),
    });
  }

  stop(): void {
    this.#events.push("stop");
  }

  awaitSettled(): Promise<void> {
    this.#events.push("await");
    return Promise.resolve();
  }

  retire(): Promise<void> {
    this.#events.push("retire");
    return Promise.resolve();
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
