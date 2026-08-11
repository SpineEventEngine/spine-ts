import { Buffer } from "node:buffer";
import process from "node:process";

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { SignalEnvelopes } from "@spine-event-engine/core";
import { EventContextSchema, EventIdSchema, file_spine_options } from "@spine-event-engine/proto";
import {
  Aggregate,
  BoundedContext,
  Projection,
  Repository,
  Server,
  EnvironmentType,
  EntityHandlers,
  ServerEnvironment,
} from "@spine-event-engine/server";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { createZeroMqTransport, ZeroMqConfig } from "@spine-event-engine/transport/zeromq";

import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.ts";
import { TaskCreatedSchema } from "../../../../examples/todo/dist/generated/spine/examples/todo/task_events_pb.js";
import { TaskIdSchema } from "../../../../examples/todo/dist/generated/spine/examples/todo/task_id_pb.js";

const ipcDirectory = requiredEnvironment("SPINE_T0038B_IPC_DIRECTORY");
const adapterIdentity = adapterIdentityEnvironment("SPINE_T0038B_ADAPTER_IDENTITY");
const transportTimeoutMs = positiveIntegerEnvironment("SPINE_T0038B_TRANSPORT_TIMEOUT_MS");
const inboundEventEntityId = "cross-process-inbound-event";
const { AggregateStateSchema, ProjectionStateSchema, SingularSetOnceStateSchema } =
  fixtureSchemas();
let commandObservation;

class TaskAggregate extends Aggregate {
  assignTask(command) {
    commandObservation = {
      behavior: "command-handled",
      source: "command",
      entityId: command.id,
    };
    observe("command-handled", "command", command.id);
    return SignalEnvelopes.event({
      id: create(EventIdSchema, { value: `event-${command.id}` }),
      context: create(EventContextSchema),
      schema: TaskCreatedSchema,
      message: create(TaskCreatedSchema, {
        id: create(TaskIdSchema, { value: command.id }),
        title: command.name,
      }),
    });
  }

  applyTask(event) {
    const id = event.id?.value ?? "";
    this.startTransaction();
    this.update((draft) =>
      Object.assign(
        draft,
        create(AggregateStateSchema, {
          id,
          name: event.title,
          archived: false,
        }),
      ),
    );
    this.commitTransaction();
  }
}

class TaskProjection extends Projection {
  subscribeTask(event) {
    const id = event.id?.value ?? "";
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectionStateSchema, {
          id,
          name: `${event.title} (projected)`,
          priority: 2,
        }),
      ),
    );
    observe("primary-projected", eventSource(id), id);
  }
}

class AuditProjection extends Projection {
  subscribeTask(event) {
    const id = event.id?.value ?? "";
    this.update((draft) =>
      Object.assign(
        draft,
        create(SingularSetOnceStateSchema, {
          id,
          mutableNote: `${event.title} (audited)`,
        }),
      ),
    );
    observe("secondary-projected", eventSource(id), id);
  }
}

const transport = createZeroMqTransport(ZeroMqConfig.create({ ipcDirectory, adapterIdentity }), {
  requestTimeoutMs: transportTimeoutMs,
  receiveTimeoutMs: 100,
  onBackgroundFailure: (error) => reportFailure("transport", error),
});
ServerEnvironment.when(EnvironmentType.Local).use({
  storageFactory: new InMemoryStorageFactory(),
  transport,
});
let running;
let stopping;

process.on("message", (message) => {
  if (isShutdownMessage(message)) {
    void shutdown();
  } else if (isDuplicateCommandObservationMessage(message)) {
    void duplicateCommandObservation().catch((error) => {
      void reportFailure("observation control", error);
    });
  }
});
process.once("SIGTERM", () => {
  void shutdown();
});

try {
  const handlers = EntityHandlers.define(TaskAggregate, AggregateStateSchema, (builder) => [
    builder.assign(AggregateStateSchema, "assignTask"),
    builder.apply(TaskCreatedSchema, "applyTask"),
  ]);
  const aggregateRepository = new Repository({
    entityType: TaskAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
  const projectionHandlers = EntityHandlers.define(
    TaskProjection,
    ProjectionStateSchema,
    (builder) => [builder.subscribe(TaskCreatedSchema, "subscribeTask")],
  );
  const projectionRepository = new Repository({
    entityType: TaskProjection,
    schema: ProjectionStateSchema,
    handlers: projectionHandlers,
  });
  const auditHandlers = EntityHandlers.define(
    AuditProjection,
    SingularSetOnceStateSchema,
    (builder) => [builder.subscribe(TaskCreatedSchema, "subscribeTask")],
  );
  const auditRepository = new Repository({
    entityType: AuditProjection,
    schema: SingularSetOnceStateSchema,
    handlers: auditHandlers,
  });
  const context = BoundedContext.singleTenant("CrossProcessTasks")
    .add(aggregateRepository)
    .add(projectionRepository)
    .add(auditRepository);
  running = await Server.atPort(0).add(context).start();
  await sendControl({ type: "ready", host: running.host, port: running.port });
} catch (error) {
  await reportFailure("startup", error);
  await shutdown(1);
}

function fixtureSchemas() {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(serverEntityMetadataTestFixtures.main.descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];
  if (descriptor === undefined) {
    throw new Error("Cross-process fixture descriptor set is empty.");
  }
  const file = fileDesc(
    Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"),
    [file_spine_options],
  );
  return {
    AggregateStateSchema: messageDesc(file, 1),
    ProjectionStateSchema: messageDesc(file, 0),
    SingularSetOnceStateSchema: messageDesc(file, 6),
  };
}

function eventSource(entityId) {
  return entityId === inboundEventEntityId ? "inbound-event" : "command";
}

function observe(behavior, source, entityId) {
  void sendControl({ type: "observed", behavior, source, entityId }).catch((error) => {
    void reportFailure("observation", error);
  });
}

async function duplicateCommandObservation() {
  if (commandObservation === undefined) {
    throw new Error("No command observation is available.");
  }
  await sendControl({ type: "observed", ...commandObservation });
  await sendControl({ type: "duplicate-command-observation-applied" });
}

function shutdown(exitCode = 0) {
  stopping ??= closeChild(exitCode);
  return stopping;
}

async function closeChild(exitCode) {
  const failures = [];
  await captureClose(() => running?.close(), "server close", failures);
  await captureClose(() => ServerEnvironment.instance().close(), "environment close", failures);

  if (failures.length > 0) {
    await reportFailure("shutdown", new AggregateError(failures, "Child shutdown failed."));
    exitCode = 1;
  }
  await sendControl({ type: "stopped" });
  process.disconnect();
  process.exitCode = exitCode;
}

async function captureClose(close, phase, failures) {
  try {
    await close();
  } catch (error) {
    failures.push(new Error(`${phase}: ${safeMessage(error)}`));
  }
}

function isShutdownMessage(message) {
  return (
    message !== null &&
    typeof message === "object" &&
    message.type === "shutdown" &&
    Object.keys(message).length === 1
  );
}

function isDuplicateCommandObservationMessage(message) {
  return (
    message !== null &&
    typeof message === "object" &&
    message.type === "duplicate-command-observation" &&
    Object.keys(message).length === 1
  );
}

async function reportFailure(phase, error) {
  await sendControl({ type: "failure", phase, message: safeMessage(error) });
}

async function sendControl(message) {
  if (process.send === undefined || !process.connected) {
    return;
  }
  await new Promise((resolve, reject) => {
    process.send(message, (error) => {
      if (error === null) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

function safeMessage(error) {
  const source = error instanceof Error ? error.message : String(error);
  return source
    .replaceAll(ipcDirectory, "<ipc-directory>")
    .replace(/[\r\n\t]+/gu, " ")
    .slice(0, 240);
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function adapterIdentityEnvironment(name) {
  const value = requiredEnvironment(name);
  if (value.trim() !== value || !/^[A-Za-z0-9._-]+$/u.test(value)) {
    throw new Error(
      `${name} must contain only letters, numbers, dots, underscores, or hyphens without surrounding whitespace.`,
    );
  }
  return value;
}

function positiveIntegerEnvironment(name) {
  const source = requiredEnvironment(name);
  if (!/^[1-9][0-9]*$/u.test(source)) {
    throw new Error(`${name} must be a canonical positive decimal integer.`);
  }
  const value = Number(source);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe positive integer.`);
  }
  return value;
}
