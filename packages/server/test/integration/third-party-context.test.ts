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

import { create } from "@bufbuild/protobuf";
import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import {
  ActorContextSchema,
  type ActorContext,
  BoundedContextNameSchema,
  file_spine_options,
  TenantIdSchema,
  type UserId,
  UserIdSchema,
} from "@spine-event-engine/proto";
import {
  BoundedContext,
  EnvironmentType,
  HandlerRegistryIngestor,
  Projection,
  ServerEnvironment,
} from "@spine-event-engine/server";
import { resetServerEnvironmentForTest } from "@spine-event-engine/server/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RecordingTransportFactory } from "./wave13-red-support.js";
import { expectWave13ContractToCompile } from "./wave13-compile-contract.js";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

type State = Message<"ProjectionState"> & { id: string; name: string; priority: number };
function stateSchema(): GenMessage<State> {
  const set = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(serverEntityMetadataTestFixtures.main.descriptorSetBase64, "base64"),
  );
  const descriptor = set.file[0]!;
  return messageDesc(
    fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [
      file_spine_options,
    ]),
    0,
  ) as GenMessage<State>;
}
const StateSchema = stateSchema();
class ExternalStateProjection extends Projection<string, typeof StateSchema, number> {
  onExternalState(_state: State): void {}
}
function generatedStateRegistryRoot(): {
  readonly clear: () => void;
  readonly registry: Record<string, any>;
  readonly root: URL;
} {
  const root = mkdtempSync(join(tmpdir(), "spine-wave13-state-registry-"));
  const directory = join(root, "generated/handler");
  const slot = `__spineWave13State_${Math.random().toString(36).slice(2)}`;
  mkdirSync(directory, { recursive: true });
  const registry = {
    version: 3,
    entities: [
      {
        entityType: ExternalStateProjection,
        stateSchema: StateSchema,
        handlers: [
          {
            kind: "state-subscription",
            methodName: "onExternalState",
            signalSchema: StateSchema,
            emittedSchemas: [],
            parameterCount: 1,
            origin: "domestic",
            origin: "external",
          },
        ],
      },
    ],
  };
  (globalThis as Record<string, unknown>)[slot] = registry;
  writeFileSync(
    join(directory, "generated-handler-registry.js"),
    `export const generatedHandlerRegistry = globalThis[${JSON.stringify(slot)}];\n`,
  );
  return {
    root: pathToFileURL(root),
    registry,
    clear: () => {
      delete (globalThis as Record<string, unknown>)[slot];
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("Wave 13 ThirdPartyContext", () => {
  beforeEach(async () => resetServerEnvironmentForTest());
  afterEach(async () => resetServerEnvironmentForTest());
  it("RED-20 classifies every supported external receptor, keeps system/state subsets out of wanted documents, and preserves ThirdPartyContext import semantics", async () => {
    expectWave13ContractToCompile(thirdPartyPublicContract);
    const server = await import("@spine-event-engine/server");
    const ThirdPartyContext = server.ThirdPartyContext as
      | {
          singleTenant(name: string): Promise<{
            close(): Promise<void>;
            emittedEvent(event: Message, actor: ActorContext): Promise<void>;
            emittedEvent(event: Message, actor: UserId): Promise<void>;
            isOpen(): boolean;
          }>;
          multitenant(name: string): Promise<{
            close(): Promise<void>;
            emittedEvent(event: Message, actor: ActorContext): Promise<void>;
            emittedEvent(event: Message, actor: UserId): Promise<void>;
            isOpen(): boolean;
          }>;
        }
      | undefined;
    expect(
      ThirdPartyContext,
      "Wave 13 requires the JVM-equivalent ThirdPartyContext.",
    ).toBeDefined();
    const factory = new RecordingTransportFactory();
    ServerEnvironment.when(EnvironmentType.Local).use({ transportFactory: factory } as never);
    const stateRegistry = generatedStateRegistryRoot();
    const ingestor = new HandlerRegistryIngestor();
    expect(() => ingestor.ingest({ version: 3, entities: [] })).toThrow(/version 3/u);
    expect(() =>
      ingestor.ingest({
        ...stateRegistry.registry,
        entities: stateRegistry.registry.entities.map((entity: any) => ({
          ...entity,
          handlers: entity.handlers.map((handler: any) => ({ ...handler, origin: "foreign" })),
        })),
      }),
    ).toThrow(/origin/u);
    expect(() =>
      ingestor.ingest({
        ...stateRegistry.registry,
        entities: stateRegistry.registry.entities.map((entity: any) => ({
          ...entity,
          handlers: entity.handlers.map(({ origin: _origin, ...handler }: any) => handler),
        })),
      }),
    ).toThrow(/origin/u);
    expect(() =>
      ingestor.ingest({
        ...stateRegistry.registry,
        entities: stateRegistry.registry.entities.map((entity: any) => ({
          ...entity,
          handlers: entity.handlers.map((handler: any) => ({
            ...handler,
            kind: "command-assignment",
            origin: "external",
          })),
        })),
      }),
    ).toThrow(/external.*command|command.*external|origin/iu);
    expect((ingestor.ingest(stateRegistry.registry)[0] as any).stateSubscriptions[0].origin).toBe(
      "external",
    );
    const stateContext = await BoundedContext.singleTenant("Wave13ExternalState")
      .withGeneratedRegistryRoot(stateRegistry.root)
      .add(ExternalStateProjection)
      .buildAsync();
    const received: any[] = [];
    const receiver = await BoundedContext.singleTenant("Wave13ThirdPartyReceiver")
      .addEventDispatcher({
        messageSchemas: () => [StringValueSchema],
        externalEventSchemas: () => [StringValueSchema],
        dispatch: async (event: unknown) => received.push(event),
      } as never)
      .buildAsync();
    const imported = create(StringValueSchema, { value: "external" });
    const singleActor = create(ActorContextSchema, {
      actor: create(UserIdSchema, { value: "actor" }),
    });
    const multiActor = create(ActorContextSchema, {
      actor: create(UserIdSchema, { value: "actor" }),
      tenantId: create(TenantIdSchema, { value: "tenant" }),
    });
    const single = await ThirdPartyContext!.singleTenant("Wave13ThirdPartySingle");
    const multi = await ThirdPartyContext!.multitenant("Wave13ThirdPartyMulti");
    try {
      await single.emittedEvent(imported, singleActor);
      await single.emittedEvent(imported, create(UserIdSchema, { value: "actor" }));
      await expect(single.emittedEvent(imported, multiActor)).rejects.toThrow();
      await expect(multi.emittedEvent(imported, singleActor)).rejects.toThrow();
      await expect(
        multi.emittedEvent(imported, create(UserIdSchema, { value: "actor" })),
      ).rejects.toThrow();
      await multi.emittedEvent(imported, multiActor);
      expect(received).toHaveLength(3);
      expect(received.every((event) => event.context.external === true)).toBe(true);
      expect(
        received.map(
          (event) => fromBinary(BoundedContextNameSchema, event.context.producerId.value).value,
        ),
      ).toEqual(["Wave13ThirdPartySingle", "Wave13ThirdPartySingle", "Wave13ThirdPartyMulti"]);
      expect(single.isOpen()).toBe(true);
      expect(
        factory.published.filter(
          (entry) =>
            typeof entry.message === "object" && entry.message !== null && "type" in entry.message,
        ),
      ).toEqual([]);
      const proto = (await import("@spine-event-engine/proto")) as Record<string, any>;
      const wanted = factory.published.flatMap(({ message }) => {
        const original = (message as { originalMessage?: { typeUrl?: string; value?: Uint8Array } })
          .originalMessage;
        return original?.typeUrl === "type.spine.io/spine.server.integration.ExternalEventsWanted"
          ? [fromBinary(proto.ExternalEventsWantedSchema, original.value!)]
          : [];
      });
      expect(
        wanted.flatMap((document: { type: readonly { typeUrl: string }[] }) => document.type),
      ).not.toContainEqual(
        expect.objectContaining({ typeUrl: `type.spine.io/${StateSchema.typeName}` }),
      );
    } finally {
      await Promise.all([
        stateContext.close(),
        receiver.close(),
        single.close(),
        multi.close(),
        ServerEnvironment.instance().close(),
      ]);
      stateRegistry.clear();
    }
    expect(single.isOpen()).toBe(false);
    await expect(single.emittedEvent(imported, singleActor)).rejects.toThrow();
  });
});

const thirdPartyPublicContract = `
  import type { Message } from "@bufbuild/protobuf";
  import type { ActorContext, UserId } from "@spine-event-engine/proto";
  import { ThirdPartyContext } from "@spine-event-engine/server";

  type Emit = {
    (event: Message, actor: ActorContext): Promise<void>;
    (event: Message, actor: UserId): Promise<void>;
  };
  type StaticApi = {
    singleTenant(name: string): Promise<ThirdPartyContext>;
    multitenant(name: string): Promise<ThirdPartyContext>;
  };
  declare const context: ThirdPartyContext;
  declare const emit: Emit;
  const exactEmitForward: Emit = context.emittedEvent.bind(context);
  const exactEmitBackward: ThirdPartyContext["emittedEvent"] = emit;
  const staticApi: StaticApi = ThirdPartyContext;
  const open: boolean = context.isOpen();
  const close: Promise<void> = context.close();
  void exactEmitForward;
  void exactEmitBackward;
  void staticApi;
  void open;
  void close;
`;
