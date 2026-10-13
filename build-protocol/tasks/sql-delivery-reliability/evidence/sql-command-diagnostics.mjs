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
const { clone, create, toBinary } = require("@bufbuild/protobuf");
const { createClient } = require("@connectrpc/connect");
const { createGrpcTransport } = require("@connectrpc/connect-node");
const { BoundedContext, Server, ServerEnvironment, EnvironmentType } = await load(
  "packages/server/dist/index.js",
);
const { RecordSpec } = await load("packages/storage/dist/index.js");
const { AnyMessages } = await load("packages/core/dist/index.js");
const {
  AckSchema,
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  CommandSchema,
  UserIdSchema,
} = await load("packages/proto/dist/src/index.js");
const { CommandService } = await load("packages/proto/dist/src/client/index.js");
const { TaskSchema } = await load("examples/todo/dist/generated/spine/examples/todo/tasks_pb.js");
const { CreateTaskSchema } = await load(
  "examples/todo/dist/generated/spine/examples/todo/task_commands_pb.js",
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
  process.stderr.write("SQL Command diagnostic probe exceeded 90 seconds.\n");
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
  const tableName = `diagnostic_${suffix}`;
  const contextName = `Diagnostic_${suffix}`;
  const table = pg ? `"${tableName}"` : `\`${tableName}\``;
  const spec = new RecordSpec({
    recordType: TaskSchema,
    idKind: "string",
    extractId: (task) => task.id?.value ?? "",
  });
  const factory = await Factory.newBuilder()
    .setOptions({ url: record.urls.spine_test })
    .setTableName(TaskSchema, tableName)
    .build();
  const storage = factory.createRecordStorage({ name: contextName, multitenant: false }, spec);
  const taskId = create(TaskIdSchema, { value: `task-${suffix}` });
  const taskListId = create(TaskListIdSchema, { value: `list-${suffix}` });
  const state = create(TaskSchema, { id: taskId, taskListId, title: "Diagnostic task" });
  const driver = pg
    ? new (providerRequire("pg").Client)({ connectionString: record.urls.spine_test })
    : await providerRequire("mysql2/promise").createConnection(record.urls.spine_test);
  if (pg) await driver.connect();
  let running;
  let internalFailure;
  let dispatchCalls = 0;
  try {
    await storage.write(state);
    await driver.query(`ALTER TABLE ${table} DROP COLUMN bytes`);
    const context = BoundedContext.singleTenant(contextName)
      .addCommandDispatcher({
        messageSchemas: () => [CreateTaskSchema],
        dispatch: async () => {
          dispatchCalls++;
          try {
            await storage.read(taskId.value);
          } catch (error) {
            internalFailure = error;
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
          actor: create(UserIdSchema, { value: "diagnostic-actor" }),
        }),
      }),
      message: AnyMessages.pack(
        CreateTaskSchema,
        create(CreateTaskSchema, { id: taskId, taskListId, title: "Diagnostic task" }),
      ),
    });
    const ack = await client.post(command, { timeoutMs: 5000 });
    assert.equal(AnyMessages.unpack(ack.messageId, CommandIdSchema).uuid, commandId);
    assert.equal(dispatchCalls, 1);
    assert.ok(
      internalFailure instanceof
        (adapters.PostgresStorageOperationError ?? adapters.MysqlStorageOperationError),
    );
    assert.ok(internalFailure.cause instanceof Error);
    const code = pg ? "42703" : "ER_BAD_FIELD_ERROR";
    assert.equal(internalFailure.cause.code, code);
    assert.equal(ack.status?.status.case, "error");
    assert.equal(ack.status.status.value.message, "Command post failed.");
    const wire = Buffer.from(toBinary(AckSchema, ack)).toString("utf8");
    for (const privateText of [
      tableName,
      record.urls.spine_test,
      internalFailure.cause.message,
      code,
    ])
      assert.equal(wire.includes(privateText), false);
    const matching = diagnostics.filter(
      ({ facts }) => facts.commandId === commandId && facts.operation === "command.post",
    );
    assert.equal(matching.length, 1);
    assert.equal(matching[0].facts.errorCode, code);
    assert.equal(matching[0].facts.contextName, contextName);
    assert.equal(matching[0].message, "Command post failed.");
    assert.equal(JSON.stringify(matching).includes(record.urls.spine_test), false);
    const malformed = clone(CommandSchema, command);
    malformed.id.uuid = `malformed-${suffix}`;
    malformed.message.value = new Uint8Array([0x0a, 0x80]);
    const validationAck = await client.post(malformed, { timeoutMs: 5000 });
    assert.equal(dispatchCalls, 1, "Malformed payload must not enter the dispatcher.");
    assert.equal(
      AnyMessages.unpack(validationAck.messageId, CommandIdSchema).uuid,
      malformed.id.uuid,
    );
    assert.equal(validationAck.status?.status.case, "error");
    assert.equal(validationAck.status.status.value.message, "Command payload validation failed.");
    assert.equal(
      diagnostics.filter(({ facts }) => facts.commandId === malformed.id.uuid).length,
      0,
    );
    process.stdout.write(
      `${JSON.stringify({
        provider: record.name,
        version: record.serverVersion,
        pid: process.pid,
        port: running.port,
        commandId,
        dispatchCalls,
        malformedPayload: {
          commandId: malformed.id.uuid,
          handlerCalls: 0,
          infrastructureDiagnostics: 0,
          publicMessage: validationAck.status.status.value.message,
        },
        providerErrorClass: internalFailure.constructor.name,
        originalCauseType: internalFailure.cause.name,
        originalDriverCode: code,
        diagnostic: matching[0],
        publicSafeError: ack.status.status.value.message,
        fault: "prepared-record-required-column-removed",
        status: "PASS",
      })}\n`,
    );
  } finally {
    try {
      if (running) await running.close();
    } finally {
      storage.close();
      factory.close();
      try {
        await driver.query(`DROP TABLE IF EXISTS ${table}`);
      } finally {
        await driver.end();
      }
    }
  }
}
