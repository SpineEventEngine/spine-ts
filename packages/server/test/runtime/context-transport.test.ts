import { create, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { packCommand, packEvent } from "@spine-ts/core";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  CommandSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  file_spine_options,
  UserIdSchema,
  VersionSchema,
} from "@spine-ts/proto";
import type {
  PublishTransportHandler,
  PublishTransportOperation,
  RequestTransportHandler,
  RequestTransportOperation,
  SignalTransport,
  TransportSignalKind,
  TransportSubscription,
  TransportSubscriptionHandle,
} from "@spine-ts/transport";
import { describe, expect, it } from "vitest";

import {
  BoundedContext,
  type CommandDispatcher,
  type EventDispatcher,
  RuntimeTransportEnvelopeError,
} from "../../src/index.js";
import { ContextTransport } from "../../src/runtime/context-transport.js";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

type ProjectionState = Message<"ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

const fixtureFile = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.main.descriptorSetBase64,
);
const ProjectionStateSchema = messageDesc(fixtureFile, 0) as GenMessage<ProjectionState>;

describe("ContextTransport", () => {
  it("posts an accepted command once to its owning bounded context", async () => {
    const observed: string[] = [];
    const context = BoundedContext.singleTenant("TransportTasks")
      .addCommandDispatcher(
        commandDispatcher((command) => {
          observed.push(command.id?.uuid ?? "missing");
        }),
      )
      .build();
    const transport = new RecordingSignalTransport();

    const handle = await ContextTransport.open({ context, transport });
    const command = packCommand({
      id: create(CommandIdSchema, { uuid: "transport-command" }),
      context: create(CommandContextSchema, {
        actorContext: create(ActorContextSchema, {
          actor: create(UserIdSchema, { value: "user-1" }),
        }),
      }),
      schema: ProjectionStateSchema,
      message: create(ProjectionStateSchema, { id: "task-1" }),
    });

    const result = await transport.request<typeof command, unknown>({
      topic: requireFirst(transport.responders()).topic,
      envelope: command,
    });

    expect(result).toMatchObject({ status: "accepted", signalKind: "command" });
    await handle.close();

    expect(observed).toEqual(["transport-command"]);
    await context.close();
  });

  it("posts an accepted event once before the bounded context fans out to matching dispatchers", async () => {
    const observed: string[] = [];
    const context = BoundedContext.singleTenant("TransportEvents")
      .addEventDispatcher(eventDispatcher("first", observed))
      .addEventDispatcher(eventDispatcher("second", observed))
      .build();
    const transport = new RecordingSignalTransport();
    const handle = await ContextTransport.open({ context, transport });

    await transport.publish({
      topic: requireFirst(transport.subscribers()).topic,
      envelope: createTransportEvent("transport-event"),
    });

    await handle.close();

    expect(observed).toEqual(["first:transport-event", "second:transport-event"]);
    await context.close();
  });

  it("delivers one event once to each same-type context through distinct subscriptions", async () => {
    const firstObserved: string[] = [];
    const secondObserved: string[] = [];
    const firstContext = BoundedContext.singleTenant("Events / 東京 🚀")
      .addEventDispatcher(eventDispatcher("first", firstObserved))
      .build();
    const secondContext = BoundedContext.singleTenant("Events_/_東京-🚀")
      .addEventDispatcher(eventDispatcher("second", secondObserved))
      .build();
    const transport = new RecordingSignalTransport();
    const firstHandle = await ContextTransport.open({ context: firstContext, transport });
    const secondHandle = await ContextTransport.open({ context: secondContext, transport });

    await transport.publish({
      topic: requireFirst(transport.subscribers()).topic,
      envelope: createTransportEvent("shared-event"),
    });
    await Promise.all([firstHandle.close(), secondHandle.close()]);

    const descriptorKeys = transport.subscribers().map(({ descriptorKey }) => descriptorKey);
    expect(new Set(descriptorKeys).size).toBe(2);
    expect(firstObserved).toEqual(["first:shared-event"]);
    expect(secondObserved).toEqual(["second:shared-event"]);
    await firstContext.close();
    await secondContext.close();
  });

  it("refuses malformed command envelopes before they reach the bounded context bus", async () => {
    const observed: string[] = [];
    const context = BoundedContext.singleTenant("TransportRefusal")
      .addCommandDispatcher(
        commandDispatcher((command) => {
          observed.push(command.id?.uuid ?? "missing");
        }),
      )
      .build();
    const transport = new RecordingSignalTransport();
    const handle = await ContextTransport.open({ context, transport });

    const result = await transport.request({
      topic: requireFirst(transport.responders()).topic,
      envelope: create(CommandSchema, {
        message: create(AnySchema, { typeUrl: "type.example.test/not-the-accepted-type" }),
      }),
    });

    expect(result).toMatchObject({ status: "failed", signalKind: "command" });
    expect(observed).toEqual([]);
    await handle.close();
    await context.close();
  });

  it("refuses malformed and type-URL-invalid event envelopes before the context bus", async () => {
    const observed: string[] = [];
    const context = BoundedContext.singleTenant("EventRefusal")
      .addEventDispatcher(eventDispatcher("event", observed))
      .build();
    const transport = new RecordingSignalTransport();
    const handle = await ContextTransport.open({ context, transport });
    const topic = requireFirst(transport.subscribers()).topic;

    await expect(
      transport.publish({
        topic,
        envelope: create(EventSchema),
      }),
    ).rejects.toBeInstanceOf(RuntimeTransportEnvelopeError);
    await expect(
      transport.publish({
        topic,
        envelope: create(EventSchema, {
          message: create(AnySchema, { typeUrl: "type.example.test/not-the-accepted-type" }),
        }),
      }),
    ).rejects.toBeInstanceOf(RuntimeTransportEnvelopeError);
    await handle.close();

    expect(observed).toEqual([]);
    await context.close();
  });

  it("opens no registrations for a context without accepted command or event types", async () => {
    const context = BoundedContext.singleTenant("EmptyTransport").build();
    const transport = new RecordingSignalTransport();

    const handle = await ContextTransport.open({ context, transport });

    expect(transport.responders()).toEqual([]);
    expect(transport.subscribers()).toEqual([]);
    await handle.close();
    expect(transport.closeCalls).toBe(0);
    await context.close();
  });

  it("drains accepted context work without closing its supplied transport", async () => {
    const dispatch = deferred();
    const context = BoundedContext.singleTenant("ClosingTransport")
      .addCommandDispatcher(commandDispatcher(() => dispatch.promise))
      .build();
    const transport = new RecordingSignalTransport();
    const handle = await ContextTransport.open({ context, transport });
    const result = await transport.request({
      topic: requireFirst(transport.responders()).topic,
      envelope: createTransportCommand("closing-command"),
    });

    expect(result).toMatchObject({ status: "accepted", signalKind: "command" });
    let closed = false;
    const close = handle.close().then(() => {
      closed = true;
    });

    await Promise.resolve();
    expect(closed).toBe(false);
    dispatch.resolve();
    await close;
    expect(transport.closeCalls).toBe(0);
    await context.close();
  });
});

function commandDispatcher(
  onDispatch: (command: ReturnType<typeof packCommand>) => void | Promise<void>,
): CommandDispatcher {
  return {
    messageSchemas: () => [ProjectionStateSchema],
    dispatch: (command) => Promise.resolve(onDispatch(command)),
  };
}

function createTransportCommand(id: string) {
  return packCommand({
    id: create(CommandIdSchema, { uuid: id }),
    context: create(CommandContextSchema, {
      actorContext: create(ActorContextSchema, {
        actor: create(UserIdSchema, { value: "user-1" }),
      }),
    }),
    schema: ProjectionStateSchema,
    message: create(ProjectionStateSchema, { id: "task-1" }),
  });
}

function createTransportEvent(id: string) {
  return packEvent({
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      version: create(VersionSchema, { number: 1 }),
    }),
    schema: ProjectionStateSchema,
    message: create(ProjectionStateSchema, { id: "task-1" }),
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}

function eventDispatcher(name: string, observed: string[]): EventDispatcher {
  return {
    messageSchemas: () => [ProjectionStateSchema],
    dispatch: (event) => {
      observed.push(`${name}:${event.id?.value ?? "missing"}`);
      return Promise.resolve();
    },
  };
}

function createFixtureFileDescriptor(descriptorSetBase64: string) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Context transport fixture descriptor set is empty.");
  }

  return fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [
    file_spine_options,
  ]);
}

function requireFirst<Value>(values: readonly Value[]): Value {
  const first = values[0];

  if (first === undefined) {
    throw new Error("Expected a context transport subscription.");
  }

  return first;
}

interface RecordedPublishRegistration {
  readonly handler: PublishTransportHandler;
}

class RecordingSignalTransport implements SignalTransport {
  readonly #publishHandlers = new Map<string, Set<RecordedPublishRegistration>>();
  readonly #requestHandlers = new Map<string, RequestTransportHandler>();
  readonly #responders: TransportSubscription<"command">[] = [];
  readonly #subscribers: TransportSubscription<"event">[] = [];
  closeCalls = 0;

  responders(): readonly TransportSubscription<"command">[] {
    return this.#responders;
  }

  subscribers(): readonly TransportSubscription<"event">[] {
    return this.#subscribers;
  }

  async publish<Envelope, Kind extends TransportSignalKind>(
    operation: PublishTransportOperation<Envelope, Kind>,
  ): Promise<void> {
    const registrations = [
      ...(this.#publishHandlers.get(operation.topic.routing.routingKey) ?? []),
    ];

    if (registrations.length === 0) {
      throw new Error(
        `No context transport subscriber for "${operation.topic.routing.routingKey}".`,
      );
    }

    await Promise.all(registrations.map(({ handler }) => Promise.resolve(handler(operation))));
  }

  subscribe<Envelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: PublishTransportHandler<Envelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
    const routingKey = subscription.topic.routing.routingKey;
    const registrations = this.#publishHandlers.get(routingKey) ?? new Set();
    const registration: RecordedPublishRegistration = {
      handler: handler as PublishTransportHandler,
    };

    registrations.add(registration);
    this.#publishHandlers.set(routingKey, registrations);
    if (subscription.topic.signalKind === "event") {
      this.#subscribers.push(subscription as TransportSubscription<"event">);
    }
    let closed = false;

    return Promise.resolve({
      subscription,
      close: () => {
        if (!closed) {
          closed = true;
          registrations.delete(registration);
          if (registrations.size === 0) {
            this.#publishHandlers.delete(routingKey);
          }
        }
        return Promise.resolve();
      },
    });
  }

  async request<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    operation: RequestTransportOperation<RequestEnvelope, Kind>,
  ): Promise<ResponseEnvelope> {
    const handler = this.#requestHandlers.get(operation.topic.routing.routingKey);

    if (handler === undefined) {
      throw new Error(
        `No context transport responder for "${operation.topic.routing.routingKey}".`,
      );
    }

    return (await handler(operation)) as ResponseEnvelope;
  }

  respond<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: RequestTransportHandler<RequestEnvelope, ResponseEnvelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
    if (subscription.topic.signalKind === "command") {
      this.#responders.push(subscription as TransportSubscription<"command">);
    }
    this.#requestHandlers.set(
      subscription.topic.routing.routingKey,
      handler as RequestTransportHandler,
    );

    return Promise.resolve({ subscription, close: () => Promise.resolve() });
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}
