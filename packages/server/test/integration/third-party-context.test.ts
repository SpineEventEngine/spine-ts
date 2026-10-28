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

import { create, type Message } from "@bufbuild/protobuf";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AnySchema, TimestampSchema, type Any } from "@bufbuild/protobuf/wkt";
import { AnyPacker, Time, TypeRegistry } from "@spine-event-engine/core";
import { ReviewTaskAssignedSchema } from "../../test-fixtures/generated/handler-registry/events_pb.js";
import {
  ActorContextSchema,
  type ActorContext,
  BoundedContextNameSchema,
  ExternalEventsWantedSchema,
  type Event,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
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

import { ThirdPartyContext as DirectSourceThirdPartyContext } from "../../src/integration/third-party-context.js";
import { BoundedContext as DirectSourceBoundedContext } from "../../src/context/bounded-context.js";
import { ServerEnvironment as DirectSourceServerEnvironment } from "../../src/server/server-environment.js";
import { resetServerEnvironmentForTest as resetDirectSourceServerEnvironment } from "../../src/testing/index.js";
import { RecordingTransportFactory } from "./wave13-red-support.js";
import { expectWave13ContractToCompile } from "./wave13-compile-contract.js";
import {
  ProjectStateSchema,
  ProjectOverviewStateSchema,
  type ProjectState,
} from "../../test-fixtures/generated/entity-metadata/project_states_pb.js";
import type {
  GeneratedHandlerRecordInput,
  GeneratedHandlerRegistry,
} from "../../src/handler/generated-handler-registry.js";

const StateSchema = ProjectOverviewStateSchema;
const SubscribedStateSchema = ProjectStateSchema;
class ExternalStateProjection extends Projection<string, typeof StateSchema> {
  onExternalState(state: ProjectState): void {
    void state;
  }
}
function generatedStateRegistryRoot(): {
  readonly clear: () => void;
  readonly registry: GeneratedHandlerRegistry;
  readonly root: URL;
} {
  const root = mkdtempSync(join(tmpdir(), "spine-wave13-state-registry-"));
  const directory = join(root, "generated/handler");
  const slot = `__spineWave13State_${Math.random().toString(36).slice(2)}`;
  mkdirSync(directory, { recursive: true });
  const registry = {
    receivers: [
      {
        receiverKind: "entity",
        receiverType: ExternalStateProjection,
        stateSchema: StateSchema,
        handlers: [
          {
            kind: "state-subscription",
            methodName: "onExternalState",
            input: { schema: SubscribedStateSchema, origin: "external" },
            outcomes: { returned: [], thrown: [] },
            parameterCount: 1,
          },
        ],
      },
    ],
  } satisfies GeneratedHandlerRegistry;
  (globalThis as Record<string, unknown>)[slot] = registry;
  writeFileSync(
    join(directory, "generated-handler-registry.js"),
    `export const generatedHandlerRegistry = globalThis[${JSON.stringify(slot)}];\n`,
  );
  return {
    root: pathToFileURL(root),
    registry,
    clear: () => {
      Reflect.deleteProperty(globalThis, slot);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("Wave 13 ThirdPartyContext", () => {
  beforeEach(async () => resetServerEnvironmentForTest());
  afterEach(async () => resetServerEnvironmentForTest());
  it("publishes generated events through its direct-source broker and closes idempotently", async () => {
    await resetDirectSourceServerEnvironment();
    DirectSourceServerEnvironment.when(EnvironmentType.Local).use({
      typeRegistry: new TypeRegistry([ReviewTaskAssignedSchema]),
    });
    await DirectSourceServerEnvironment.instance().completeSetup();
    const context = await DirectSourceThirdPartyContext.singleTenant("DirectSourceThirdParty");
    const event = reviewEvent("direct-source");
    const user = create(UserIdSchema, { value: "actor" });

    try {
      await context.emittedEvent(event, user);
      expect(context.isOpen()).toBe(true);
    } finally {
      await context.close();
      await context.close();
      await resetDirectSourceServerEnvironment();
    }

    expect(context.isOpen()).toBe(false);
    await expect(context.emittedEvent(event, user)).rejects.toThrow("ThirdPartyContext is closed.");
  });

  it("copies a current UserId actor timestamp into the imported event context", async () => {
    await resetDirectSourceServerEnvironment();
    DirectSourceServerEnvironment.when(EnvironmentType.Local).use({
      typeRegistry: new TypeRegistry([ReviewTaskAssignedSchema]),
    });
    await DirectSourceServerEnvironment.instance().completeSetup();
    const received: Event[] = [];
    const receiver = await DirectSourceBoundedContext.singleTenant("DirectSourceTimestampReceiver")
      .addEventDispatcher({
        messageSchemas: () => [ReviewTaskAssignedSchema],
        externalEventSchemas: () => [ReviewTaskAssignedSchema],
        dispatch: (event: Event) => {
          received.push(event);
          return Promise.resolve();
        },
      })
      .build();
    const context = await DirectSourceThirdPartyContext.singleTenant("DirectSourceTimestampSource");
    const before = Date.now();
    const precise = create(TimestampSchema, {
      seconds: BigInt(Math.floor(before / 1_000)),
      nanos: (before % 1_000) * 1_000_000 + 456_000,
    });
    const previousProvider = Time.setProvider({ currentTime: () => precise });

    try {
      await context.emittedEvent(
        reviewEvent("timestamp"),
        create(UserIdSchema, { value: "actor" }),
      );
      await expect.poll(() => received.length).toBe(1);
      const eventContext = received[0]?.context;
      const actorContext =
        eventContext?.origin.case === "importContext" ? eventContext.origin.value : undefined;
      expect(actorContext?.timestamp).toEqual(eventContext?.timestamp);
      const timestamp = eventContext?.timestamp;
      expect(timestamp).toEqual(precise);
      expect(timestamp?.seconds).toBeGreaterThan(0n);
      const millis =
        Number(timestamp?.seconds ?? 0n) * 1_000 + Math.floor((timestamp?.nanos ?? 0) / 1_000_000);
      expect(millis).toBeGreaterThanOrEqual(before);
      expect(millis).toBeLessThanOrEqual(Date.now());
    } finally {
      Time.setProvider(previousProvider);
      await Promise.all([receiver.close(), context.close()]);
      await resetDirectSourceServerEnvironment();
    }
  });

  it("routes direct-source multitenant imports and rejects unsupported actor and message forms", async () => {
    await resetDirectSourceServerEnvironment();
    DirectSourceServerEnvironment.when(EnvironmentType.Local).use({
      typeRegistry: new TypeRegistry([ReviewTaskAssignedSchema]),
    });
    await DirectSourceServerEnvironment.instance().completeSetup();
    const received: Event[] = [];
    const receiver = await DirectSourceBoundedContext.multitenant("DirectSourceReceiver")
      .addEventDispatcher({
        messageSchemas: () => [ReviewTaskAssignedSchema],
        externalEventSchemas: () => [ReviewTaskAssignedSchema],
        dispatch: (event: Event) => {
          received.push(event);
          return Promise.resolve();
        },
      })
      .build();
    const single = await DirectSourceThirdPartyContext.singleTenant("DirectSourceSingle");
    const multi = await DirectSourceThirdPartyContext.multitenant("DirectSourceMulti");
    const event = reviewEvent("multitenant");
    const user = create(UserIdSchema, { value: "actor" });
    const tenantId = create(TenantIdSchema, { kind: { case: "value", value: "tenant" } });
    const tenantActor = create(ActorContextSchema, {
      actor: user,
      tenantId,
    });
    await receiver.tenantIndex.keep(tenantId);
    const actorWithoutTenant = create(ActorContextSchema, { actor: user });
    const missingTenantEvent = create(EventSchema, {
      id: create(EventIdSchema, { value: "missing-tenant" }),
      message: AnyPacker.pack(ReviewTaskAssignedSchema, event),
      context: create(EventContextSchema),
    });
    const tenantEvent = create(EventSchema, {
      id: create(EventIdSchema, { value: "single-tenant" }),
      message: AnyPacker.pack(ReviewTaskAssignedSchema, event),
      context: create(EventContextSchema, {
        origin: { case: "importContext", value: tenantActor },
      }),
    });
    const singleReceiver = await DirectSourceBoundedContext.singleTenant(
      "DirectSourceSingleReceiver",
    )
      .addEventDispatcher({
        messageSchemas: () => [ReviewTaskAssignedSchema],
        dispatch: () => Promise.resolve(),
      })
      .build();

    try {
      await expect(receiver.eventBus().post(missingTenantEvent)).rejects.toThrow(
        'Multitenant context "DirectSourceReceiver" requires tenantId.',
      );
      await expect(singleReceiver.eventBus().post(tenantEvent)).rejects.toThrow(
        'Single-tenant context "DirectSourceSingleReceiver" does not accept tenantId.',
      );
      await multi.emittedEvent(event, tenantActor);
      await expect.poll(() => received.length).toBe(1);
      expect(received[0]?.context?.external).toBe(true);
      await expect(multi.emittedEvent(event, user)).rejects.toThrow(
        "Multitenant ThirdPartyContext requires ActorContext.",
      );
      await expect(multi.emittedEvent(event, actorWithoutTenant)).rejects.toThrow(
        "Multitenant ThirdPartyContext requires actor tenantId.",
      );
      await expect(single.emittedEvent(event, tenantActor)).rejects.toThrow(
        "Single-tenant ThirdPartyContext forbids actor tenantId.",
      );
      await expect(single.emittedEvent({ $typeName: "" }, user)).rejects.toThrow(
        "ThirdPartyContext requires a generated event message.",
      );
      await expect(single.emittedEvent(create(ActorContextSchema), user)).rejects.toThrow(
        "ThirdPartyContext does not know spine.core.ActorContext.",
      );
      await receiver.close();
      await expect(receiver.eventBus().post(tenantEvent)).rejects.toThrow(
        "server runtime is closed",
      );
    } finally {
      await Promise.all([receiver.close(), singleReceiver.close(), single.close(), multi.close()]);
      await resetDirectSourceServerEnvironment();
    }
  });

  // prettier-ignore
  it(
    "RED-20 classifies every supported external receptor, keeps system/state subsets out of wanted" +
      " documents, and preserves ThirdPartyContext import semantics",
    async () => {
    expectWave13ContractToCompile(thirdPartyPublicContract);
    const server = await import("@spine-event-engine/server");
    const ThirdPartyContext = server.ThirdPartyContext as
      | {
          singleTenant(name: string): Promise<{
            close(): Promise<void>;
            emittedEvent(event: Message, actor: ActorContext | UserId): Promise<void>;
            isOpen(): boolean;
          }>;
          multitenant(name: string): Promise<{
            close(): Promise<void>;
            emittedEvent(event: Message, actor: ActorContext | UserId): Promise<void>;
            isOpen(): boolean;
          }>;
        }
      | undefined;
    expect(
      ThirdPartyContext,
      "Wave 13 requires the JVM-equivalent ThirdPartyContext.",
    ).toBeDefined();
    if (ThirdPartyContext === undefined) throw new Error("ThirdPartyContext is unavailable.");
    const factory = new RecordingTransportFactory();
    ServerEnvironment.when(EnvironmentType.Local).use({
      integrationChannelFactory: factory,
      typeRegistry: new TypeRegistry([ReviewTaskAssignedSchema]),
    });
    await ServerEnvironment.instance().completeSetup();
    const stateRegistry = generatedStateRegistryRoot();
    const ingestor = new HandlerRegistryIngestor();
    expect(() => ingestor.ingest({ version: 2, entities: [] })).toThrow(/regenerate/u);
    expect(() =>
      ingestor.ingest({
        ...stateRegistry.registry,
        receivers: stateRegistry.registry.receivers.map((receiver) => ({
          ...receiver,
          handlers: receiver.handlers.map((handler) => ({
            ...handler,
            input: { ...handler.input, origin: "foreign" },
          })),
        })),
      }),
    ).toThrow(/origin/u);
    expect(() =>
      ingestor.ingest({
        ...stateRegistry.registry,
        receivers: stateRegistry.registry.receivers.map((receiver) => ({
          ...receiver,
          handlers: receiver.handlers.map((handler) => withoutOrigin(handler)),
        })),
      }),
    ).toThrow(/invalid signal origin/u);
    expect(() =>
      ingestor.ingest({
        ...stateRegistry.registry,
        receivers: stateRegistry.registry.receivers.map((receiver) => ({
          ...receiver,
          handlers: receiver.handlers.map((handler) => ({
            ...handler,
            kind: "command-assignment",
            input: { ...handler.input, origin: "external" },
          })),
        })),
      }),
    ).toThrow(/external.*command|command.*external|origin/iu);
    expect(ingestor.ingest(stateRegistry.registry)[0]?.stateSubscriptions[0]?.origin).toBe(
      "external",
    );
    const stateContext = await BoundedContext.singleTenant("Wave13ExternalState")
      .withGeneratedRegistryRoot(stateRegistry.root)
      .add(ExternalStateProjection)
      .build();
    const received: Event[] = [];
    const singleReceiver = await BoundedContext.singleTenant("Wave13ThirdPartyReceiver")
      .addEventDispatcher({
        messageSchemas: () => [ReviewTaskAssignedSchema],
        externalEventSchemas: () => [ReviewTaskAssignedSchema],
        dispatch: (event: Event) => {
          received.push(event);
          return Promise.resolve();
        },
      })
      .build();
    const imported = reviewEvent("external");
    const singleActor = create(ActorContextSchema, {
      actor: create(UserIdSchema, { value: "actor" }),
    });
    const multiTenantId = create(TenantIdSchema, { kind: { case: "value", value: "tenant" } });
    const multiActor = create(ActorContextSchema, {
      actor: create(UserIdSchema, { value: "actor" }),
      tenantId: multiTenantId,
    });
    const single = await ThirdPartyContext.singleTenant("Wave13ThirdPartySingle");
    const multi = await ThirdPartyContext.multitenant("Wave13ThirdPartyMulti");
    let multiReceiver: BoundedContext | undefined;
    try {
      await single.emittedEvent(imported, singleActor);
      await single.emittedEvent(imported, create(UserIdSchema, { value: "actor" }));
      await expect(single.emittedEvent(imported, multiActor)).rejects.toThrow();
      await expect(multi.emittedEvent(imported, singleActor)).rejects.toThrow();
      await expect(
        multi.emittedEvent(imported, create(UserIdSchema, { value: "actor" })),
      ).rejects.toThrow();
      await singleReceiver.close();
      multiReceiver = await BoundedContext.multitenant("Wave13ThirdPartyMultiReceiver")
        .addEventDispatcher({
          messageSchemas: () => [ReviewTaskAssignedSchema],
          externalEventSchemas: () => [ReviewTaskAssignedSchema],
          dispatch: (event: Event) => {
            received.push(event);
            return Promise.resolve();
          },
        })
        .build();
      await multiReceiver.tenantIndex.keep(multiTenantId);
      await multi.emittedEvent(imported, multiActor);
      expect(received).toHaveLength(3);
      expect(received.every((event) => event.context?.external === true)).toBe(true);
      expect(
        received.map(
          (event) => AnyPacker.unpack(requiredProducerId(event), BoundedContextNameSchema).value,
        ),
      ).toEqual(["Wave13ThirdPartySingle", "Wave13ThirdPartySingle", "Wave13ThirdPartyMulti"]);
      expect(single.isOpen()).toBe(true);
      expect(
        factory.published.filter(
          (entry) =>
            typeof entry.message === "object" && entry.message !== null && "type" in entry.message,
        ),
      ).toEqual([]);
      const wanted = factory.published.flatMap(({ message }) => {
        const original = (message as { originalMessage?: { typeUrl?: string; value?: Uint8Array } })
          .originalMessage;
        if (
          original?.typeUrl !== "type.spine.io/spine.server.integration.ExternalEventsWanted" ||
          original.value === undefined
        )
          return [];
        return [AnyPacker.unpack(create(AnySchema, original), ExternalEventsWantedSchema)];
      });
      const wantedTypes = wanted.flatMap((document) => document.type);
      expect(wantedTypes).not.toContainEqual(
        expect.objectContaining({ typeUrl: `type.spine.io/${StateSchema.typeName}` }),
      );
    } finally {
      await Promise.all([
        stateContext.close(),
        singleReceiver.close(),
        multiReceiver?.close(),
        single.close(),
        multi.close(),
      ]);
      await ServerEnvironment.instance().close();
      stateRegistry.clear();
    }
    expect(single.isOpen()).toBe(false);
    await expect(single.emittedEvent(imported, singleActor)).rejects.toThrow();
  });
});

function withoutOrigin(handler: GeneratedHandlerRecordInput): unknown {
  const { origin, ...withoutOrigin } = handler.input;
  void origin;
  return { ...handler, input: withoutOrigin };
}

function requiredProducerId(event: Event): Any {
  const value = event.context?.producerId;
  if (value === undefined) throw new Error("Imported event is missing producer identity.");
  return value;
}

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

function reviewEvent(id: string) {
  return create(ReviewTaskAssignedSchema, { id, name: id });
}
