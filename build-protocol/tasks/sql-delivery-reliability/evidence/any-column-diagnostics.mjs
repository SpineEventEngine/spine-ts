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
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
assert.equal(process.cwd(), root.replace(/\/$/, ""));
const artifacts = [];
async function load(path) {
  const absolute = resolve(root, path);
  const bytes = await readFile(absolute);
  artifacts.push({ path: absolute, sha256: createHash("sha256").update(bytes).digest("hex") });
  return import(pathToFileURL(absolute).href);
}
const require = createRequire(resolve(root, "packages/server/package.json"));
const { create, toBinary } = require("@bufbuild/protobuf");
const { AnySchema } = require("@bufbuild/protobuf/wkt");
const { createClient } = require("@connectrpc/connect");
const { createGrpcTransport } = require("@connectrpc/connect-node");
const { BoundedContext, Server, ServerEnvironment, EnvironmentType } = await load(
  "packages/server/dist/index.js",
);
const { RecordSpec, RecordColumn, ColumnTypes } = await load("packages/storage/dist/index.js");
const { AnyMessages, StringifierRegistry, TypeRegistry } = await load(
  "packages/core/dist/index.js",
);
const {
  AckSchema,
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  CommandSchema,
  UserIdSchema,
  EventSchema,
  EventIdSchema,
  EventContextSchema,
  VersionSchema,
} = await load("packages/proto/dist/src/index.js");
const { CommandService } = await load("packages/proto/dist/src/client/index.js");
const { CreateTaskSchema } = await load(
  "examples/todo/dist/generated/spine/examples/todo/task_commands_pb.js",
);
const { TaskCreatedSchema } = await load(
  "examples/todo/dist/generated/spine/examples/todo/task_events_pb.js",
);
const { TaskIdSchema, TaskListIdSchema } = await load(
  "examples/todo/dist/generated/spine/examples/todo/task_id_pb.js",
);
const registry = JSON.parse(await readFile(new URL("databases.json", import.meta.url), "utf8"));
const diagnostics = [];
function logger(facts = {}) {
  return {
    child: (additional = {}) => logger({ ...facts, ...additional }),
    withMetadata: (additional) => logger({ ...facts, ...additional }),
    error: (message) => diagnostics.push({ message, facts }),
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
  };
}
ServerEnvironment.when(EnvironmentType.Local).use({ logger: logger() });
const timer = setTimeout(() => {
  process.stderr.write("Any column diagnostic probe exceeded 90 seconds.\n");
  process.exit(1);
}, 90_000);
try {
  for (const record of registry.records) await verify(record);
  process.stdout.write(`${JSON.stringify({ artifacts, status: "PASS" })}\n`);
} finally {
  clearTimeout(timer);
}

async function verify(record) {
  const pg = record.engine === "postgres";
  const module = pg ? "storage-postgres" : "storage-mysql";
  const providerRequire = createRequire(resolve(root, `packages/${module}/package.json`));
  const adapters = await load(`packages/${module}/dist/index.js`);
  const Factory = adapters.PostgresStorageFactory ?? adapters.MysqlStorageFactory;
  const suffix = randomUUID().replaceAll("-", "");
  const tableName = `any_diag_${suffix}`;
  const table = pg ? `"${tableName}"` : `\`${tableName}\``;
  const contextName = `AnyDiagnostic_${suffix}`;
  const boundary = { name: contextName, multitenant: false };
  const types = new TypeRegistry([TaskCreatedSchema, TaskIdSchema, TaskListIdSchema]);
  const stringifiers = new StringifierRegistry();
  stringifiers.setTypeRegistry(types);
  const factories = [];
  const storages = [];
  const spec = new RecordSpec({
    recordType: EventSchema,
    idKind: "string",
    extractId: (event) => event.id.value,
    columns: [
      new RecordColumn("payload", ColumnTypes.message(AnySchema), (event) => event.message),
    ],
  });
  const driver = pg
    ? new (providerRequire("pg").Client)({ connectionString: record.urls.spine_test })
    : await providerRequire("mysql2/promise").createConnection(record.urls.spine_test);
  if (pg) await driver.connect();
  let running;
  let failure;
  let dispatchCalls = 0;
  let configured = false;
  try {
    const missing = await open(false);
    const correct = await open(true);
    const taskId = create(TaskIdSchema, { value: `task-${suffix}` });
    const taskListId = create(TaskListIdSchema, { value: `list-${suffix}` });
    const payload = create(TaskCreatedSchema, {
      id: taskId,
      taskListId,
      title: `private-payload-${suffix}`,
    });
    const event = create(EventSchema, {
      id: create(EventIdSchema, { value: `event-${suffix}` }),
      context: create(EventContextSchema, {
        producerId: AnyMessages.pack(TaskIdSchema, taskId),
        version: create(VersionSchema, { number: 1 }),
        origin: { case: "importContext", value: create(ActorContextSchema) },
      }),
      message: AnyMessages.pack(TaskCreatedSchema, payload),
    });
    const context = BoundedContext.singleTenant(contextName)
      .addCommandDispatcher({
        messageSchemas: () => [CreateTaskSchema],
        dispatch: async () => {
          dispatchCalls++;
          try {
            await (configured ? correct : missing).write(event);
          } catch (error) {
            failure = error;
            throw error;
          }
        },
      })
      .build();
    running = await Server.atPort(0).add(context).start();
    const client = createClient(CommandService, createGrpcTransport({ baseUrl: running.baseUrl }));
    const commandId = `command-${suffix}`;
    const command = create(CommandSchema, {
      id: create(CommandIdSchema, { uuid: commandId }),
      context: create(CommandContextSchema, {
        actorContext: create(ActorContextSchema, {
          actor: create(UserIdSchema, { value: "any-diagnostic-actor" }),
        }),
      }),
      message: AnyMessages.pack(
        CreateTaskSchema,
        create(CreateTaskSchema, { id: taskId, taskListId, title: payload.title }),
      ),
    });
    const rejected = await client.post(command, { timeoutMs: 5000 });
    assert.equal(dispatchCalls, 1);
    assert.ok(
      failure instanceof
        (adapters.PostgresStorageOperationError ?? adapters.MysqlStorageOperationError),
    );
    assert.ok(failure.cause instanceof Error);
    assert.match(failure.cause.message, /Any|type|registry/);
    assert.equal(rejected.status?.status.case, "error");
    assert.equal(rejected.status.status.value.message, "Command post failed.");
    assert.equal(AnyMessages.unpack(rejected.messageId, CommandIdSchema).uuid, commandId);
    assert.equal(await correct.read(event.id.value), undefined);
    const matching = diagnostics.filter(
      ({ facts }) => facts.commandId === commandId && facts.operation === "command.post",
    );
    assert.equal(matching.length, 1);
    assert.equal(matching[0].facts.contextName, contextName);
    const wire = Buffer.from(toBinary(AckSchema, rejected)).toString("utf8");
    for (const secret of [
      failure.cause.message,
      payload.title,
      tableName,
      record.urls.spine_test,
    ]) {
      assert.equal(wire.includes(secret), false);
      assert.equal(JSON.stringify(matching).includes(secret), false);
    }
    configured = true;
    const accepted = await client.post(command, { timeoutMs: 5000 });
    assert.equal(accepted.status?.status.case, "ok");
    assert.equal(dispatchCalls, 2);
    assert.deepEqual(
      toBinary(EventSchema, await correct.read(event.id.value)),
      toBinary(EventSchema, event),
    );
    assert.equal(diagnostics.filter(({ facts }) => facts.commandId === commandId).length, 1);
    process.stdout.write(
      `${JSON.stringify({ provider: record.name, version: record.serverVersion, pid: process.pid, port: running.port, commandId, eventId: event.id.value, fault: "valid-domain-Any-column-without-type-registry", providerErrorClass: failure.constructor.name, originalCauseType: failure.cause.name, originalCause: failure.cause.message, diagnostic: matching[0], dispatchCalls, recovery: "explicit-client-repost-with-configured-registry", automaticStorageRetry: false, status: "PASS" })}\n`,
    );
  } finally {
    try {
      if (running) await running.close();
    } finally {
      for (const storage of storages) storage.close();
      for (const factory of factories) factory.close();
      try {
        await driver.query(`DROP TABLE IF EXISTS ${table}`);
      } finally {
        await driver.end();
      }
    }
  }
  async function open(withTypes) {
    const builder = Factory.newBuilder()
      .setOptions({ url: record.urls.spine_test })
      .setTableName(EventSchema, tableName);
    if (withTypes) builder.setStringifierRegistry(stringifiers);
    const factory = await builder.build();
    factories.push(factory);
    const storage = factory.createRecordStorage(boundary, spec);
    storages.push(storage);
    return storage;
  }
}
