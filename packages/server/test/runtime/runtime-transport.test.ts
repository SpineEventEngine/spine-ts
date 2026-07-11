import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { deriveTypeUrl } from "@spine-ts/core";
import {
  CommandSchema,
  EventSchema,
  file_spine_options,
  type Command,
  type Event,
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
import { createZeroMqAdapterConfig, createZeroMqTransport } from "@spine-ts/transport/zeromq";
import { describe, expect, expectTypeOf, it } from "vitest";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

import {
  BoundedContext,
  CommandRegistrationReadiness,
  EventRegistrationReadiness,
  RuntimeTransportBinding,
  RuntimeTransportEnvelopeError,
  SingleProcessServerRuntime,
  defineEntityHandlers,
  type CommandRuntimeTransportHandler,
  type EventRuntimeTransportHandler,
  type RuntimeTransportBindingHandle,
  type RuntimeTransportBindingInput,
} from "../../src/index.js";

type ProjectionState = Message<"ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

class RuntimeProjection {
  assignCommand(command: Command): void {
    void command;
  }

  subscribeEvent(event: Event): void {
    void event;
  }
}

const fileEntityMetadataFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.main.descriptorSetBase64,
);
const ProjectionStateSchema = messageDesc(
  fileEntityMetadataFixture,
  0,
) as GenMessage<ProjectionState>;

describe("RuntimeTransportBinding", () => {
  it("registers command responders and event subscribers from the routing plan", async () => {
    const transport = new InMemorySignalTransport();
    const runtime = new SingleProcessServerRuntime();
    transport.bindRuntime(runtime);
    const plan = createRuntimePlan();
    const onCommand: CommandRuntimeTransportHandler = () => undefined;
    const onEvent: EventRuntimeTransportHandler = () => undefined;

    const handle = await RuntimeTransportBinding.open({
      plan,
      runtime,
      transport,
      onCommand,
      onEvent,
    });

    expectTypeOf<typeof handle>().toExtend<RuntimeTransportBindingHandle>();
    expectTypeOf<RuntimeTransportBindingInput>().toExtend<{
      readonly onCommand: CommandRuntimeTransportHandler;
      readonly onEvent: EventRuntimeTransportHandler;
    }>();
    expect(transport.responders()).toEqual(plan.commands.subscriptions);
    expect(transport.subscribers()).toEqual(plan.events.subscriptions);
    expect(transport).not.toHaveProperty("socket");
    expect(transport).not.toHaveProperty("endpoint");

    await handle.close();
  });

  it("validates command envelopes before runtime intake and returns an intake failure", async () => {
    const transport = new InMemorySignalTransport();
    const runtime = new SingleProcessServerRuntime();
    transport.bindRuntime(runtime);
    const plan = createRuntimePlan();
    const calls: Command[] = [];
    const handle = await RuntimeTransportBinding.open({
      plan,
      runtime,
      transport,
      onCommand: (command) => {
        calls.push(command);
      },
      onEvent: () => undefined,
    });

    const result = await transport.request({
      topic: requireFirst(plan.commands.topics),
      envelope: {
        $typeName: CommandSchema.typeName,
        message: { typeUrl: deriveTypeUrl(EventSchema) },
      },
    });

    expect(result).toEqual({
      status: "failed",
      signalKind: "command",
      failure: {
        code: "MALFORMED_ENVELOPE",
        diagnostics: {
          boundedContext: "RuntimeTasks",
          messageType: deriveTypeUrl(EventSchema),
          reason: "unexpected message type URL",
          runtimeState: "running",
        },
      },
    });
    expect(calls).toEqual([]);
    expect(runtime.state).toBe("running");

    await handle.close();
  });

  it("rejects malformed outer command envelopes without runtime intake", async () => {
    const transport = new InMemorySignalTransport();
    const runtime = new SingleProcessServerRuntime();
    transport.bindRuntime(runtime);
    const plan = createRuntimePlan();
    const calls: Command[] = [];
    const handle = await RuntimeTransportBinding.open({
      plan,
      runtime,
      transport,
      onCommand: (command) => {
        calls.push(command);
      },
      onEvent: () => undefined,
    });

    const nonObject = await transport.request({
      topic: requireFirst(plan.commands.topics),
      envelope: undefined,
    });
    const wrongEnvelope = await transport.request({
      topic: requireFirst(plan.commands.topics),
      envelope: {
        $typeName: EventSchema.typeName,
        message: { typeUrl: deriveTypeUrl(EventSchema) },
      },
    });
    const missingMessage = await transport.request({
      topic: requireFirst(plan.commands.topics),
      envelope: {
        $typeName: CommandSchema.typeName,
      },
    });

    expect(nonObject).toMatchObject({
      status: "failed",
      failure: { diagnostics: { reason: "envelope must be an object" } },
    });
    expect(wrongEnvelope).toMatchObject({
      status: "failed",
      failure: {
        diagnostics: {
          reason: "unexpected envelope type",
          messageType: deriveTypeUrl(EventSchema),
        },
      },
    });
    expect(missingMessage).toMatchObject({
      status: "failed",
      failure: { diagnostics: { reason: "missing message" } },
    });
    expect(calls).toEqual([]);

    await handle.close();
  });

  it("rejects malformed generated command envelopes without runtime intake", async () => {
    const transport = new InMemorySignalTransport();
    const runtime = new SingleProcessServerRuntime();
    transport.bindRuntime(runtime);
    const plan = createRuntimePlan();
    const calls: Command[] = [];
    const handle = await RuntimeTransportBinding.open({
      plan,
      runtime,
      transport,
      onCommand: (command) => {
        calls.push(command);
      },
      onEvent: () => undefined,
    });

    const result = await transport.request({
      topic: requireFirst(plan.commands.topics),
      envelope: {
        $typeName: CommandSchema.typeName,
        message: {
          $typeName: AnySchema.typeName,
          typeUrl: deriveTypeUrl(CommandSchema),
          value: "not bytes",
        },
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      signalKind: "command",
      failure: {
        code: "MALFORMED_ENVELOPE",
        diagnostics: {
          reason: "malformed generated envelope",
          messageType: deriveTypeUrl(CommandSchema),
        },
      },
    });
    expect(calls).toEqual([]);

    await handle.close();
  });

  it("rejects malformed event envelopes before runtime intake", async () => {
    const transport = new InMemorySignalTransport();
    const runtime = new SingleProcessServerRuntime();
    transport.bindRuntime(runtime);
    const plan = createRuntimePlan();
    const calls: Event[] = [];
    const handle = await RuntimeTransportBinding.open({
      plan,
      runtime,
      transport,
      onCommand: () => undefined,
      onEvent: (event) => {
        calls.push(event);
      },
    });

    await expect(
      transport.publish({
        topic: requireFirst(plan.events.topics),
        envelope: {
          $typeName: EventSchema.typeName,
          message: { typeUrl: "" },
        },
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(RuntimeTransportEnvelopeError);
      expect(error).toMatchObject({
        result: {
          status: "failed",
          signalKind: "event",
          failure: {
            code: "MALFORMED_ENVELOPE",
          },
        },
      });
      return true;
    });
    expect(calls).toEqual([]);
    expect(runtime.state).toBe("running");

    await handle.close();
  });

  it("reports runtime-not-accepting after the binding handle is closed", async () => {
    const transport = new InMemorySignalTransport();
    const runtime = new SingleProcessServerRuntime();
    transport.bindRuntime(runtime);
    const plan = createRuntimePlan();
    const handle = await RuntimeTransportBinding.open({
      plan,
      runtime,
      transport,
      onCommand: () => undefined,
      onEvent: () => undefined,
    });

    await handle.close();

    await expect(
      transport.request({
        topic: requireFirst(plan.commands.topics),
        envelope: createCommandEnvelope(),
      }),
    ).resolves.toMatchObject({
      status: "failed",
      signalKind: "command",
      failure: {
        code: "RUNTIME_NOT_ACCEPTING",
        diagnostics: {
          runtimeState: "closed",
          reason: "runtime is not accepting work",
        },
      },
    });
    await expect(
      transport.publish({
        topic: requireFirst(plan.events.topics),
        envelope: createEventEnvelope(),
      }),
    ).rejects.toMatchObject({
      result: {
        status: "failed",
        signalKind: "event",
        failure: {
          code: "RUNTIME_NOT_ACCEPTING",
        },
      },
    });
  });

  it("reports runtime-not-accepting when the runtime closes outside the binding gate", async () => {
    const transport = new InMemorySignalTransport();
    const runtime = new SingleProcessServerRuntime();
    transport.bindRuntime(runtime);
    const plan = createRuntimePlan();
    const calls: string[] = [];
    const handle = await RuntimeTransportBinding.open({
      plan,
      runtime,
      transport,
      onCommand: () => {
        calls.push("command");
      },
      onEvent: () => {
        calls.push("event");
      },
    });

    await runtime.close();

    await expect(
      transport.request({
        topic: requireFirst(plan.commands.topics),
        envelope: createCommandEnvelope(),
      }),
    ).resolves.toMatchObject({
      status: "failed",
      signalKind: "command",
      failure: {
        code: "RUNTIME_NOT_ACCEPTING",
        diagnostics: {
          runtimeState: "closed",
          reason: "runtime is not accepting work",
        },
      },
    });
    await expect(
      transport.publish({
        topic: requireFirst(plan.events.topics),
        envelope: createEventEnvelope(),
      }),
    ).rejects.toMatchObject({
      result: {
        status: "failed",
        signalKind: "event",
        failure: {
          code: "RUNTIME_NOT_ACCEPTING",
          diagnostics: {
            runtimeState: "closed",
            reason: "runtime is not accepting work",
          },
        },
      },
    });
    expect(calls).toEqual([]);

    await handle.close();
  });

  it("refuses callbacks while transport handles are closing", async () => {
    const log: string[] = [];
    const closeBlock = deferred();
    const transport = new InMemorySignalTransport(
      log,
      (subscription, closeLog, runtimeState) =>
        new BlockingCloseHandle(subscription, closeLog, runtimeState, closeBlock.promise),
    );
    const runtime = new SingleProcessServerRuntime();
    transport.bindRuntime(runtime);
    const plan = createRuntimePlan();
    const calls: string[] = [];
    const handle = await RuntimeTransportBinding.open({
      plan,
      runtime,
      transport,
      onCommand: () => {
        calls.push("command");
      },
      onEvent: () => {
        calls.push("event");
      },
    });

    const closePromise = handle.close();
    await Promise.resolve();

    await expect(
      transport.request({
        topic: requireFirst(plan.commands.topics),
        envelope: createCommandEnvelope(),
      }),
    ).resolves.toMatchObject({
      status: "failed",
      signalKind: "command",
      failure: {
        code: "RUNTIME_NOT_ACCEPTING",
        diagnostics: {
          runtimeState: "running",
          reason: "runtime is not accepting work",
        },
      },
    });
    await expect(
      transport.publish({
        topic: requireFirst(plan.events.topics),
        envelope: createEventEnvelope(),
      }),
    ).rejects.toMatchObject({
      result: {
        status: "failed",
        signalKind: "event",
        failure: {
          code: "RUNTIME_NOT_ACCEPTING",
        },
      },
    });
    expect(calls).toEqual([]);
    expect(log).toEqual([
      `handle:${requireFirst(plan.commands.subscriptions).descriptorKey}:running`,
    ]);

    closeBlock.resolve();
    await closePromise;

    expect(runtime.state).toBe("closed");
  });

  it("accepts valid envelopes and runs command and event callbacks through the runtime", async () => {
    const transport = new InMemorySignalTransport();
    const runtime = new SingleProcessServerRuntime();
    transport.bindRuntime(runtime);
    const plan = createRuntimePlan();
    const command = createCommandEnvelope();
    const event = createEventEnvelope();
    const observed: string[] = [];
    let releaseCommand!: () => void;
    const commandCanFinish = new Promise<void>((resolve) => {
      releaseCommand = resolve;
    });
    const handle = await RuntimeTransportBinding.open({
      plan,
      runtime,
      transport,
      onCommand: async (accepted) => {
        observed.push(`command:${accepted.message?.typeUrl ?? "missing"}`);
        await commandCanFinish;
      },
      onEvent: (accepted) => {
        observed.push(`event:${accepted.message?.typeUrl ?? "missing"}`);
      },
    });

    const result = await transport.request({
      topic: requireFirst(plan.commands.topics),
      envelope: command,
    });
    await transport.publish({
      topic: requireFirst(plan.events.topics),
      envelope: event,
    });

    expect(result).toEqual({
      status: "accepted",
      signalKind: "command",
      acceptedFor: "async-work",
    });
    expect(observed).toEqual(["command:type.spine.io/spine.core.Command"]);

    releaseCommand();
    await handle.close();

    expect(observed).toEqual([
      "command:type.spine.io/spine.core.Command",
      "event:type.spine.io/spine.core.Event",
    ]);
  });

  it("runs command and event callbacks over the ZeroMQ-backed transport", async () => {
    const ipcDirectory = await mkdtemp(path.join(tmpdir(), "sz-runtime-"));
    const transport = createZeroMqTransport(
      createZeroMqAdapterConfig({
        ipcDirectory,
        adapterIdentity: `runtime-${String(process.pid)}-${String(Date.now())}`,
      }),
    );
    const runtime = new SingleProcessServerRuntime();
    const plan = createRuntimePlan();
    const observed: string[] = [];

    try {
      const handle = await RuntimeTransportBinding.open({
        plan,
        runtime,
        transport,
        onCommand: (accepted) => {
          observed.push(`command:${accepted.message?.typeUrl ?? "missing"}`);
        },
        onEvent: (accepted) => {
          observed.push(`event:${accepted.message?.typeUrl ?? "missing"}`);
        },
      });

      const result = await transport.request({
        topic: requireFirst(plan.commands.topics),
        envelope: createCommandEnvelope(),
      });
      await publishRuntimeEventUntilObserved(transport, plan, observed);
      await waitForRuntimeObservation(observed, "command:type.spine.io/spine.core.Command");

      expect(result).toEqual({
        status: "accepted",
        signalKind: "command",
        acceptedFor: "async-work",
      });
      expect(observed).toContain("command:type.spine.io/spine.core.Command");
      expect(observed).toContain("event:type.spine.io/spine.core.Event");

      await handle.close();
    } finally {
      await transport.close();
      await rm(ipcDirectory, { recursive: true, force: true });
    }
  });

  it("closes transport registrations before the runtime and keeps close idempotent", async () => {
    const log: string[] = [];
    const transport = new InMemorySignalTransport(log);
    const runtime = new SingleProcessServerRuntime();
    transport.bindRuntime(runtime);
    const plan = createRuntimePlan();
    const handle = await RuntimeTransportBinding.open({
      plan,
      runtime,
      transport,
      onCommand: () => undefined,
      onEvent: () => undefined,
    });

    await handle.close();
    await handle.close();

    expect(log).toEqual([
      `handle:${requireFirst(plan.commands.subscriptions).descriptorKey}:running`,
      `handle:${requireFirst(plan.events.subscriptions).descriptorKey}:running`,
    ]);
    expect(runtime.state).toBe("closed");
    expect(transport.closeCalls).toBe(0);
  });

  it("continues closing handles after a close failure and allows retry", async () => {
    const log: string[] = [];
    const transport = new InMemorySignalTransport(log, (subscription, closeLog, runtimeState) => {
      if (subscription.topic.signalKind === "command") {
        return new FailOnceCloseHandle(subscription, closeLog, runtimeState);
      }

      return new NonIdempotentCloseHandle(subscription, closeLog, runtimeState);
    });
    const runtime = new SingleProcessServerRuntime();
    transport.bindRuntime(runtime);
    const plan = createRuntimePlan();
    const handle = await RuntimeTransportBinding.open({
      plan,
      runtime,
      transport,
      onCommand: () => undefined,
      onEvent: () => undefined,
    });

    await expect(handle.close()).rejects.toThrow("test command handle close failed");

    expect(log).toEqual([
      `handle:${requireFirst(plan.commands.subscriptions).descriptorKey}:running:fail`,
      `handle:${requireFirst(plan.events.subscriptions).descriptorKey}:running`,
    ]);
    expect(runtime.state).toBe("closed");

    await handle.close();

    expect(log).toEqual([
      `handle:${requireFirst(plan.commands.subscriptions).descriptorKey}:running:fail`,
      `handle:${requireFirst(plan.events.subscriptions).descriptorKey}:running`,
      `handle:${requireFirst(plan.commands.subscriptions).descriptorKey}:closed:retry`,
    ]);
  });

  it("closes the runtime when transport registration fails during open", async () => {
    const runtime = new SingleProcessServerRuntime();
    const plan = createRuntimePlan();
    const transport = new FailingSignalTransport();

    await expect(
      RuntimeTransportBinding.open({
        plan,
        runtime,
        transport,
        onCommand: () => undefined,
        onEvent: () => undefined,
      }),
    ).rejects.toThrow("test transport registration failed");
    expect(runtime.state).toBe("closed");
  });
});

function createRuntimePlan() {
  const handlers = defineEntityHandlers(RuntimeProjection, ProjectionStateSchema, (builder) => [
    builder.assign(CommandSchema, "assignCommand"),
    builder.subscribe(EventSchema, "subscribeEvent"),
  ]);

  return RuntimeTransportBinding.plan({
    context: BoundedContext.singleTenant("RuntimeTasks").build(),
    commands: CommandRegistrationReadiness.fromEntityHandlers([handlers]),
    events: EventRegistrationReadiness.fromEntityHandlers([handlers]),
  });
}

function createFixtureFileDescriptor(descriptorSetBase64: string, imports = [file_spine_options]) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Runtime transport fixture descriptor set is empty.");
  }

  return fileDesc(
    Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"),
    imports,
  );
}

function createCommandEnvelope(): Command {
  return create(CommandSchema, {
    message: create(AnySchema, { typeUrl: deriveTypeUrl(CommandSchema) }),
  });
}

function createEventEnvelope(): Event {
  return create(EventSchema, {
    message: create(AnySchema, { typeUrl: deriveTypeUrl(EventSchema) }),
  });
}

function requireFirst<Value>(values: readonly Value[]): Value {
  const first = values[0];

  if (first === undefined) {
    throw new Error("Expected at least one runtime transport test value.");
  }

  return first;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = () => {
      promiseResolve();
    };
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

async function publishRuntimeEventUntilObserved(
  transport: SignalTransport,
  plan: ReturnType<typeof createRuntimePlan>,
  observed: readonly string[],
): Promise<void> {
  const expected = "event:type.spine.io/spine.core.Event";

  for (let attempt = 0; attempt < 100; attempt += 1) {
    await transport.publish({
      topic: requireFirst(plan.events.topics),
      envelope: createEventEnvelope(),
    });

    if (observed.includes(expected)) {
      return;
    }

    await waitForRuntimeTransport(20);
  }

  expect(observed).toContain(expected);
}

async function waitForRuntimeObservation(
  observed: readonly string[],
  expected: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (observed.includes(expected)) {
      return;
    }

    await waitForRuntimeTransport(20);
  }

  expect(observed).toContain(expected);
}

async function waitForRuntimeTransport(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

type TestHandleFactory = <Kind extends TransportSignalKind>(
  subscription: TransportSubscription<Kind>,
  log: string[],
  runtimeState: () => string,
) => TransportSubscriptionHandle<Kind>;

class InMemorySignalTransport implements SignalTransport {
  readonly #log: string[];
  readonly #handleFactory: TestHandleFactory;
  readonly #requestHandlers = new Map<string, RequestTransportHandler>();
  readonly #publishHandlers = new Map<string, PublishTransportHandler>();
  readonly #requestSubscriptions: TransportSubscription<"command">[] = [];
  readonly #publishSubscriptions: TransportSubscription<"event">[] = [];
  #runtime: SingleProcessServerRuntime | undefined;

  closeCalls = 0;

  constructor(
    log: string[] = [],
    handleFactory: TestHandleFactory = (subscription, closeLog, runtimeState) =>
      new InMemoryHandle(subscription, closeLog, runtimeState),
  ) {
    this.#log = log;
    this.#handleFactory = handleFactory;
  }

  bindRuntime(runtime: SingleProcessServerRuntime): void {
    this.#runtime = runtime;
  }

  responders(): readonly TransportSubscription<"command">[] {
    return [...this.#requestSubscriptions];
  }

  subscribers(): readonly TransportSubscription<"event">[] {
    return [...this.#publishSubscriptions];
  }

  async publish<Envelope, Kind extends TransportSignalKind>(
    operation: PublishTransportOperation<Envelope, Kind>,
  ): Promise<void> {
    const handler = this.#publishHandlers.get(operation.topic.routing.routingKey);

    if (handler === undefined) {
      throw new Error(`No test publish handler for "${operation.topic.routing.routingKey}".`);
    }

    await handler(operation);
  }

  subscribe<Envelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: PublishTransportHandler<Envelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
    if (subscription.topic.signalKind === "event") {
      this.#publishSubscriptions.push(subscription as TransportSubscription<"event">);
    }
    this.#publishHandlers.set(
      subscription.topic.routing.routingKey,
      handler as PublishTransportHandler,
    );

    return Promise.resolve(
      this.#handleFactory(subscription, this.#log, () => this.#runtime?.state ?? "unknown"),
    );
  }

  async request<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    operation: RequestTransportOperation<RequestEnvelope, Kind>,
  ): Promise<ResponseEnvelope> {
    const handler = this.#requestHandlers.get(operation.topic.routing.routingKey);

    if (handler === undefined) {
      throw new Error(`No test request handler for "${operation.topic.routing.routingKey}".`);
    }

    return (await handler(operation)) as ResponseEnvelope;
  }

  respond<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: RequestTransportHandler<RequestEnvelope, ResponseEnvelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
    if (subscription.topic.signalKind === "command") {
      this.#requestSubscriptions.push(subscription as TransportSubscription<"command">);
    }
    this.#requestHandlers.set(
      subscription.topic.routing.routingKey,
      handler as RequestTransportHandler,
    );

    return Promise.resolve(
      this.#handleFactory(subscription, this.#log, () => this.#runtime?.state ?? "unknown"),
    );
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

class InMemoryHandle<
  Kind extends TransportSignalKind,
> implements TransportSubscriptionHandle<Kind> {
  readonly subscription: TransportSubscription<Kind>;
  readonly #log: string[];
  readonly #runtimeState: () => string;
  #closed = false;

  constructor(
    subscription: TransportSubscription<Kind>,
    log: string[],
    runtimeState: () => string,
  ) {
    this.subscription = subscription;
    this.#log = log;
    this.#runtimeState = runtimeState;
  }

  close(): Promise<void> {
    if (this.#closed) {
      return Promise.resolve();
    }

    this.#closed = true;
    this.#log.push(`handle:${this.subscription.descriptorKey}:${this.#runtimeState()}`);
    return Promise.resolve();
  }
}

class BlockingCloseHandle<
  Kind extends TransportSignalKind,
> implements TransportSubscriptionHandle<Kind> {
  readonly subscription: TransportSubscription<Kind>;
  readonly #log: string[];
  readonly #runtimeState: () => string;
  readonly #block: Promise<void>;
  #closed = false;

  constructor(
    subscription: TransportSubscription<Kind>,
    log: string[],
    runtimeState: () => string,
    block: Promise<void>,
  ) {
    this.subscription = subscription;
    this.#log = log;
    this.#runtimeState = runtimeState;
    this.#block = block;
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    this.#log.push(`handle:${this.subscription.descriptorKey}:${this.#runtimeState()}`);
    await this.#block;
  }
}

class NonIdempotentCloseHandle<
  Kind extends TransportSignalKind,
> implements TransportSubscriptionHandle<Kind> {
  readonly subscription: TransportSubscription<Kind>;
  readonly #log: string[];
  readonly #runtimeState: () => string;
  #closed = false;

  constructor(
    subscription: TransportSubscription<Kind>,
    log: string[],
    runtimeState: () => string,
  ) {
    this.subscription = subscription;
    this.#log = log;
    this.#runtimeState = runtimeState;
  }

  close(): Promise<void> {
    if (this.#closed) {
      return Promise.reject(
        new Error(`test handle ${this.subscription.descriptorKey} closed twice`),
      );
    }

    this.#closed = true;
    this.#log.push(`handle:${this.subscription.descriptorKey}:${this.#runtimeState()}`);
    return Promise.resolve();
  }
}

class FailOnceCloseHandle<
  Kind extends TransportSignalKind,
> implements TransportSubscriptionHandle<Kind> {
  readonly subscription: TransportSubscription<Kind>;
  readonly #log: string[];
  readonly #runtimeState: () => string;
  #attempt = 0;

  constructor(
    subscription: TransportSubscription<Kind>,
    log: string[],
    runtimeState: () => string,
  ) {
    this.subscription = subscription;
    this.#log = log;
    this.#runtimeState = runtimeState;
  }

  close(): Promise<void> {
    this.#attempt += 1;
    if (this.#attempt === 1) {
      this.#log.push(`handle:${this.subscription.descriptorKey}:${this.#runtimeState()}:fail`);
      return Promise.reject(new Error("test command handle close failed"));
    }

    this.#log.push(`handle:${this.subscription.descriptorKey}:${this.#runtimeState()}:retry`);
    return Promise.resolve();
  }
}

class FailingSignalTransport implements SignalTransport {
  publish<Envelope, Kind extends TransportSignalKind>(
    operation: PublishTransportOperation<Envelope, Kind>,
  ): Promise<void> {
    void operation;
    return Promise.resolve();
  }

  subscribe<Envelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: PublishTransportHandler<Envelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
    void subscription;
    void handler;
    return Promise.reject(new Error("test transport registration failed"));
  }

  request<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    operation: RequestTransportOperation<RequestEnvelope, Kind>,
  ): Promise<ResponseEnvelope> {
    void operation;
    return Promise.reject(new Error("test transport request should not run"));
  }

  respond<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: RequestTransportHandler<RequestEnvelope, ResponseEnvelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
    void subscription;
    void handler;
    return Promise.reject(new Error("test transport registration failed"));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
