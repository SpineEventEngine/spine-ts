import { Buffer } from "node:buffer";
import process from "node:process";
import { setTimeout } from "node:timers";

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { packEvent } from "@spine-ts/core";
import { EventContextSchema, EventIdSchema, file_spine_options } from "@spine-ts/proto";
import {
  Aggregate,
  BoundedContext,
  Projection,
  Repository,
  Server,
  ServerEnvironment,
  defineEntityHandlers,
} from "@spine-ts/server";
import { InMemoryStorageFactory } from "@spine-ts/storage";
import { createZeroMqAdapterConfig, createZeroMqTransport } from "@spine-ts/transport/zeromq";

import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.ts";

const ipcDirectory = requiredEnvironment("SPINE_T0038B_IPC_DIRECTORY");
const adapterIdentity = adapterIdentityEnvironment("SPINE_T0038B_ADAPTER_IDENTITY");
const transportTimeoutMs = positiveIntegerEnvironment("SPINE_T0038B_TRANSPORT_TIMEOUT_MS");
const commandDuplicateDelayMs = optionalPositiveIntegerEnvironment(
  "SPINE_T0038B_COMMAND_DUPLICATE_DELAY_MS",
);
const inboundEventEntityId = "cross-process-inbound-event";
const { AggregateStateSchema, ProjectionStateSchema, SingularSetOnceStateSchema } =
  fixtureSchemas();

class TaskAggregate extends Aggregate {
  assignTask(command) {
    observe("command-handled", "command", command.id);
    if (commandDuplicateDelayMs !== undefined) {
      setTimeout(() => {
        observe("command-handled", "command", command.id);
      }, commandDuplicateDelayMs);
    }
    return packEvent({
      id: create(EventIdSchema, { value: `event-${command.id}` }),
      context: create(EventContextSchema),
      schema: ProjectionStateSchema,
      message: create(ProjectionStateSchema, {
        id: command.id,
        name: command.name,
        priority: 1,
      }),
    });
  }

  applyTask(event) {
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

class TaskProjection extends Projection {
  subscribeTask(event) {
    this.updateDraftState(() =>
      create(ProjectionStateSchema, {
        id: event.id,
        name: `${event.name} (projected)`,
        priority: event.priority + 1,
      }),
    );
    observe("primary-projected", eventSource(event.id), event.id);
  }
}

class AuditProjection extends Projection {
  subscribeTask(event) {
    this.updateDraftState(() =>
      create(SingularSetOnceStateSchema, {
        id: event.id,
        mutableNote: `${event.name} (audited)`,
      }),
    );
    observe("secondary-projected", eventSource(event.id), event.id);
  }
}

const transport = createZeroMqTransport(
  createZeroMqAdapterConfig({ ipcDirectory, adapterIdentity }),
  {
    requestTimeoutMs: transportTimeoutMs,
    receiveTimeoutMs: 100,
    onBackgroundFailure: (error) => reportFailure("transport", error),
  },
);
const environment = ServerEnvironment.local({
  storageFactory: new InMemoryStorageFactory(),
  transport,
  ownsStorageFactory: true,
});
let running;
let stopping;

process.on("message", (message) => {
  if (isShutdownMessage(message)) {
    void shutdown();
  }
});
process.once("SIGTERM", () => {
  void shutdown();
});

try {
  const handlers = defineEntityHandlers(TaskAggregate, AggregateStateSchema, (builder) => [
    builder.assign(AggregateStateSchema, "assignTask"),
    builder.apply(ProjectionStateSchema, "applyTask"),
  ]);
  const aggregateRepository = new Repository({
    entityType: TaskAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
  const projectionHandlers = defineEntityHandlers(
    TaskProjection,
    ProjectionStateSchema,
    (builder) => [builder.subscribe(ProjectionStateSchema, "subscribeTask")],
  );
  const projectionRepository = new Repository({
    entityType: TaskProjection,
    schema: ProjectionStateSchema,
    handlers: projectionHandlers,
  });
  const auditHandlers = defineEntityHandlers(
    AuditProjection,
    SingularSetOnceStateSchema,
    (builder) => [builder.subscribe(ProjectionStateSchema, "subscribeTask")],
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
  running = await Server.atPort(0, { environment }).add(context).start();
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

function shutdown(exitCode = 0) {
  stopping ??= closeChild(exitCode);
  return stopping;
}

async function closeChild(exitCode) {
  const failures = [];
  await captureClose(() => running?.close(), "server close", failures);
  await captureClose(() => environment.close(), "environment close", failures);
  await captureClose(() => transport.close(), "transport close", failures);

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

function optionalPositiveIntegerEnvironment(name) {
  return process.env[name] === undefined ? undefined : positiveIntegerEnvironment(name);
}
