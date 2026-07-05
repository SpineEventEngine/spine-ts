import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
  StringValueSchema,
} from "@bufbuild/protobuf/wkt";
import { deriveTypeUrl, packAny, packCommand, packEvent, unpackAny } from "@spine-ts/core";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  EventContextSchema,
  EventIdSchema,
  UserIdSchema,
  VersionSchema,
  file_spine_options,
} from "@spine-ts/proto";
import {
  TargetFiltersSchema,
  TargetSchema,
} from "@spine-ts/proto/generated/spine/client/filters_pb.js";
import { QueryIdSchema, QuerySchema } from "@spine-ts/proto/generated/spine/client/query_pb.js";
import {
  TopicIdSchema,
  TopicSchema,
} from "@spine-ts/proto/generated/spine/client/subscription_pb.js";
import {
  Aggregate,
  BoundedContext,
  Projection,
  Repository,
  defineEntityHandlers,
} from "@spine-ts/server";
import { describe, expect, it } from "vitest";

import { BoundedContextFixture } from "../src/index.js";
import { serverEntityMetadataTestFixtures } from "../../server/test-fixtures/entity-metadata-fixtures.js";

type ProjectionState = Message<"ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

type AggregateState = Message<"AggregateState"> & {
  id: string;
  name: string;
  archived: boolean;
};

const fileEntityMetadataFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.main.descriptorSetBase64,
);
const ProjectionStateSchema = messageDesc(
  fileEntityMetadataFixture,
  0,
) as GenMessage<ProjectionState>;
const AggregateStateSchema = messageDesc(
  fileEntityMetadataFixture,
  1,
) as GenMessage<AggregateState>;

class TaskAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  assignTask(command: AggregateState) {
    return packEvent({
      id: create(EventIdSchema, { value: `event-${command.id}` }),
      context: create(EventContextSchema),
      schema: ProjectionStateSchema,
      message: createProjectionState(command.id, command.name),
    });
  }

  applyTask(event: ProjectionState): void {
    this.startTransaction();
    this.updateDraftState(() =>
      create(AggregateStateSchema, {
        id: event.id,
        name: event.name,
        archived: false,
      }),
    );
    this.commitTransaction();
  }
}

class TaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  subscribeTask(event: ProjectionState): void {
    this.startTransaction();
    this.updateDraftState(() =>
      create(ProjectionStateSchema, {
        id: event.id,
        name: `${event.name} (projected)`,
        priority: event.priority + 1,
      }),
    );
    this.commitTransaction();
  }
}

describe("BoundedContextFixture", () => {
  it("posts commands through CommandService and eventually reads projected state", async () => {
    const fixture = new BoundedContextFixture(createTaskContext(), {
      timeoutMs: 500,
      intervalMs: 5,
    });

    const ack = await fixture.post(createTaskCommand("command-create", "task-1", "First"));
    const response = await fixture.readEventually(
      createTaskQuery("task-1"),
      (candidate) => candidate.message.length === 1,
    );

    expect(ack.status?.status.case).toBe("ok");
    expect(response.response?.status?.status.case).toBe("ok");
    expect(unpackAny(response.message[0]?.state ?? missingAny(), ProjectionStateSchema)).toEqual(
      createProjectionState("task-1", "First (projected)", 2),
    );
  });

  it("subscribes through SubscriptionService and receives real projection updates", async () => {
    const fixture = new BoundedContextFixture(createTaskContext());
    const subscription = await fixture.subscribe(createTaskTopic());
    const nextUpdate = subscription.next();

    await fixture.post(createTaskCommand("command-subscribe", "task-2", "Second"));

    const update = await nextUpdate;
    const state =
      update?.update.case === "entityUpdates" ? update.update.value.update[0]?.kind : undefined;

    expect(update?.response?.status?.status.case).toBe("ok");
    expect(update?.subscription?.id).toEqual(subscription.subscription.id);
    expect(state?.case).toBe("state");
    expect(
      state?.case === "state" ? unpackAny(state.value, ProjectionStateSchema) : undefined,
    ).toEqual(createProjectionState("task-2", "Second (projected)", 2));

    await subscription.close();
  });

  it("posts events through the bounded context event seam", async () => {
    const fixture = new BoundedContextFixture(createTaskContext());

    await fixture.postEvent(createProjectionEvent("event-direct", "task-3", "Third"));
    const response = await fixture.read(createTaskQuery("task-3"));

    expect(response.response?.status?.status.case).toBe("ok");
    expect(unpackAny(response.message[0]?.state ?? missingAny(), ProjectionStateSchema)).toEqual(
      createProjectionState("task-3", "Third (projected)", 2),
    );
  });

  it("uses the default eventual-read predicate for non-empty OK query responses", async () => {
    const context = createTaskContext();
    const fixture = new BoundedContextFixture(context);

    await fixture.postEvent(createProjectionEvent("event-default", "task-default", "Default"));
    const response = await fixture.readEventually(createTaskQuery("task-default"));

    expect(fixture.context).toBe(context);
    expect(response.response?.status?.status.case).toBe("ok");
    expect(unpackAny(response.message[0]?.state ?? missingAny(), ProjectionStateSchema)).toEqual(
      createProjectionState("task-default", "Default (projected)", 2),
    );
  });

  it("returns the latest query response when eventual reads time out", async () => {
    const fixture = new BoundedContextFixture(createTaskContext(), {
      timeoutMs: 0,
      intervalMs: 0,
    });

    const response = await fixture.readEventually(createTaskQuery("task-missing"));

    expect(response.response?.status?.status.case).toBe("ok");
    expect(response.message).toEqual([]);
  });

  it("cancels subscriptions and makes later reads from the handle inert", async () => {
    const fixture = new BoundedContextFixture(createTaskContext(), {
      inactiveTtlMs: 100,
      queueLimit: 1,
    });
    const subscription = await fixture.subscribe(createTaskTopic());

    const cancel = await subscription.cancel();

    expect(cancel.status?.status.case).toBe("ok");
    await expect(subscription.next()).resolves.toBeUndefined();
    await expect(subscription.close()).resolves.toBeUndefined();
  });

  it("returns cloned query responses so fixture callers cannot mutate stored state", async () => {
    const fixture = new BoundedContextFixture(createTaskContext());

    await fixture.postEvent(createProjectionEvent("event-copy", "task-copy", "Copy"));
    const first = await fixture.read(createTaskQuery("task-copy"));
    const firstState = unpackAny(first.message[0]?.state ?? missingAny(), ProjectionStateSchema);

    if (firstState !== undefined) {
      firstState.name = "mutated outside fixture";
    }

    const second = await fixture.read(createTaskQuery("task-copy"));

    expect(unpackAny(second.message[0]?.state ?? missingAny(), ProjectionStateSchema)).toEqual(
      createProjectionState("task-copy", "Copy (projected)", 2),
    );
  });
});

function createTaskContext() {
  return BoundedContext.singleTenant("Tasks")
    .add(createTaskAggregateRepository())
    .add(createTaskProjectionRepository())
    .build();
}

function createTaskAggregateRepository(): Repository<typeof TaskAggregate> {
  const handlers = defineEntityHandlers(TaskAggregate, AggregateStateSchema, (builder) => [
    builder.assign(AggregateStateSchema, "assignTask"),
    builder.apply(ProjectionStateSchema, "applyTask"),
  ]);

  return new Repository({
    entityType: TaskAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createTaskProjectionRepository(): Repository<typeof TaskProjection> {
  const handlers = defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
    builder.subscribe(ProjectionStateSchema, "subscribeTask"),
  ]);

  return new Repository({
    entityType: TaskProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createTaskCommand(commandId: string, taskId: string, name: string) {
  return packCommand({
    id: create(CommandIdSchema, { uuid: commandId }),
    context: create(CommandContextSchema, {
      actorContext: createActorContext(),
    }),
    schema: AggregateStateSchema,
    message: create(AggregateStateSchema, {
      id: taskId,
      name,
      archived: false,
    }),
  });
}

function createProjectionEvent(eventId: string, taskId: string, name: string) {
  return packEvent({
    id: create(EventIdSchema, { value: eventId }),
    context: create(EventContextSchema, {
      version: create(VersionSchema, { number: 1 }),
    }),
    schema: ProjectionStateSchema,
    message: createProjectionState(taskId, name),
  });
}

function createTaskQuery(taskId: string) {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: `q-${taskId}` }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(ProjectionStateSchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, {
          idFilter: {
            id: [packAny(StringValueSchema, create(StringValueSchema, { value: taskId }))],
          },
        }),
      },
    }),
    context: createActorContext(),
  });
}

function createTaskTopic() {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: "topic-tasks" }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(ProjectionStateSchema),
      criterion: {
        case: "includeAll",
        value: true,
      },
    }),
    context: createActorContext(),
  });
}

function createActorContext() {
  return create(ActorContextSchema, {
    actor: create(UserIdSchema, { value: "user-1" }),
  });
}

function createProjectionState(id: string, name: string, priority = 1): ProjectionState {
  return create(ProjectionStateSchema, {
    id,
    name,
    priority,
  });
}

function createFixtureFileDescriptor(descriptorSetBase64: string, imports = [file_spine_options]) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Testing fixture descriptor set is empty.");
  }

  return fileDesc(
    Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"),
    imports,
  );
}

function missingAny() {
  return packAny(StringValueSchema, create(StringValueSchema, { value: "missing" }));
}
