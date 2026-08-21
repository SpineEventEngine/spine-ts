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

import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  AnySchema,
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
  BoolValueSchema,
  BytesValueSchema,
  DoubleValueSchema,
  Int32ValueSchema,
  Int64ValueSchema,
  StringValueSchema,
} from "@bufbuild/protobuf/wkt";
import { AnyMessages, TypeUrls, type MessageSchema } from "@spine-event-engine/core";
import {
  EventContextSchema,
  EventSchema,
  RejectionEventContextSchema,
  type EventContext,
  file_spine_options,
} from "@spine-event-engine/proto";
import {
  CompositeFilterSchema,
  CompositeFilter_CompositeOperator,
  FilterSchema,
  Filter_Operator,
  SubscriptionSchema,
  type Subscription,
  type SubscriptionUpdate,
} from "@spine-event-engine/proto/client";
import { EventStore, InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { eventBusAccess, EventBus } from "../../src/bus/event-bus.js";
import { SubscriptionObservers } from "../../src/stand/subscription-observer.js";
import * as EntityLog from "@spine-event-engine/proto/generated/spine/system/server/entity_log_events_pb.js";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

type ProjectionState = Message<"ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

function fixtureFile(descriptorSetBase64: string) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];
  if (descriptor === undefined) throw new Error("Expected fixture descriptor.");
  return fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [
    file_spine_options,
  ]);
}

const fixture = fixtureFile(serverEntityMetadataTestFixtures.main.descriptorSetBase64);
const ProjectionStateSchema = messageDesc(fixture, 0) as GenMessage<ProjectionState>;
let eventSequence = 0;

describe("SubscriptionObservers", () => {
  it("keeps event and entity-state observers on their explicitly selected buses", () => {
    expect(
      Object.getOwnPropertyDescriptor(SubscriptionObservers, "observeEvent")?.value,
    ).toBeTypeOf("function");
    expect(
      Object.getOwnPropertyDescriptor(SubscriptionObservers, "observeState")?.value,
    ).toBeTypeOf("function");
  });

  it("does not attach incomplete, state, or event targets without a local EventBus", () => {
    const state = { schema: ProjectionStateSchema, idField: "id" };
    const missingTarget = observeSubscription(
      create(SubscriptionSchema),
      undefined,
      () => state,
      () => undefined,
    );
    const emptyTarget = observeSubscription(
      create(SubscriptionSchema, { topic: { target: { type: "" } } }),
      undefined,
      () => state,
      () => undefined,
    );
    const stateTarget = observeSubscription(
      subscriptionFor(ProjectionStateSchema),
      undefined,
      () => state,
      () => undefined,
    );
    const eventTarget = observeSubscription(
      subscriptionFor(ProjectionStateSchema),
      undefined,
      () => undefined,
      () => undefined,
    );

    expect([missingTarget, emptyTarget, stateTarget, eventTarget]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("renders a masked matching state then a no-longer-matching state from the local EventBus", async () => {
    const bus = createSystemBus();
    const received: SubscriptionUpdate[] = [];
    const subscription = create(SubscriptionSchema, {
      topic: {
        target: {
          type: TypeUrls.derive(ProjectionStateSchema),
          criterion: {
            case: "filters",
            value: {
              idFilter: { id: [packString("task-1")] },
              filter: [
                create(CompositeFilterSchema, {
                  operator: CompositeFilter_CompositeOperator.ALL,
                  filter: [
                    create(FilterSchema, {
                      fieldPath: { fieldName: ["priority"] },
                      operator: Filter_Operator.EQUAL,
                      value: AnyMessages.pack(
                        Int32ValueSchema,
                        create(Int32ValueSchema, { value: 1 }),
                      ),
                    }),
                  ],
                }),
              ],
            },
          },
        },
        fieldMask: { paths: ["name"] },
      },
    });

    const observer = observeSubscription(
      subscription,
      bus,
      (typeUrl) =>
        typeUrl === TypeUrls.derive(ProjectionStateSchema)
          ? { schema: ProjectionStateSchema, idField: "id" }
          : undefined,
      (update) => received.push(update),
    );

    await postStateChange(bus, createState("task-1", "Open", 1));
    await postStateChange(
      bus,
      createState("task-1", "Closed", 2),
      createState("task-1", "Open", 1),
    );
    await postStateChange(bus, createState("other", "Ignored", 1));

    expect(received).toHaveLength(2);
    const first =
      received[0]?.update.case === "entityUpdates" ? received[0].update.value.update[0] : undefined;
    expect(first?.kind.case).toBe("state");
    if (first?.kind.case === "state") {
      expect(AnyMessages.unpack(first.kind.value, ProjectionStateSchema)).toEqual(
        create(ProjectionStateSchema, { name: "Open" }),
      );
    }
    const second =
      received[1]?.update.case === "entityUpdates" ? received[1].update.value.update[0] : undefined;
    expect(second?.kind.case).toBe("noLongerMatching");
    observer?.unsubscribe();
    await bus.close();
  });

  it("matches EITHER criteria after an ID filter and leaves an explicit empty mask unprojected", async () => {
    const bus = createSystemBus();
    const received: SubscriptionUpdate[] = [];
    const observer = observeSubscription(
      create(SubscriptionSchema, {
        topic: {
          target: {
            type: TypeUrls.derive(ProjectionStateSchema),
            criterion: {
              case: "filters",
              value: {
                idFilter: { id: [packString("task-either")] },
                filter: [
                  create(CompositeFilterSchema, {
                    operator: CompositeFilter_CompositeOperator.EITHER,
                    filter: [
                      create(FilterSchema, {
                        fieldPath: { fieldName: ["name"] },
                        operator: Filter_Operator.EQUAL,
                        value: packString("Named match"),
                      }),
                      create(FilterSchema, {
                        fieldPath: { fieldName: ["priority"] },
                        operator: Filter_Operator.EQUAL,
                        value: AnyMessages.pack(
                          Int32ValueSchema,
                          create(Int32ValueSchema, { value: 5 }),
                        ),
                      }),
                    ],
                  }),
                ],
              },
            },
          },
          fieldMask: { paths: [] },
        },
      }),
      bus,
      () => ({ schema: ProjectionStateSchema, idField: "id" }),
      (update) => received.push(update),
    );

    await postStateChange(bus, createState("task-either", "Priority match", 5));
    await postStateChange(bus, createState("task-either", "No match", 1));
    await postStateChange(bus, createState("other", "Named match", 1));

    expect(received).toHaveLength(1);
    const update =
      received[0]?.update.case === "entityUpdates" ? received[0].update.value.update[0] : undefined;
    if (update?.kind.case !== "state") throw new Error("Expected an entity state update.");
    expect(AnyMessages.unpack(update.kind.value, ProjectionStateSchema)).toEqual(
      createState("task-either", "Priority match", 5),
    );
    observer?.unsubscribe();
    await bus.close();
  });

  it("suppresses state delivery for unsupported, valueless, and unresolved filters", async () => {
    const bus = createSystemBus();
    const received: SubscriptionUpdate[] = [];
    const filters = [
      create(FilterSchema, {
        fieldPath: { fieldName: ["priority"] },
        operator: Filter_Operator.GREATER_THAN,
        value: AnyMessages.pack(Int32ValueSchema, create(Int32ValueSchema, { value: 1 })),
      }),
      create(FilterSchema, {
        fieldPath: { fieldName: ["priority"] },
        operator: Filter_Operator.EQUAL,
      }),
      create(FilterSchema, {
        fieldPath: { fieldName: ["missing"] },
        operator: Filter_Operator.EQUAL,
        value: packString("value"),
      }),
    ];
    const observers = filters.map((filter) =>
      observeSubscription(
        create(SubscriptionSchema, {
          topic: {
            target: {
              type: TypeUrls.derive(ProjectionStateSchema),
              criterion: {
                case: "filters",
                value: {
                  filter: [
                    create(CompositeFilterSchema, {
                      operator: CompositeFilter_CompositeOperator.ALL,
                      filter: [filter],
                    }),
                  ],
                },
              },
            },
          },
        }),
        bus,
        () => ({ schema: ProjectionStateSchema, idField: "id" }),
        (update) => received.push(update),
      ),
    );

    await postStateChange(bus, createState("task-filter", "Candidate", 1));

    expect(received).toEqual([]);
    observers.forEach((observer) => observer?.unsubscribe());
    await bus.close();
  });

  it("round-trips supported scalar entity IDs through state subscription updates", async () => {
    const cases = [
      { schema: StringValueSchema, value: "text", rendered: StringValueSchema },
      { schema: BoolValueSchema, value: true, rendered: BoolValueSchema },
      { schema: Int32ValueSchema, value: 7, rendered: DoubleValueSchema },
      { schema: Int64ValueSchema, value: 9n, rendered: Int64ValueSchema },
      { schema: BytesValueSchema, value: new Uint8Array([1, 2]), rendered: BytesValueSchema },
    ] as const;
    const bus = createSystemBus();
    const received: SubscriptionUpdate[] = [];
    const observers = cases.map(({ schema }) =>
      observeSubscription(
        subscriptionFor(schema),
        bus,
        (typeUrl) =>
          typeUrl === TypeUrls.derive(schema) ? { schema, idField: "value" } : undefined,
        (update) => received.push(update),
      ),
    );

    for (const { schema, value } of cases) {
      const state = create(schema, { value } as never);
      await postObservedStateChange(
        bus,
        schema,
        state,
        AnyMessages.pack(schema, state, { validate: false }),
      );
    }

    expect(received).toHaveLength(cases.length);
    for (const [index, { value, rendered }] of cases.entries()) {
      expect(AnyMessages.unpack(entityUpdateId(received[index]), rendered)?.value).toEqual(value);
    }
    observers.forEach((observer) => observer?.unsubscribe());
    await bus.close();
  });

  it("matches raw Any and byte entity IDs by exact bytes while rejecting unequal values", async () => {
    const bus = createSystemBus();
    const received: SubscriptionUpdate[] = [];
    const anyId = create(AnySchema, {
      typeUrl: "type.googleapis.com/example.UnknownId",
      value: new Uint8Array([1, 2]),
    });
    const otherAnyId = create(AnySchema, {
      typeUrl: anyId.typeUrl,
      value: new Uint8Array([1, 3]),
    });
    const bytesId = AnyMessages.pack(
      BytesValueSchema,
      create(BytesValueSchema, { value: new Uint8Array([4, 5]) }),
    );
    const otherBytesId = AnyMessages.pack(
      BytesValueSchema,
      create(BytesValueSchema, { value: new Uint8Array([4, 6]) }),
    );
    const observers = [anyId, otherAnyId, bytesId, otherBytesId].map((id) =>
      observeSubscription(
        filteredSubscription(StringValueSchema, id),
        bus,
        () => ({ schema: StringValueSchema, idField: "value" }),
        (update) => received.push(update),
      ),
    );

    await postObservedStateChange(
      bus,
      StringValueSchema,
      create(StringValueSchema, { value: "Any ID" }),
      anyId,
    );
    await postObservedStateChange(
      bus,
      StringValueSchema,
      create(StringValueSchema, { value: "Bytes ID" }),
      bytesId,
    );

    expect(received).toHaveLength(2);
    expect(entityUpdateId(received[0])).toEqual(anyId);
    expect(entityUpdateId(received[1])).toEqual(bytesId);
    observers.forEach((observer) => observer?.unsubscribe());
    await bus.close();
  });

  it("ignores state-change envelopes with a wrong tenant, state type, or malformed payload", async () => {
    const bus = createSystemBus();
    const received: SubscriptionUpdate[] = [];
    const observer = observeSubscription(
      create(SubscriptionSchema, {
        topic: {
          context: { tenantId: { kind: { case: "value", value: "tenant-a" } } },
          target: {
            type: TypeUrls.derive(ProjectionStateSchema),
            criterion: { case: "includeAll", value: true },
          },
        },
      }),
      bus,
      () => ({ schema: ProjectionStateSchema, idField: "id" }),
      (update) => received.push(update),
    );

    await postStateChange(bus, createState("task-1", "Wrong tenant", 1), undefined, "tenant-b");
    await bus.post(
      create(EventSchema, {
        id: { value: "wrong-type" },
        message: AnyMessages.pack(
          EntityLog.EntityStateChangedSchema,
          create(EntityLog.EntityStateChangedSchema, {
            entity: { id: packString("task-1"), typeUrl: TypeUrls.derive(StringValueSchema) },
            newState: packString("not projection state"),
            signalId: [
              { id: packString("wrong-type"), typeUrl: TypeUrls.derive(StringValueSchema) },
            ],
          }),
          { validate: false },
        ),
        context: tenantContext("tenant-a"),
      }),
    );
    await expect(
      bus.post(
        create(EventSchema, {
          id: { value: "malformed" },
          message: AnyMessages.pack(
            EntityLog.EntityStateChangedSchema,
            create(EntityLog.EntityStateChangedSchema),
            { validate: false },
          ),
          context: tenantContext("tenant-a"),
        }),
      ),
    ).rejects.toBeInstanceOf(Error);

    expect(received).toEqual([]);
    observer?.unsubscribe();
    await bus.close();
  });

  it("renders archive and delete lifecycle events as entity removals", async () => {
    const bus = createSystemBus();
    const received: SubscriptionUpdate[] = [];
    const observer = observeSubscription(
      subscriptionFor(ProjectionStateSchema),
      bus,
      () => ({ schema: ProjectionStateSchema, idField: "id" }),
      (update) => received.push(update),
    );

    await bus.post(
      create(EventSchema, {
        id: { value: "archived" },
        message: AnyMessages.pack(
          EntityLog.EntityArchivedSchema,
          create(EntityLog.EntityArchivedSchema, {
            entity: {
              id: packString("task-archived"),
              typeUrl: TypeUrls.derive(ProjectionStateSchema),
            },
            signalId: [
              { id: packString("archive-signal"), typeUrl: TypeUrls.derive(StringValueSchema) },
            ],
            version: { number: 1 },
            lastState: AnyMessages.pack(
              ProjectionStateSchema,
              createState("task-archived", "Archived", 1),
            ),
          }),
          { validate: false },
        ),
      }),
    );
    await bus.post(
      create(EventSchema, {
        id: { value: "deleted" },
        message: AnyMessages.pack(
          EntityLog.EntityDeletedSchema,
          create(EntityLog.EntityDeletedSchema, {
            entity: {
              id: packString("task-deleted"),
              typeUrl: TypeUrls.derive(ProjectionStateSchema),
            },
            signalId: [
              { id: packString("delete-signal"), typeUrl: TypeUrls.derive(StringValueSchema) },
            ],
            version: { number: 1 },
            deletion: { case: "markedAsDeleted", value: true },
            lastState: AnyMessages.pack(
              ProjectionStateSchema,
              createState("task-deleted", "Deleted", 1),
            ),
          }),
          { validate: false },
        ),
      }),
    );

    expect(received).toHaveLength(2);
    expect(received[0]?.subscription?.topic?.target?.type).toBe(
      TypeUrls.derive(ProjectionStateSchema),
    );
    expect(
      received.map(
        (update) =>
          update.update.case === "entityUpdates" && update.update.value.update[0]?.kind.case,
      ),
    ).toEqual(["noLongerMatching", "noLongerMatching"]);
    observer?.unsubscribe();
    await bus.close();
  });

  it("renders unarchive and restore lifecycle events as state updates", async () => {
    const bus = createSystemBus();
    const received: SubscriptionUpdate[] = [];
    const observer = observeSubscription(
      subscriptionFor(ProjectionStateSchema),
      bus,
      () => ({ schema: ProjectionStateSchema, idField: "id" }),
      (update) => received.push(update),
    );
    for (const [schema, id] of [
      [EntityLog.EntityUnarchivedSchema, "unarchived"],
      [EntityLog.EntityRestoredSchema, "restored"],
    ] as const) {
      await bus.post(
        create(EventSchema, {
          id: { value: id },
          message: AnyMessages.pack(
            schema,
            create(schema, {
              entity: { id: packString(id), typeUrl: TypeUrls.derive(ProjectionStateSchema) },
              signalId: [
                { id: packString(`${id}-signal`), typeUrl: TypeUrls.derive(StringValueSchema) },
              ],
              version: { number: 2 },
              state: AnyMessages.pack(ProjectionStateSchema, createState(id, id, 1)),
            }),
            { validate: false },
          ),
        }),
      );
    }
    expect(received).toHaveLength(2);
    expect(
      received.map(
        (update) =>
          update.update.case === "entityUpdates" && update.update.value.update[0]?.kind.case,
      ),
    ).toEqual(["state", "state"]);
    observer?.unsubscribe();
    await bus.close();
  });

  it("isolates lifecycle removals by subscription tenant", async () => {
    const bus = createSystemBus();
    const received: SubscriptionUpdate[] = [];
    const observer = observeSubscription(
      create(SubscriptionSchema, {
        topic: {
          context: { tenantId: { kind: { case: "value", value: "tenant-a" } } },
          target: {
            type: TypeUrls.derive(ProjectionStateSchema),
            criterion: { case: "includeAll", value: true },
          },
        },
      }),
      bus,
      () => ({ schema: ProjectionStateSchema, idField: "id" }),
      (update) => received.push(update),
    );
    for (const tenant of ["tenant-b", "tenant-a"]) {
      await bus.post(
        create(EventSchema, {
          id: { value: tenant },
          context: tenantContext(tenant),
          message: AnyMessages.pack(
            EntityLog.EntityArchivedSchema,
            create(EntityLog.EntityArchivedSchema, {
              entity: { id: packString(tenant), typeUrl: TypeUrls.derive(ProjectionStateSchema) },
              signalId: [{ id: packString(tenant), typeUrl: TypeUrls.derive(StringValueSchema) }],
              version: { number: 1 },
              lastState: AnyMessages.pack(ProjectionStateSchema, createState(tenant, tenant, 1)),
            }),
            { validate: false },
          ),
        }),
      );
    }
    expect(received).toHaveLength(1);
    expect(AnyMessages.unpack(entityUpdateId(received[0]), StringValueSchema)?.value).toBe(
      "tenant-a",
    );
    observer?.unsubscribe();
    await bus.close();
  });

  it("does not leak archive removals to a nonmatching filtered subscription", async () => {
    const bus = createSystemBus();
    const received: SubscriptionUpdate[] = [];
    const observer = observeSubscription(
      filteredSubscription(ProjectionStateSchema, packString("other-id")),
      bus,
      () => ({ schema: ProjectionStateSchema, idField: "id" }),
      (update) => received.push(update),
    );
    await bus.post(
      create(EventSchema, {
        id: { value: "archive-filter" },
        message: AnyMessages.pack(
          EntityLog.EntityArchivedSchema,
          create(EntityLog.EntityArchivedSchema, {
            entity: {
              id: packString("archived-id"),
              typeUrl: TypeUrls.derive(ProjectionStateSchema),
            },
            signalId: [{ id: packString("signal"), typeUrl: TypeUrls.derive(StringValueSchema) }],
            version: { number: 1 },
            lastState: AnyMessages.pack(
              ProjectionStateSchema,
              createState("archived-id", "Archived", 1),
            ),
          }),
          { validate: false },
        ),
      }),
    );
    expect(received).toEqual([]);
    observer?.unsubscribe();
    await bus.close();
  });

  it("filters unarchive and restore updates by their current state", async () => {
    const bus = createSystemBus();
    const received: SubscriptionUpdate[] = [];
    const observer = observeSubscription(
      filteredSubscription(ProjectionStateSchema, packString("match")),
      bus,
      () => ({ schema: ProjectionStateSchema, idField: "id" }),
      (update) => received.push(update),
    );
    for (const [schema, id] of [
      [EntityLog.EntityUnarchivedSchema, "other"],
      [EntityLog.EntityRestoredSchema, "other"],
      [EntityLog.EntityUnarchivedSchema, "match"],
      [EntityLog.EntityRestoredSchema, "match"],
    ] as const) {
      await bus.post(
        create(EventSchema, {
          id: { value: `${id}-${schema.typeName}` },
          message: AnyMessages.pack(
            schema,
            create(schema, {
              entity: { id: packString(id), typeUrl: TypeUrls.derive(ProjectionStateSchema) },
              signalId: [{ id: packString(id), typeUrl: TypeUrls.derive(StringValueSchema) }],
              version: { number: 1 },
              state: AnyMessages.pack(ProjectionStateSchema, createState(id, id, 1)),
            }),
            { validate: false },
          ),
        }),
      );
    }
    expect(received).toHaveLength(2);
    expect(
      received.map(
        (update) => AnyMessages.unpack(entityUpdateId(update), StringValueSchema)?.value,
      ),
    ).toEqual(["match", "match"]);
    observer?.unsubscribe();
    await bus.close();
  });

  it("forwards accepted event targets while redacting client rejection details", async () => {
    const bus = createBus();
    const received: SubscriptionUpdate[] = [];
    const observer = observeSubscription(
      create(SubscriptionSchema, {
        topic: {
          context: { tenantId: { kind: { case: "value", value: "tenant-a" } } },
          target: {
            type: TypeUrls.derive(ProjectionStateSchema),
            criterion: { case: "includeAll", value: true },
          },
        },
      }),
      bus,
      () => undefined,
      (update) => received.push(update),
    );
    const source = create(EventSchema, {
      id: { value: "rejected-event" },
      message: AnyMessages.pack(ProjectionStateSchema, createState("task-1", "Event", 1), {
        validate: false,
      }),
      context: create(EventContextSchema, {
        ...tenantContext("tenant-a"),
        rejection: create(RejectionEventContextSchema, {
          command: {},
          commandMessage: packString("secret command"),
          stacktrace: "secret stack",
        }),
      }),
    });

    await bus.post(
      create(EventSchema, {
        id: { value: "wrong-tenant-event" },
        message: AnyMessages.pack(ProjectionStateSchema, createState("task-1", "Wrong tenant", 1), {
          validate: false,
        }),
        context: tenantContext("tenant-b"),
      }),
    );
    await bus.post(source);

    expect(received).toHaveLength(1);
    const event =
      received[0]?.update.case === "eventUpdates" ? received[0].update.value.event[0] : undefined;
    expect(event?.message).toEqual(source.message);
    expect(event?.context?.rejection?.command).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- client redaction includes the legacy wire field.
    expect(event?.context?.rejection?.commandMessage).toBeUndefined();
    expect(event?.context?.rejection?.stacktrace).toBe("");
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- verifies redaction leaves the source intact.
    expect(source.context?.rejection?.commandMessage).toEqual(packString("secret command"));
    expect(source.context?.rejection?.stacktrace).toBe("secret stack");
    observer?.unsubscribe();
    await bus.close();
  });

  it("accepts matching domain tenants from imported and past origins only", async () => {
    const bus = createBus();
    const received: SubscriptionUpdate[] = [];
    const domain = { kind: { case: "domain" as const, value: { value: "example.test" } } };
    const observer = observeSubscription(
      create(SubscriptionSchema, {
        topic: {
          context: { tenantId: domain },
          target: {
            type: TypeUrls.derive(ProjectionStateSchema),
            criterion: { case: "includeAll", value: true },
          },
        },
      }),
      bus,
      () => undefined,
      (update) => received.push(update),
    );

    await postProjectionEvent(
      bus,
      "domain-import",
      create(EventContextSchema, {
        origin: { case: "importContext", value: { tenantId: domain } },
      }),
    );
    await postProjectionEvent(
      bus,
      "email-import",
      create(EventContextSchema, {
        origin: {
          case: "importContext",
          value: { tenantId: { kind: { case: "email", value: { value: "a@example.test" } } } },
        },
      }),
    );
    await postProjectionEvent(
      bus,
      "domain-past",
      create(EventContextSchema, {
        origin: { case: "pastMessage", value: { actorContext: { tenantId: domain } } },
      }),
    );
    await postProjectionEvent(bus, "default-origin", create(EventContextSchema));

    expect(received).toHaveLength(2);
    observer?.unsubscribe();
    await bus.close();
  });
});

function observeSubscription(
  subscription: Subscription,
  bus: EventBus | undefined,
  findState: (
    typeUrl: string,
  ) => { readonly schema: MessageSchema; readonly idField: string } | undefined,
  onUpdate: (update: SubscriptionUpdate) => void,
) {
  const typeUrl = subscription.topic?.target?.type;
  if (typeUrl === undefined || typeUrl.length === 0) return undefined;
  const state = findState(typeUrl);
  return state === undefined
    ? SubscriptionObservers.observeEvent(subscription, bus, onUpdate)
    : SubscriptionObservers.observeState(subscription, state, bus, onUpdate);
}

function createSystemBus(): EventBus {
  const bus = eventBusAccess.createSystemBus(undefined);
  eventBusAccess.registerSchemas(bus, [
    EntityLog.EntityStateChangedSchema,
    EntityLog.EntityArchivedSchema,
    EntityLog.EntityUnarchivedSchema,
    EntityLog.EntityDeletedSchema,
    EntityLog.EntityRestoredSchema,
  ]);
  return bus;
}

function createBus(schemas: readonly MessageSchema[] = []): EventBus {
  const storage = new InMemoryStorageFactory();
  const bus = new EventBus(new EventStore({ name: "Observer", multitenant: false }, storage));
  eventBusAccess.registerSchemas(bus, [ProjectionStateSchema, ...schemas]);
  return bus;
}

function subscriptionFor(schema: MessageSchema) {
  return create(SubscriptionSchema, {
    topic: {
      target: {
        type: TypeUrls.derive(schema),
        criterion: { case: "includeAll", value: true },
      },
    },
  });
}

function filteredSubscription(schema: MessageSchema, id: ReturnType<typeof AnyMessages.pack>) {
  return create(SubscriptionSchema, {
    topic: {
      target: {
        type: TypeUrls.derive(schema),
        criterion: {
          case: "filters",
          value: { idFilter: { id: [id] } },
        },
      },
    },
  });
}

function createState(id: string, name: string, priority: number): ProjectionState {
  return create(ProjectionStateSchema, { id, name, priority });
}

function packString(value: string) {
  return AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value }));
}

function tenantContext(tenantId: string) {
  return create(EventContextSchema, {
    origin: {
      case: "importContext",
      value: { tenantId: { kind: { case: "value", value: tenantId } } },
    },
  });
}

function entityUpdateId(update: SubscriptionUpdate | undefined) {
  const entity =
    update?.update.case === "entityUpdates" ? update.update.value.update[0] : undefined;
  if (entity?.id === undefined) throw new Error("Expected an entity update ID.");
  return entity.id;
}

async function postProjectionEvent(
  bus: EventBus,
  id: string,
  context: EventContext,
): Promise<void> {
  await bus.post(
    create(EventSchema, {
      id: { value: id },
      message: AnyMessages.pack(ProjectionStateSchema, createState(id, "Event", 1), {
        validate: false,
      }),
      context,
    }),
  );
}

async function postObservedStateChange(
  bus: EventBus,
  schema: MessageSchema,
  state: Message,
  id: ReturnType<typeof AnyMessages.pack>,
): Promise<void> {
  await bus.post(
    create(EventSchema, {
      id: { value: `scalar-state-${String(++eventSequence)}` },
      message: AnyMessages.pack(
        EntityLog.EntityStateChangedSchema,
        create(EntityLog.EntityStateChangedSchema, {
          entity: { id, typeUrl: TypeUrls.derive(schema) },
          newState: AnyMessages.pack(schema, state, { validate: false }),
          signalId: [
            {
              id: packString(`scalar-signal-${String(eventSequence)}`),
              typeUrl: TypeUrls.derive(StringValueSchema),
            },
          ],
        }),
        { validate: false },
      ),
    }),
  );
}

async function postStateChange(
  bus: EventBus,
  state: ProjectionState,
  previousState?: ProjectionState,
  tenantId?: string,
): Promise<void> {
  await bus.post(
    create(EventSchema, {
      id: { value: `state-change-${String(++eventSequence)}` },
      message: AnyMessages.pack(
        EntityLog.EntityStateChangedSchema,
        create(EntityLog.EntityStateChangedSchema, {
          entity: { id: packString(state.id), typeUrl: TypeUrls.derive(ProjectionStateSchema) },
          newState: AnyMessages.pack(ProjectionStateSchema, state, { validate: false }),
          signalId: [
            {
              id: packString(`signal-${String(eventSequence)}`),
              typeUrl: TypeUrls.derive(StringValueSchema),
            },
          ],
          ...(previousState === undefined
            ? {}
            : {
                oldState: AnyMessages.pack(ProjectionStateSchema, previousState, {
                  validate: false,
                }),
              }),
        }),
        { validate: false },
      ),
      ...(tenantId === undefined ? {} : { context: tenantContext(tenantId) }),
    }),
  );
}
