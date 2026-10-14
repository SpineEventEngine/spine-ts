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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
assert.equal(process.cwd(), root.replace(/\/$/, ""));
const evidenceDir = fileURLToPath(new URL("./", import.meta.url));
const runId = randomUUID().replaceAll("-", "");
const runDir = resolve(evidenceDir, `run-${runId}`);
await mkdir(runDir, { recursive: true });
await mkdir(resolve(evidenceDir, "runtime-tmp"), { recursive: true });
const artifacts = [];
async function load(path) {
  const absolute = resolve(root, path);
  const bytes = await readFile(absolute);
  artifacts.push({ path: absolute, sha256: createHash("sha256").update(bytes).digest("hex") });
  return import(pathToFileURL(absolute).href);
}
const require = createRequire(resolve(root, "packages/server/package.json"));
const { create, toBinary } = require("@bufbuild/protobuf");
const { createClient } = require("@connectrpc/connect");
const { createGrpcTransport } = require("@connectrpc/connect-node");
const core = await load("packages/core/dist/index.js");
const { AnyMessages, StringifierRegistry, TypeRegistry, TypeUrls } = core;
const server = await load("packages/server/dist/index.js");
await load("packages/server/dist/services/spine-services.js");
await load("packages/server/dist/context/bounded-context.js");
await load("packages/server/dist/repository/repository.js");
await load("packages/server/dist/delivery/inbox-storage.js");
await load("packages/server/dist/context/entity-inbox.js");
await load("packages/server/dist/context/local-inbox-handoff.js");
await load("packages/server/dist/bus/command-bus.js");
const { EnvironmentType, InboxStorage, Server, ServerEnvironment, ShardIndex } = server;
const { EventStore } = await load("packages/storage/dist/index.js");
await load("packages/storage/dist/event/event-store.js");
const proto = await load("packages/proto/dist/src/index.js");
const {
  AckSchema,
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  CommandSchema,
  EventSchema,
  UserIdSchema,
} = proto;
const { CommandService } = await load("packages/proto/dist/src/client/index.js");
const { InboxIdSchema, InboxMessageSchema } = await load(
  "packages/proto/dist/src/delivery/index.js",
);
const fixture = await load("packages/server-blackbox-tests/dist/test-fixtures/project-workflow.js");
const { projectWorkflow, projectWorkflowIds } = fixture;
const projectCommands = await load(
  "packages/server-blackbox-tests/dist/generated/spine/server/testing/project_commands_pb.js",
);
const projectEvents = await load(
  "packages/server-blackbox-tests/dist/generated/spine/server/testing/project_events_pb.js",
);
const projectWorkflowSchemas = await load(
  "packages/server-blackbox-tests/dist/generated/spine/server/testing/project_workflow_pb.js",
);
const { CreateProjectSchema } = projectCommands;
const { ProjectCreatedSchema } = projectEvents;
const {
  OrganizationIdSchema,
  PlanningIdSchema,
  PlanningStateSchema,
  PortfolioIdSchema,
  PortfolioStateSchema,
  ProjectIdSchema,
  ProjectProjectionStateSchema,
  ProjectStateSchema,
  StaffingIdSchema,
  StaffingStateSchema,
} = projectWorkflowSchemas;
const registry = JSON.parse(await readFile(new URL("../databases.json", import.meta.url), "utf8"));
const diagnostics = [];
const logger = (facts = {}) => ({
  child: (additional = {}) => logger({ ...facts, ...additional }),
  withMetadata: (additional = {}) => logger({ ...facts, ...additional }),
  error: (message) => diagnostics.push({ message, facts }),
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
});
ServerEnvironment.when(EnvironmentType.Local).use({ logger: logger() });
const results = [];
try {
  for (const record of registry.records) {
    const result = await verify(record);
    results.push(result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    assert.equal(result.cleanup.errors.length, 0, `${record.name} cleanup reported errors.`);
    assert.equal(result.cleanup.databaseDropped, true, `${record.name} database was not removed.`);
  }
  const summary = {
    runId,
    pid: process.pid,
    node: process.version,
    providers: results.map(({ provider, engineVersion }) => ({ provider, engineVersion })),
    artifacts,
    profile: {
      function: "orchestrator-dispatched mechanical verification",
      model: "gpt-6-luna",
      reasoning: "low",
      runtimeProfileIntrospection: "unavailable; immutable configured dispatch retained",
    },
    results,
    status: "PASS",
  };
  await writeFile(resolve(runDir, "result.json"), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ result: resolve(runDir, "result.json"), status: summary.status })}\n`,
  );
} catch (error) {
  await writeFile(
    resolve(runDir, "failure.json"),
    `${JSON.stringify({ runId, error: String(error), results, artifacts }, null, 2)}\n`,
  );
  throw error;
}

async function verify(record) {
  const postgres = record.engine === "postgres";
  const packageName = postgres ? "storage-postgres" : "storage-mysql";
  const providerRequire = createRequire(resolve(root, `packages/${packageName}/package.json`));
  const adapterPath = `packages/${packageName}/dist/index.js`;
  const adapter = await load(adapterPath);
  const factoryModulePath = postgres
    ? "packages/storage-postgres/dist/postgres/storage-factory.js"
    : "packages/storage-mysql/dist/mysql/storage-factory.js";
  await load(factoryModulePath);
  const Factory = adapter.PostgresStorageFactory ?? adapter.MysqlStorageFactory;
  const database = `sqlrel_admit_${runId.slice(0, 24)}`;
  const tableSuffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const inboxTable = `inbox_admit_${tableSuffix}`;
  const faultName = `fail_admit_${tableSuffix}`;
  const counterName = `admit_attempts_${tableSuffix}`;
  const contextName = `ProjectAdmission_${tableSuffix}`;
  const organization = `admit-${runId.slice(0, 12)}`;
  const sqlUrl = new URL(record.urls.spine_test);
  sqlUrl.pathname = `/${database}`;
  const adminUrl = record.adminUrl ?? record.urls.spine_test;
  let admin;
  let driver;
  const quotedDatabase = postgres ? `"${database}"` : `\`${database}\``;
  const quotedTable = postgres ? `"${inboxTable}"` : `\`${inboxTable}\``;
  const stringifiers = new StringifierRegistry();
  stringifiers.setTypeRegistry(
    new TypeRegistry([
      OrganizationIdSchema,
      ProjectIdSchema,
      PlanningIdSchema,
      StaffingIdSchema,
      PortfolioIdSchema,
      CreateProjectSchema,
      ProjectCreatedSchema,
      ProjectStateSchema,
      PlanningStateSchema,
      StaffingStateSchema,
      PortfolioStateSchema,
      ProjectProjectionStateSchema,
    ]),
  );
  const diagnosticsAtStart = diagnostics.length;
  const entries = [];
  const cleanupErrors = [];
  let databaseCreated = false;
  let driverConnected = false;
  let driverCreated = false;
  let adminConnected = false;
  let faultInstalled = false;
  let factory;
  let context;
  let running;
  let commandClient;
  let controlCommand;
  let rejectedCommand;
  let controlAck;
  let rejectedAck;
  let repairedAck;
  let triggerAttempts = 0;
  let controlState;
  let rejectedState;
  let repairedState;
  let controlEvents;
  let rejectedEvents;
  let repairedEvents;
  let commandBytes;
  let rejectedCommandBytes;
  let typedIdBytes;
  let inboxId;
  let diagnostic;
  const cleanupStatus = { errors: cleanupErrors, databaseDropped: false };
  const step = async (name, operation) => {
    try {
      await operation();
    } catch (error) {
      cleanupErrors.push({ step: name, error: String(error) });
    }
  };

  await writeFile(
    resolve(runDir, `${record.name}.resource.json`),
    `${JSON.stringify({ provider: record.name, database, contextName, inboxTable, faultName, counterName }, null, 2)}\n`,
  );
  process.stdout.write(
    `RESOURCE ${JSON.stringify({ provider: record.name, database, inboxTable })}\n`,
  );
  try {
    admin = postgres
      ? new (providerRequire("pg").Client)({
          connectionString: adminUrl,
          connectionTimeoutMillis: 5000,
        })
      : await providerRequire("mysql2/promise").createConnection(adminUrl);
    adminConnected = true;
    if (postgres) {
      await admin.connect();
    }
    await admin.query(`CREATE DATABASE ${quotedDatabase}`);
    databaseCreated = true;
    driver = postgres
      ? new (providerRequire("pg").Client)({
          connectionString: sqlUrl.href,
          connectionTimeoutMillis: 5000,
          statement_timeout: 5000,
        })
      : await providerRequire("mysql2/promise").createConnection(sqlUrl.href);
    driverCreated = true;
    if (postgres) {
      await driver.connect();
    }
    driverConnected = true;

    factory = await Factory.newBuilder()
      .setOptions({ url: sqlUrl.href })
      .setStringifierRegistry(stringifiers)
      .setTableName(InboxMessageSchema, inboxTable)
      .build();
    context = projectWorkflow(contextName, (entry) => entries.push({ ...entry }), factory, 1);
    running = await Server.atPort(0).add(context).start();
    commandClient = createClient(CommandService, createGrpcTransport({ baseUrl: running.baseUrl }));

    const ids = projectWorkflowIds(organization, 1);
    controlCommand = commandFor(ids.project, randomUUID(), "warm control");
    commandBytes = Buffer.from(toBinary(CommandSchema, controlCommand));
    controlAck = await commandClient.post(controlCommand, { timeoutMs: 10_000 });
    assertAckId(controlAck, controlCommand.id.uuid);
    assert.equal(controlAck.status?.status.case, "ok");
    controlState = await waitForProjectStates(context, ids);
    assert.ok(
      Object.values(controlState).every(Boolean),
      `Control CreateProject must reach all five states: ${JSON.stringify({ controlState, entries })}`,
    );
    controlEvents = await projectEventsFor(factory, contextName, organization, 1);
    assert.equal(
      controlEvents.length,
      1,
      "Control CreateProject must persist one ProjectCreated Event.",
    );
    const controlEntries = entries.filter((entry) => entry.correlation === `${organization}:1`);
    assert.deepEqual(controlEntries.map(({ method }) => method).sort(), [
      "create",
      "planning",
      "portfolio",
      "projection",
      "staffing",
    ]);

    const target = projectWorkflowIds(organization, 2);
    rejectedCommand = commandFor(target.project, randomUUID(), "faulted admission");
    rejectedCommandBytes = Buffer.from(toBinary(CommandSchema, rejectedCommand));
    typedIdBytes = Buffer.from(toBinary(ProjectIdSchema, target.project));
    inboxId = create(InboxIdSchema, {
      entityId: { id: AnyMessages.pack(ProjectIdSchema, target.project) },
      typeUrl: TypeUrls.derive(ProjectStateSchema),
    });
    const inboxIdString = stringifiers.forMessage(InboxIdSchema).toString(inboxId);
    const comparison = postgres
      ? `convert_from(decode('${Buffer.from(inboxIdString).toString("hex")}', 'hex'), 'UTF8')`
      : `CONVERT(UNHEX('${Buffer.from(inboxIdString).toString("hex")}') USING utf8mb4)`;
    faultInstalled = true;
    if (postgres) {
      await driver.query(`CREATE SEQUENCE "${counterName}"`);
      await driver.query(`CREATE FUNCTION "${faultName}"() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.inbox_id = ${comparison} THEN
            PERFORM nextval('${counterName}');
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'task injected Inbox admission failure';
          END IF;
          RETURN NEW;
        END $$`);
      await driver.query(`CREATE TRIGGER "${faultName}" BEFORE INSERT ON ${quotedTable}
        FOR EACH ROW EXECUTE FUNCTION "${faultName}"()`);
    } else {
      await driver.query(
        `CREATE TABLE \`${counterName}\` (id integer PRIMARY KEY, attempts integer NOT NULL) ENGINE=MyISAM`,
      );
      await driver.query(`INSERT INTO \`${counterName}\` VALUES (1, 0)`);
      await driver.query(`CREATE TRIGGER \`${faultName}\` BEFORE INSERT ON ${quotedTable} FOR EACH ROW
        BEGIN
          IF NEW.inbox_id = ${comparison} THEN
            UPDATE \`${counterName}\` SET attempts = attempts + 1 WHERE id = 1;
            SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 1644,
              MESSAGE_TEXT = 'task injected Inbox admission failure';
          END IF;
        END`);
    }
    rejectedAck = await commandClient.post(rejectedCommand, { timeoutMs: 10_000 });
    assertAckId(rejectedAck, rejectedCommand.id.uuid);
    assert.equal(rejectedAck.status?.status.case, "error");
    assert.equal(rejectedAck.status.status.value.message, "Command post failed.");
    assert.equal(rejectedAck.status.status.value.type, "COMMAND_POST_ERROR");
    const ackBytes = Buffer.from(toBinary(AckSchema, rejectedAck));
    for (const privateValue of [
      database,
      inboxTable,
      faultName,
      counterName,
      postgres ? "P0001" : "ER_SIGNAL_EXCEPTION",
      "task injected Inbox admission failure",
    ])
      assert.equal(
        ackBytes.includes(Buffer.from(privateValue)),
        false,
        "Public Ack must not expose SQL details.",
      );

    triggerAttempts = await readTriggerAttempts(driver, postgres, counterName);
    assert.equal(
      triggerAttempts,
      1,
      "The scoped SQL Inbox trigger must reject exactly one target admission.",
    );
    rejectedState = await inspectProject(context, target);
    assert.ok(Object.values(rejectedState).every((state) => state === false));
    rejectedEvents = await projectEventsFor(factory, contextName, organization, 2);
    assert.equal(rejectedEvents.length, 0, "Rejected command must not persist ProjectCreated.");
    const rejectedEntriesBeforeRetry = entries.filter(
      (entry) => entry.correlation === `${organization}:2`,
    );
    assert.equal(rejectedEntriesBeforeRetry.length, 0);
    const inbox = new InboxStorage({
      context: { name: contextName, multitenant: false },
      storageFactory: factory,
    });
    const inboxRowsAfterFault = await inbox.read(ShardIndex.single(), { limit: 100 });
    const targetRowsAfterFault = inboxRowsAfterFault.filter(
      (row) =>
        row.inboxId?.targetTypeUrl === TypeUrls.derive(ProjectStateSchema) &&
        Buffer.from(row.inboxId.targetId?.value ?? []).equals(typedIdBytes),
    );
    assert.equal(
      targetRowsAfterFault.length,
      0,
      "Failed Inbox admission must leave no target row.",
    );
    const correlated = diagnostics
      .slice(diagnosticsAtStart)
      .filter(
        ({ facts }) =>
          facts.commandId === rejectedCommand.id.uuid && facts.operation === "command.post",
      );
    assert.equal(correlated.length, 1, "Rejected command must produce one correlated diagnostic.");
    diagnostic = correlated[0];
    assert.equal(diagnostic.message, "Command post failed.");
    assert.equal(diagnostic.facts.contextName, contextName);
    assert.equal(diagnostic.facts.errorCode, postgres ? "P0001" : "ER_SIGNAL_EXCEPTION");
    assert.equal(JSON.stringify(correlated).includes(sqlUrl.href), false);

    await removeFault(driver, postgres, faultName, counterName, quotedTable);
    faultInstalled = false;
    repairedAck = await commandClient.post(rejectedCommand, { timeoutMs: 10_000 });
    assertAckId(repairedAck, rejectedCommand.id.uuid);
    assert.equal(repairedAck.status?.status.case, "ok");
    repairedState = await waitForProjectStates(context, target);
    assert.ok(
      Object.values(repairedState).every(Boolean),
      "Resubmitted command must create all five states.",
    );
    repairedEvents = await projectEventsFor(factory, contextName, organization, 2);
    assert.equal(
      repairedEvents.length,
      1,
      "Resubmitted Command ID must create exactly one ProjectCreated Event.",
    );
    const repairedEntries = entries.filter((entry) => entry.correlation === `${organization}:2`);
    assert.deepEqual(repairedEntries.map(({ method }) => method).sort(), [
      "create",
      "planning",
      "portfolio",
      "projection",
      "staffing",
    ]);
    assert.equal(
      entries.filter(
        (entry) => entry.method === "create" && entry.correlation === `${organization}:2`,
      ).length,
      1,
    );

    const inboxRows = await inbox.read(ShardIndex.single(), { limit: 100 });
    const targetRows = inboxRows.filter(
      (row) =>
        row.inboxId?.targetTypeUrl === TypeUrls.derive(ProjectStateSchema) &&
        Buffer.from(row.inboxId.targetId?.value ?? []).equals(typedIdBytes),
    );
    assert.equal(
      targetRows.length,
      1,
      "Only the successful retry may persist the target Inbox row.",
    );

    return {
      provider: record.name,
      engineVersion: record.serverVersion,
      database,
      contextName,
      inboxTable,
      port: running.port,
      pid: process.pid,
      commandIds: {
        control: controlCommand.id.uuid,
        rejectedAndResubmitted: rejectedCommand.id.uuid,
      },
      projectIds: {
        control: Buffer.from(toBinary(ProjectIdSchema, ids.project)).toString("base64"),
        rejectedAndResubmitted: typedIdBytes.toString("base64"),
        inboxTarget: Buffer.from(inboxIdString).toString("base64"),
      },
      commands: {
        controlBytesBase64: commandBytes.toString("base64"),
        rejectedBytesBase64: rejectedCommandBytes.toString("base64"),
      },
      acknowledgement: {
        rejectedStatus: rejectedAck.status.status.case,
        rejectedType: rejectedAck.status.status.value.type,
        rejectedMessage: rejectedAck.status.status.value.message,
        rejectedMessageId: AnyMessages.unpack(rejectedAck.messageId, CommandIdSchema).uuid,
        repairedStatus: repairedAck.status.status.case,
        repairedMessageId: AnyMessages.unpack(repairedAck.messageId, CommandIdSchema).uuid,
      },
      triggerAttempts,
      diagnostic,
      entries,
      handlerEntryCounts: {
        control: controlEntries.length,
        rejectedBeforeRetry: rejectedEntriesBeforeRetry.length,
        successfulRetry: repairedEntries.length,
      },
      states: {
        control: controlState,
        rejectedBeforeRetry: rejectedState,
        repaired: repairedState,
      },
      events: {
        control: controlEvents,
        rejectedBeforeRetry: rejectedEvents,
        repaired: repairedEvents,
      },
      inboxTargetRowsAfterRetry: targetRows.length,
      inboxTargetRowsAfterFault: targetRowsAfterFault.length,
      cleanup: cleanupStatus,
      status: "PASS",
    };
  } finally {
    if (faultInstalled && driverConnected) {
      await step("remove SQL Inbox trigger", () =>
        removeFault(driver, postgres, faultName, counterName, quotedTable),
      );
    }
    if (running !== undefined) await step("close server", () => running.close());
    if (factory !== undefined) await step("close storage factory", () => factory.close());
    if (driverCreated) await step("close task database connection", () => driver.end());
    if (databaseCreated && adminConnected) {
      await step("drop unique task database", async () => {
        if (postgres) {
          await admin.query(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
            [database],
          );
        }
        try {
          await admin.query(`DROP DATABASE ${quotedDatabase}`);
        } catch (error) {
          if (postgres) throw error;
          const [connections] = await admin.query(
            "SELECT id FROM information_schema.processlist WHERE db = ?",
            [database],
          );
          for (const { id } of connections) {
            try {
              await admin.query(`KILL ${Number(id)}`);
            } catch (killError) {
              if (killError.code !== "ER_NO_SUCH_THREAD" && killError.errno !== 1094)
                throw killError;
            }
          }
          await admin.query(`DROP DATABASE ${quotedDatabase}`);
        }
        const rows = postgres
          ? (await admin.query("SELECT datname FROM pg_database WHERE datname = $1", [database]))
              .rows
          : (
              await admin.query(
                "SELECT schema_name FROM information_schema.schemata WHERE schema_name = ?",
                [database],
              )
            )[0];
        assert.deepEqual(rows, [], "Unique task database still exists after cleanup.");
        cleanupStatus.databaseDropped = true;
      });
    }
    if (adminConnected) await step("close admin database connection", () => admin.end());
    if (diagnostics.length > diagnosticsAtStart)
      await writeFile(
        resolve(runDir, `${record.name}.diagnostics.json`),
        `${JSON.stringify(diagnostics.slice(diagnosticsAtStart), null, 2)}\n`,
      );
  }
}

function commandFor(project, commandId, name) {
  return create(CommandSchema, {
    id: create(CommandIdSchema, { uuid: commandId }),
    context: create(CommandContextSchema, {
      actorContext: create(ActorContextSchema, {
        actor: create(UserIdSchema, { value: "admission-probe-actor" }),
      }),
    }),
    message: AnyMessages.pack(CreateProjectSchema, create(CreateProjectSchema, { project, name })),
  });
}

function assertAckId(ack, expected) {
  assert.equal(AnyMessages.unpack(ack.messageId, CommandIdSchema).uuid, expected);
}

async function inspectProject(context, ids) {
  const [project, planning, staffing, portfolio, projection] = await Promise.all([
    context.stand().read(ProjectStateSchema, ids.project),
    context.stand().read(PlanningStateSchema, ids.planning),
    context.stand().read(StaffingStateSchema, ids.staffing),
    context.stand().read(PortfolioStateSchema, ids.portfolio),
    context.stand().read(ProjectProjectionStateSchema, ids.project),
  ]);
  return {
    project: project !== undefined,
    planning: planning !== undefined,
    staffing: staffing !== undefined,
    portfolio: portfolio !== undefined,
    projection: projection !== undefined,
  };
}

async function waitForProjectStates(context, ids) {
  const deadline = Date.now() + 5_000;
  let states;
  do {
    states = await inspectProject(context, ids);
    if (Object.values(states).every(Boolean)) return states;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  } while (Date.now() < deadline);
  return states;
}

async function projectEventsFor(factory, contextName, organization, number) {
  const store = new EventStore({ name: contextName, multitenant: false }, factory);
  try {
    const events = await store.read();
    return events
      .filter((event) => event.message?.typeUrl === TypeUrls.derive(ProjectCreatedSchema))
      .map((event) => {
        const payload = AnyMessages.unpack(event.message, ProjectCreatedSchema);
        const bytes = toBinary(EventSchema, event);
        return {
          eventId: event.id?.value,
          organization: payload.organization?.code,
          number: payload.project?.number,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytesBase64: Buffer.from(bytes).toString("base64"),
        };
      })
      .filter((event) => event.organization === organization && event.number === number);
  } finally {
    store.close();
  }
}

async function readTriggerAttempts(driver, postgres, counterName) {
  const response = await driver.query(
    postgres
      ? `SELECT last_value AS attempts FROM "${counterName}"`
      : `SELECT attempts FROM \`${counterName}\` WHERE id = 1`,
  );
  const rows = postgres ? response.rows : response[0];
  return Number(rows[0]?.attempts ?? 0);
}

async function removeFault(driver, postgres, faultName, counterName, quotedTable) {
  await driver.query(
    postgres
      ? `DROP TRIGGER IF EXISTS "${faultName}" ON ${quotedTable}`
      : `DROP TRIGGER IF EXISTS \`${faultName}\``,
  );
  if (postgres) {
    await driver.query(`DROP FUNCTION IF EXISTS "${faultName}"()`);
    await driver.query(`DROP SEQUENCE IF EXISTS "${counterName}"`);
  } else {
    await driver.query(`DROP TABLE IF EXISTS \`${counterName}\``);
  }
}
