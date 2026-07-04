import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { connectNodeAdapter, createGrpcTransport } from "@connectrpc/connect-node";
import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  EmptySchema,
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
  StringValueSchema,
} from "@bufbuild/protobuf/wkt";
import { deriveTypeUrl, packAny, packCommand, unpackAny } from "@spine-ts/core";
import {
  ActorContextSchema,
  CommandSchema,
  CommandContextSchema,
  CommandIdSchema,
  TenantIdSchema,
  UserIdSchema,
  VersionSchema,
  file_spine_options,
} from "@spine-ts/proto";
import { CommandService } from "@spine-ts/proto/generated/spine/client/command_service_pb.js";
import {
  TargetFiltersSchema,
  TargetSchema,
} from "@spine-ts/proto/generated/spine/client/filters_pb.js";
import { QueryIdSchema, QuerySchema } from "@spine-ts/proto/generated/spine/client/query_pb.js";
import { QueryService } from "@spine-ts/proto/generated/spine/client/query_service_pb.js";
import { SubscriptionService } from "@spine-ts/proto/generated/spine/client/subscription_service_pb.js";
import {
  type Subscription,
  type SubscriptionUpdate,
  type Topic,
  SubscriptionIdSchema,
  SubscriptionSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-ts/proto/generated/spine/client/subscription_pb.js";
import { describe, expect, it } from "vitest";

import {
  BoundedContext,
  Projection,
  Repository,
  SpineServices,
  type CommandDispatcher,
} from "../../src/index.js";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

type ProjectionState = Message<"ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

function createFixtureFileDescriptor(descriptorSetBase64: string, imports = [file_spine_options]) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Spine services fixture descriptor set is empty.");
  }

  return fileDesc(
    Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"),
    imports,
  );
}

const fileEntityMetadataFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.main.descriptorSetBase64,
);
const ProjectionStateSchema = messageDesc(
  fileEntityMetadataFixture,
  0,
) as GenMessage<ProjectionState>;

class TaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {}

describe("SpineServices", () => {
  it("posts commands through CommandService over a real gRPC transport", async () => {
    const observed: string[] = [];
    const dispatcher = createCommandDispatcher((command) => {
      observed.push(command.id?.uuid ?? "missing");
    });
    const context = BoundedContext.singleTenant("Tasks").addCommandDispatcher(dispatcher).build();
    const server = await startServices(context);

    try {
      const client = createClient(CommandService, createGrpcTransport({ baseUrl: server.baseUrl }));

      const ack = await client.post(createProjectionCommand("command-1"));

      expect(ack.status?.status.case).toBe("ok");
      expect(ack.status?.status.value).toEqual(create(EmptySchema));
      expect(ack.messageId?.typeUrl).toBe(deriveTypeUrl(CommandIdSchema));
      expect(observed).toEqual(["command-1"]);
    } finally {
      await server.close();
    }
  });

  it("reads Stand state through QueryService over a real gRPC transport", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();
    await context.stand().update(ProjectionStateSchema, createState("task-1", "First"), {
      version: create(VersionSchema, { number: 7 }),
    });
    const server = await startServices(context);

    try {
      const client = createClient(QueryService, createGrpcTransport({ baseUrl: server.baseUrl }));

      const response = await client.read(createQuery("task-1"));

      expect(response.response?.status?.status.case).toBe("ok");
      expect(response.message).toHaveLength(1);
      expect(unpackAny(response.message[0]?.state ?? packMissing(), ProjectionStateSchema)).toEqual(
        createState("task-1", "First"),
      );
      expect(response.message[0]?.version).toEqual(create(VersionSchema, { number: 7 }));
    } finally {
      await server.close();
    }
  });

  it("keeps QueryService reads isolated by tenant", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.multitenant("Tasks").add(repository).build();
    await context.stand().update(ProjectionStateSchema, createState("task-1", "Tenant A"), {
      tenantId: "tenant-a",
    });
    await context.stand().update(ProjectionStateSchema, createState("task-1", "Tenant B"), {
      tenantId: "tenant-b",
    });
    const server = await startServices(context);

    try {
      const client = createClient(QueryService, createGrpcTransport({ baseUrl: server.baseUrl }));

      const response = await client.read(createQuery("task-1", "tenant-b"));

      expect(response.response?.status?.status.case).toBe("ok");
      expect(response.message).toHaveLength(1);
      expect(unpackAny(response.message[0]?.state ?? packMissing(), ProjectionStateSchema)).toEqual(
        createState("task-1", "Tenant B"),
      );
    } finally {
      await server.close();
    }
  });

  it("returns Spine error statuses for unsupported command and query targets", async () => {
    const context = BoundedContext.singleTenant("Tasks").build();
    const server = await startServices(context);

    try {
      const transport = createGrpcTransport({ baseUrl: server.baseUrl });
      const commandClient = createClient(CommandService, transport);
      const queryClient = createClient(QueryService, transport);

      const ack = await commandClient.post(createProjectionCommand("command-unsupported"));
      const response = await queryClient.read(createQuery("task-1"));

      expect(ack.status?.status.case).toBe("error");
      expect(response.response?.status?.status.case).toBe("error");
    } finally {
      await server.close();
    }
  });

  it("returns error statuses for dispatcher failures and invalid query criteria", async () => {
    const dispatcher = createFailingCommandDispatcher();
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .addCommandDispatcher(dispatcher)
      .build();
    const server = await startServices(context);

    try {
      const transport = createGrpcTransport({ baseUrl: server.baseUrl });
      const commandClient = createClient(CommandService, transport);
      const queryClient = createClient(QueryService, transport);

      const ack = await commandClient.post(createProjectionCommand("command-fails"));
      const response = await queryClient.read(createQueryWithoutIds());

      expect(ack.status?.status.case).toBe("error");
      expect(errorMessage(ack.status?.status)).toBe("Command post failed.");
      expect(response.response?.status?.status.case).toBe("error");
    } finally {
      await server.close();
    }
  });

  it("returns Spine statuses for empty contexts and malformed read criteria", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();
    const server = await startServices(context);
    const emptyServer = await startServices();

    try {
      const transport = createGrpcTransport({ baseUrl: server.baseUrl });
      const commandClient = createClient(
        CommandService,
        createGrpcTransport({ baseUrl: emptyServer.baseUrl }),
      );
      const queryClient = createClient(QueryService, transport);

      const ack = await commandClient.post(createCommandWithoutId());
      const noTarget = await queryClient.read(
        create(QuerySchema, {
          id: create(QueryIdSchema, { value: "q-no-target" }),
          context: createActorContext(),
        }),
      );
      const objectId = await queryClient.read(
        createQueryWithIds([packAny(CommandIdSchema, create(CommandIdSchema, { uuid: "task-1" }))]),
      );
      const emptyFilter = await queryClient.read(
        create(QuerySchema, {
          id: create(QueryIdSchema, { value: "q-empty-filter" }),
          target: create(TargetSchema, {
            type: deriveTypeUrl(ProjectionStateSchema),
            criterion: {
              case: "filters",
              value: create(TargetFiltersSchema),
            },
          }),
          context: createActorContext(),
        }),
      );

      expect(ack.messageId).toBeUndefined();
      expect(ack.status?.status.case).toBe("error");
      expect(errorMessage(ack.status?.status)).toBe("No bounded context accepted the command.");
      expect(noTarget.response?.status?.status.case).toBe("error");
      expect(objectId.response?.status?.status.case).toBe("ok");
      expect(objectId.message).toHaveLength(0);
      expect(emptyFilter.response?.status?.status.case).toBe("error");
    } finally {
      await emptyServer.close();
      await server.close();
    }
  });

  it("returns stable errors for invalid command envelopes and read failures", async () => {
    const readFailureContext = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      readVersioned: () => Promise.reject(new Error("storage details")),
    });
    const server = await startServices(readFailureContext);

    try {
      const transport = createGrpcTransport({ baseUrl: server.baseUrl });
      const commandClient = createClient(CommandService, transport);
      const queryClient = createClient(QueryService, transport);

      const ack = await commandClient.post(create(CommandSchema));
      const response = await queryClient.read(createQuery("task-1"));

      expect(ack.status?.status.case).toBe("error");
      expect(errorMessage(ack.status?.status)).toBe("Command message type is required.");
      expect(response.response?.status?.status.case).toBe("error");
      expect(responseErrorMessage(response)).toBe("Query read failed.");
    } finally {
      await server.close();
    }
  });

  it("wraps non-Error dispatcher failures in sanitized Spine command errors", async () => {
    const dispatcher: CommandDispatcher = {
      messageSchemas: () => [ProjectionStateSchema],
      // Deliberately covers defensive wrapping of third-party non-Error rejections.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      dispatch: () => Promise.reject("dispatcher-string"),
    };
    const context = BoundedContext.singleTenant("Tasks").addCommandDispatcher(dispatcher).build();
    const server = await startServices(context);

    try {
      const client = createClient(CommandService, createGrpcTransport({ baseUrl: server.baseUrl }));

      const ack = await client.post(createProjectionCommand("command-string-failure"));

      expect(ack.status?.status.case).toBe("error");
      expect(errorMessage(ack.status?.status)).toBe("Command post failed.");
    } finally {
      await server.close();
    }
  });

  it("rejects command tenant mismatches without dispatching", async () => {
    const singleTenantDispatches: string[] = [];
    const multitenantDispatches: string[] = [];
    const singleTenant = BoundedContext.singleTenant("Single")
      .addCommandDispatcher(
        createCommandDispatcher((command) => singleTenantDispatches.push(command.id?.uuid ?? "")),
      )
      .build();
    const multitenant = BoundedContext.multitenant("Multi")
      .addCommandDispatcher(
        createCommandDispatcher((command) => multitenantDispatches.push(command.id?.uuid ?? "")),
      )
      .build();
    const singleServer = await startServices(singleTenant);
    const multiServer = await startServices(multitenant);

    try {
      const singleClient = createClient(
        CommandService,
        createGrpcTransport({ baseUrl: singleServer.baseUrl }),
      );
      const multiClient = createClient(
        CommandService,
        createGrpcTransport({ baseUrl: multiServer.baseUrl }),
      );

      const singleTenantAck = await singleClient.post(
        createProjectionCommand("single-with-tenant", "tenant-a"),
      );
      const multitenantAck = await multiClient.post(
        createProjectionCommand("multi-without-tenant"),
      );

      expect(singleTenantAck.status?.status.case).toBe("error");
      expect(errorMessage(singleTenantAck.status?.status)).toBe(
        "Tenant is not applicable for this command.",
      );
      expect(multitenantAck.status?.status.case).toBe("error");
      expect(errorMessage(multitenantAck.status?.status)).toBe(
        "Tenant is required for this command.",
      );
      expect(singleTenantDispatches).toEqual([]);
      expect(multitenantDispatches).toEqual([]);
    } finally {
      await multiServer.close();
      await singleServer.close();
    }
  });

  it("routes commands by registered type without posting to wrong contexts", async () => {
    const wrongPosts: string[] = [];
    const acceptedPosts: string[] = [];
    const wrongContext = createFakeContext({
      commandTypes: [deriveTypeUrl(StringValueSchema)],
      post: (command) => {
        wrongPosts.push(command.id?.uuid ?? "");
        return Promise.reject(new Error("wrong context touched"));
      },
    });
    const acceptedContext = createFakeContext({
      commandTypes: [deriveTypeUrl(ProjectionStateSchema)],
      post: (command) => {
        acceptedPosts.push(command.id?.uuid ?? "");
        return Promise.resolve();
      },
    });
    const server = await startServices(wrongContext, acceptedContext);

    try {
      const client = createClient(CommandService, createGrpcTransport({ baseUrl: server.baseUrl }));

      const ack = await client.post(createProjectionCommand("command-routed"));

      expect(ack.status?.status.case).toBe("ok");
      expect(wrongPosts).toEqual([]);
      expect(acceptedPosts).toEqual(["command-routed"]);
    } finally {
      await server.close();
    }
  });

  it("uses the first registered command route for duplicate service routes", async () => {
    const firstPosts: string[] = [];
    const secondPosts: string[] = [];
    const firstContext = createFakeContext({
      commandTypes: [deriveTypeUrl(ProjectionStateSchema)],
      post: (command) => {
        firstPosts.push(command.id?.uuid ?? "");
        return Promise.resolve();
      },
    });
    const secondContext = createFakeContext({
      commandTypes: [deriveTypeUrl(ProjectionStateSchema)],
      post: (command) => {
        secondPosts.push(command.id?.uuid ?? "");
        return Promise.resolve();
      },
    });
    const server = await startServices(firstContext, secondContext);

    try {
      const client = createClient(CommandService, createGrpcTransport({ baseUrl: server.baseUrl }));

      const ack = await client.post(createProjectionCommand("command-first-route"));

      expect(ack.status?.status.case).toBe("ok");
      expect(firstPosts).toEqual(["command-first-route"]);
      expect(secondPosts).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("rejects subscription tenant mismatches contractually", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const singleTenant = BoundedContext.singleTenant("SingleSubscription").add(repository).build();
    const secondRepository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const multitenant = BoundedContext.multitenant("MultiSubscription")
      .add(secondRepository)
      .build();
    const singleServer = await startServices(singleTenant);
    const multiServer = await startServices(multitenant);

    try {
      const singleClient = createClient(
        SubscriptionService,
        createGrpcTransport({ baseUrl: singleServer.baseUrl }),
      );
      const multiClient = createClient(
        SubscriptionService,
        createGrpcTransport({ baseUrl: multiServer.baseUrl }),
      );

      await expect(singleClient.subscribe(createTopic("tenant-a"))).rejects.toMatchObject({
        code: Code.InvalidArgument,
      } satisfies Partial<ConnectError>);
      await expect(multiClient.subscribe(createTopic())).rejects.toMatchObject({
        code: Code.InvalidArgument,
      } satisfies Partial<ConnectError>);
    } finally {
      await multiServer.close();
      await singleServer.close();
    }
  });

  it("returns QueryResponse errors for query tenant mismatches", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const singleTenant = BoundedContext.singleTenant("Single").add(repository).build();
    const secondRepository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const multitenant = BoundedContext.multitenant("Multi").add(secondRepository).build();
    const singleServer = await startServices(singleTenant);
    const multiServer = await startServices(multitenant);

    try {
      const singleClient = createClient(
        QueryService,
        createGrpcTransport({ baseUrl: singleServer.baseUrl }),
      );
      const multiClient = createClient(
        QueryService,
        createGrpcTransport({ baseUrl: multiServer.baseUrl }),
      );

      const inapplicable = await singleClient.read(createQuery("task-1", "tenant-a"));
      const missing = await multiClient.read(createQuery("task-1"));

      expect(inapplicable.response?.status?.status.case).toBe("error");
      expect(responseErrorMessage(inapplicable)).toBe("Tenant is not applicable for this query.");
      expect(missing.response?.status?.status.case).toBe("error");
      expect(responseErrorMessage(missing)).toBe("Tenant is required for this query.");
    } finally {
      await multiServer.close();
      await singleServer.close();
    }
  });

  it("activates and cancels explicit subscriptions over a real gRPC transport", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();
    const server = await startServices(context);

    try {
      const client = createClient(
        SubscriptionService,
        createGrpcTransport({ baseUrl: server.baseUrl }),
      );
      const subscription = await client.subscribe(createTopic());
      const updates = client.activate(subscription);
      const iterator = updates[Symbol.asyncIterator]();
      const nextUpdate = withTimeout(iterator.next(), "subscription update");

      await delay(25);
      await context.stand().update(ProjectionStateSchema, createState("task-1", "First"));

      const delivered = await nextUpdate;
      const update = delivered.value as SubscriptionUpdate | undefined;

      expect(subscription.id?.value).toMatch(/^s-/u);
      expect(subscription.topic?.target?.type).toBe(deriveTypeUrl(ProjectionStateSchema));
      expect(delivered.done).toBe(false);
      expect(update?.response?.status?.status.case).toBe("ok");
      expect(update?.subscription?.id).toEqual(subscription.id);
      if (update?.update.case !== "entityUpdates") {
        throw new Error("Expected entity subscription update.");
      }
      const state = update.update.value.update[0]?.kind;
      if (state?.case !== "state") {
        throw new Error("Expected entity state update.");
      }
      expect(unpackAny(state.value, ProjectionStateSchema)).toEqual(createState("task-1", "First"));

      const cancel = await withTimeout(client.cancel(subscription), "subscription cancellation");
      await context.stand().update(ProjectionStateSchema, createState("task-1", "Second"));

      expect(cancel.status?.status.case).toBe("ok");
    } finally {
      await server.close();
    }
  });

  it("does not deliver pre-activation updates and tolerates unknown subscription cancellation", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();
    const server = await startServices(context);

    try {
      const client = createClient(
        SubscriptionService,
        createGrpcTransport({ baseUrl: server.baseUrl }),
      );
      const subscription = await client.subscribe(createTopic());
      await context.stand().update(ProjectionStateSchema, createState("task-queued", "Queued"));

      const iterator = client.activate(subscription)[Symbol.asyncIterator]();
      const nextUpdate = withTimeout(iterator.next(), "post-activation subscription update");
      await delay(25);
      await context.stand().update(ProjectionStateSchema, createState("task-live", "Live"));
      const delivered = await nextUpdate;
      const update = delivered.value as SubscriptionUpdate | undefined;
      const unknown = create(SubscriptionSchema, {
        id: create(SubscriptionIdSchema, { value: "s-missing" }),
        topic: createTopic(),
      });
      const unknownIterator = client.activate(unknown)[Symbol.asyncIterator]();
      const unknownNext = await withTimeout(unknownIterator.next(), "unknown subscription close");
      const cancel = await client.cancel(unknown);
      const missingIdCancel = await client.cancel(create(SubscriptionSchema));

      expect(delivered.done).toBe(false);
      if (update?.update.case !== "entityUpdates") {
        throw new Error("Expected entity subscription update.");
      }
      const state = update.update.value.update[0]?.kind;
      if (state?.case !== "state") {
        throw new Error("Expected entity state update.");
      }
      expect(unpackAny(state.value, ProjectionStateSchema)).toEqual(
        createState("task-live", "Live"),
      );
      expect(unknownNext.done).toBe(true);
      expect(cancel.status?.status.case).toBe("ok");
      expect(missingIdCancel.status?.status.case).toBe("ok");
      await client.cancel(subscription);
    } finally {
      await server.close();
    }
  });

  it("releases subscription delivery when the activation iterator closes", async () => {
    const activeStandSubscriptions: string[] = [];
    let deliverUpdate:
      | ((update: {
          readonly typeUrl: string;
          readonly id: unknown;
          readonly state: ProjectionState;
        }) => void)
      | undefined;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: (_schema, callback) => {
        activeStandSubscriptions.push("open");
        deliverUpdate = callback;
        return {
          get closed() {
            return activeStandSubscriptions.length === 0;
          },
          unsubscribe: () => {
            activeStandSubscriptions.pop();
          },
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const subscription = await handlers.subscribe(createTopic());

    expect(activeStandSubscriptions).toEqual([]);

    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const pending = iterator.next();

    await delay(25);
    expect(activeStandSubscriptions).toEqual(["open"]);
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "task-close",
      state: createState("task-close", "Close"),
    });
    await withTimeout(pending, "first subscription update");
    await iterator.return?.();

    expect(activeStandSubscriptions).toEqual([]);
  });

  it("delivers post-activation queued updates and omits non-string update IDs", async () => {
    let deliverUpdate:
      | ((update: {
          readonly typeUrl: string;
          readonly id: unknown;
          readonly state: ProjectionState;
        }) => void)
      | undefined;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: (_schema, callback) => {
        deliverUpdate = callback;
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const subscription = await handlers.subscribe(createTopic());
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const first = iterator.next();

    await delay(25);
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "task-first",
      state: createState("task-first", "First"),
    });
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: { value: "task-object" },
      state: createState("task-object", "Object"),
    });

    const firstUpdate = await withTimeout(first, "first direct subscription update");
    const secondUpdate = await withTimeout(iterator.next(), "queued direct subscription update");
    const secondValue = secondUpdate.value as SubscriptionUpdate | undefined;

    expect(firstUpdate.done).toBe(false);
    expect(secondUpdate.done).toBe(false);
    if (secondValue?.update.case !== "entityUpdates") {
      throw new Error("Expected entity subscription update.");
    }
    expect(secondValue.update.value.update[0]?.id).toBeUndefined();
    await iterator.return?.();
  });

  it("fails unsupported subscription topics contractually", async () => {
    const context = BoundedContext.singleTenant("Tasks").build();
    const server = await startServices(context);

    try {
      const client = createClient(
        SubscriptionService,
        createGrpcTransport({ baseUrl: server.baseUrl }),
      );

      await expect(client.subscribe(create(TopicSchema))).rejects.toMatchObject({
        code: Code.InvalidArgument,
      } satisfies Partial<ConnectError>);
    } finally {
      await server.close();
    }
  });
});

function createCommandDispatcher(
  onDispatch: (command: ReturnType<typeof createProjectionCommand>) => void,
): CommandDispatcher {
  return {
    messageSchemas: () => [ProjectionStateSchema],
    dispatch: (command) => {
      onDispatch(command);
      return Promise.resolve();
    },
  };
}

function createFailingCommandDispatcher(): CommandDispatcher {
  return {
    messageSchemas: () => [ProjectionStateSchema],
    dispatch: () => Promise.reject(new Error("Dispatcher failed.")),
  };
}

function createProjectionCommand(id: string, tenantId?: string) {
  return packCommand({
    id: create(CommandIdSchema, { uuid: id }),
    context: create(CommandContextSchema, {
      actorContext: createActorContext(tenantId),
    }),
    schema: ProjectionStateSchema,
    message: createState("task-1", "Task"),
  });
}

function createCommandWithoutId() {
  return create(CommandSchema, {
    message: packAny(ProjectionStateSchema, createState("task-1", "Task")),
    context: create(CommandContextSchema, {
      actorContext: createActorContext(),
    }),
  });
}

function createQuery(id: string, tenantId?: string) {
  return createQueryWithIds([packStringId(id)], tenantId);
}

function createQueryWithIds(ids: ReturnType<typeof packAny>[], tenantId?: string) {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: "q-1" }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(ProjectionStateSchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, {
          idFilter: { id: ids },
        }),
      },
    }),
    context: createActorContext(tenantId),
  });
}

function createQueryWithoutIds() {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: "q-empty" }),
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

function createTopic(tenantId?: string) {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: "t-1" }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(ProjectionStateSchema),
      criterion: {
        case: "includeAll",
        value: true,
      },
    }),
    context: createActorContext(tenantId),
  });
}

function createActorContext(tenantId?: string) {
  return create(ActorContextSchema, {
    ...(tenantId === undefined
      ? {}
      : {
          tenantId: create(TenantIdSchema, {
            kind: {
              case: "value",
              value: tenantId,
            },
          }),
        }),
    actor: create(UserIdSchema, { value: "user-1" }),
  });
}

function createState(id: string, name: string): ProjectionState {
  return create(ProjectionStateSchema, {
    id,
    name,
    priority: 1,
  });
}

function packStringId(id: string) {
  return packAny(StringValueSchema, create(StringValueSchema, { value: id }));
}

function packMissing() {
  return packAny(StringValueSchema, create(StringValueSchema, { value: "missing" }));
}

function errorMessage(status: unknown) {
  if (
    typeof status !== "object" ||
    status === null ||
    !("case" in status) ||
    status.case !== "error"
  ) {
    return undefined;
  }
  const value = "value" in status ? status.value : undefined;

  return typeof value === "object" && value !== null && "message" in value
    ? value.message
    : undefined;
}

function responseErrorMessage(response: unknown) {
  if (typeof response !== "object" || response === null || !("response" in response)) {
    return undefined;
  }
  const responseStatus = response.response;
  if (
    typeof responseStatus !== "object" ||
    responseStatus === null ||
    !("status" in responseStatus)
  ) {
    return undefined;
  }
  const status = responseStatus.status;
  if (typeof status !== "object" || status === null || !("status" in status)) {
    return undefined;
  }

  return errorMessage(status.status);
}

function createFakeContext(options: {
  readonly commandTypes?: readonly string[];
  readonly stateTypes?: readonly string[];
  readonly post?: (command: ReturnType<typeof createProjectionCommand>) => Promise<void>;
  readonly readVersioned?: () => Promise<undefined>;
  readonly subscribe?: (
    schema: typeof ProjectionStateSchema,
    callback: (update: {
      readonly typeUrl: string;
      readonly id: unknown;
      readonly state: ProjectionState;
    }) => void,
  ) => { readonly closed: boolean; unsubscribe(): void };
}) {
  const commandTypes = options.commandTypes ?? [];
  const stateTypes = options.stateTypes ?? [];

  return {
    isMultitenant: false,
    commandBus: () =>
      Object.freeze({
        acceptedCommandTypes: () => commandTypes,
        post: options.post ?? (() => Promise.resolve()),
      }),
    registeredRepositories: () =>
      stateTypes.map((typeUrl) =>
        Object.freeze({
          stateSchema: ProjectionStateSchema,
          typeUrl,
        }),
      ),
    stand: () =>
      Object.freeze({
        subscribe: options.subscribe ?? (() => ({ closed: false, unsubscribe: () => undefined })),
        readVersioned: options.readVersioned ?? (() => Promise.resolve(undefined)),
      }),
  } as unknown as BoundedContext;
}

function registeredSubscriptionHandlers(context: BoundedContext) {
  let handlers:
    | {
        subscribe(topic: Topic): Subscription | Promise<Subscription>;
        activate(subscription: Subscription): AsyncIterable<SubscriptionUpdate>;
      }
    | undefined;
  const services = new SpineServices({ contexts: [context] });

  services.register({
    service(schema: unknown, implementation: unknown) {
      if (schema === SubscriptionService) {
        handlers = implementation as typeof handlers;
      }
      return this;
    },
  } as never);

  if (handlers === undefined) {
    throw new Error("SubscriptionService handlers were not registered.");
  }

  return handlers;
}

async function startServices(...contexts: BoundedContext[]) {
  const services = new SpineServices({ contexts });
  const sessions = new Set<http2.ServerHttp2Session>();
  const server = http2.createServer(
    connectNodeAdapter({
      routes: (router) => {
        services.register(router);
      },
    }),
  );
  server.on("session", (session) => {
    sessions.add(session);
    session.on("close", () => sessions.delete(session));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port.toString()}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const session of sessions) {
          session.destroy();
        }
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
  };
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${label}.`));
    }, 1_000);
  });

  try {
    return await Promise.race([promise, timer]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
