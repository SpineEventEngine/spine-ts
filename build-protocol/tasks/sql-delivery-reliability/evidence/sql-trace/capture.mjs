#!/usr/bin/env node
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

/**
 * Bounded, task-local SQL capture wrapper. Prepared for later use; not part of CI.
 * Usage: TRACE_OPERATION=label node capture.mjs postgres16|postgres18|mysql84|mariadb114 -- <command> [args...]
 */
import { spawn, spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, URL } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const evidenceDir = resolve(scriptDir, "..");
const databases = JSON.parse(await readFile(resolve(evidenceDir, "databases.json"), "utf8"));
const selection = process.argv[2];
const divider = process.argv.indexOf("--");
const command = divider < 0 ? [] : process.argv.slice(divider + 1);
const record = databases.records.find((entry) => entry.name === selection);
const mysqlEngine = process.env.TRACE_MYSQL_ENGINE ?? "innodb";
const operation = process.env.TRACE_OPERATION;
const selectedDatabase = process.env.TRACE_DATABASE;
const idleDatabaseSelected = selectedDatabase !== undefined;
const markerBegin = "sqlrel_trace_warmup_begin";
const markerEnd = "sqlrel_trace_capture_end";
const markerDecoy = "sqlrel_trace_decoy_control";
if (record === undefined || divider < 0 || command.length === 0) {
  process.stderr.write(
    "Usage: capture.mjs postgres16|postgres18|mysql84|mariadb114 -- <command> [args...]\n",
  );
  process.exit(2);
}
if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(operation ?? ""))
  throw new Error("Set TRACE_OPERATION to a short alphanumeric operation label.");
if (idleDatabaseSelected && !/^sqlrel_idle_[a-f0-9]{32}$/.test(selectedDatabase))
  throw new Error("TRACE_DATABASE must be sqlrel_idle_<32 lowercase hexadecimal characters>.");
if (!["postgres16", "postgres18", "mysql84", "mariadb114"].includes(selection))
  throw new Error("Unsupported database selection.");
if (!["innodb", "myisam", ...(selection === "mariadb114" ? ["aria"] : [])].includes(mysqlEngine))
  throw new Error("TRACE_MYSQL_ENGINE must be innodb/myisam, or innodb/myisam/aria for MariaDB.");

const outputDir = resolve(evidenceDir, "sql-trace", "runs");
await mkdir(outputDir, { recursive: true });
const started = new Date();
const stamp = started.toISOString().replaceAll(":", "").replaceAll(".", "");
const rawPath = resolve(outputDir, `${selection}-${operation}-${stamp}.log`);
const metaPath = resolve(outputDir, `${selection}-${operation}-${stamp}.json`);
const maxWindowMs = 90_000;
const expectedMajor =
  selection === "postgres16" ? "16" : selection === "postgres18" ? "18" : undefined;
const targetName = record.containerName;
const targetId = record.containerId;
const requireFrom = (packageDir) => createRequire(resolve(packageDir, "package.json"));
const failures = [];
const restoreErrors = [];
let serverVersion;
let captureStart;
let captureEnd;
let result;
let exitCode = 1;
let rawLogWritten = false;
let pgSettingsToRestore = [];
let mysqlConn;
let previousLogOutput;
let mysqlLogOutputChanged = false;
let previousGeneralLog;
let mysqlGeneralLogChanged = false;
let markerVerification = null;
let interruptedSignal;
let activeStopGroup;

function onSignal(signal) {
  interruptedSignal ??= signal;
  activeStopGroup?.("SIGTERM");
}

function throwIfInterrupted() {
  if (interruptedSignal) throw new Error(`Capture interrupted by ${interruptedSignal}.`);
}

function sanitizeArg(arg) {
  return String(arg)
    .replace(/(mysql(?:2)?:\/\/)[^/@\s]+:[^/@\s]+@/gi, "$1[REDACTED]@")
    .replace(/(postgres(?:ql)?:\/\/)[^/@\s]+:[^/@\s]+@/gi, "$1[REDACTED]@");
}

function sanitizeCommand(args) {
  const safe = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (["--password", "-p", "--token", "--secret"].includes(arg)) {
      safe.push(arg);
      if (index + 1 < args.length) {
        safe.push("[REDACTED]");
        index += 1;
      }
      continue;
    }
    if (/^(--password|--token|--secret)=/i.test(arg)) {
      safe.push(`${arg.slice(0, arg.indexOf("="))}=[REDACTED]`);
      continue;
    }
    safe.push(/^-p.+/.test(arg) ? "-p[REDACTED]" : sanitizeArg(arg));
  }
  return safe;
}

function childDatabaseUrl(value, databaseName) {
  const url = new URL(value);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function runCommand(args, env) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(args[0], args.slice(1), {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
      detached: process.platform !== "win32",
    });
    let killTimer;
    let terminating = false;
    let finishEscalation;
    const escalated = new Promise((resolveEscalation) => {
      finishEscalation = resolveEscalation;
    });
    const stopGroup = (signal) => {
      try {
        if (process.platform !== "win32") process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if (error?.code !== "ESRCH") failures.push(`child ${signal}: ${String(error)}`);
      }
    };
    const terminate = (signal) => {
      terminating = true;
      stopGroup(signal);
      killTimer ??= setTimeout(() => {
        stopGroup("SIGKILL");
        finishEscalation();
      }, 2_000);
    };
    activeStopGroup = terminate;
    if (interruptedSignal) terminate("SIGTERM");
    const timeout = setTimeout(() => terminate("SIGTERM"), maxWindowMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      activeStopGroup = undefined;
      rejectPromise(error);
    });
    child.once("exit", async (code, signal) => {
      clearTimeout(timeout);
      if (!terminating) terminate("SIGTERM");
      await escalated;
      clearTimeout(killTimer);
      activeStopGroup = undefined;
      resolvePromise({
        code: interruptedSignal ? 128 + (interruptedSignal === "SIGINT" ? 2 : 15) : (code ?? 128),
        signal,
      });
    });
  });
}

function verifyContainer() {
  const inspect = spawnSync(
    "docker",
    ["inspect", "--format", "{{.Id}} {{.Name}} {{.State.Status}}", targetId],
    { encoding: "utf8" },
  );
  if (inspect.status !== 0) throw new Error("Exact task container inspect failed.");
  const [actualId, actualName, actualStatus] = inspect.stdout.trim().split(/\s+/);
  if (actualId !== targetId || actualName !== `/${targetName}` || actualStatus !== "running")
    throw new Error("Container identity/status does not match task evidence; refusing capture.");
}

async function runPostgres() {
  const { Pool } = requireFrom(resolve(process.cwd(), "packages/storage-postgres"))("pg");
  const url = new URL(record.urls.spine_test);
  const user = decodeURIComponent(url.username);
  const pool = new Pool({ connectionString: record.urls.spine_test, max: 1 });
  try {
    const version = await pool.query("SELECT version() AS version");
    throwIfInterrupted();
    serverVersion = version.rows[0]?.version;
    if (
      expectedMajor !== undefined &&
      !String(serverVersion).includes(`PostgreSQL ${expectedMajor}.`)
    )
      throw new Error(`Expected PostgreSQL ${expectedMajor}; got ${String(serverVersion)}`);
    const selectedExists = await pool.query(
      "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS present",
      [selectedDatabase ?? new URL(record.urls.spine_test).pathname.slice(1)],
    );
    if (!selectedExists.rows[0]?.present)
      throw new Error(`Selected database does not exist: ${selectedDatabase}`);
    const dbNames = idleDatabaseSelected
      ? [selectedDatabase]
      : [...new Set(Object.values(record.urls).map((value) => new URL(value).pathname.slice(1)))];
    for (const dbName of dbNames) {
      const prior = await pool.query(
        "SELECT setting FROM pg_db_role_setting s " +
          "CROSS JOIN LATERAL unnest(s.setconfig) AS cfg(setting) " +
          "WHERE s.setdatabase=(SELECT oid FROM pg_database WHERE datname=$1) " +
          "AND s.setrole=(SELECT oid FROM pg_roles WHERE rolname=$2) " +
          "AND cfg.setting LIKE 'log_statement=%'",
        [dbName, user],
      );
      throwIfInterrupted();
      const previous = prior.rows.map((row) => String(row.setting).slice("log_statement=".length));
      await pool.query(
        `ALTER ROLE "${user.replaceAll('"', '""')}" IN DATABASE "${dbName.replaceAll('"', '""')}" SET log_statement = 'all'`,
      );
      pgSettingsToRestore.push({ database: dbName, values: previous });
      throwIfInterrupted();
    }
    captureStart = new Date();
    const env = {
      ...process.env,
      SPINE_TS_POSTGRESQL_URL: idleDatabaseSelected
        ? childDatabaseUrl(record.urls.spine_test, selectedDatabase)
        : record.urls.spine_test,
      SPINE_TS_POSTGRESQL_TENANT_A_URL: idleDatabaseSelected
        ? childDatabaseUrl(record.urls.spine_test, selectedDatabase)
        : record.urls.spine_tenant_a,
      SPINE_TS_POSTGRESQL_TENANT_B_URL: idleDatabaseSelected
        ? childDatabaseUrl(record.urls.spine_test, selectedDatabase)
        : record.urls.spine_tenant_b,
      SPINE_TS_POSTGRESQL_EXPECTED_MAJOR: expectedMajor,
      TRACE_ENGINE: record.name,
      TRACE_SERVER_VERSION: serverVersion,
      TRACE_CONTAINER_ID: targetId,
      TRACE_OPERATION: operation,
      TRACE_SELECTED_DATABASE:
        selectedDatabase ?? new URL(record.urls.spine_test).pathname.slice(1),
      TRACE_MARKER_BEGIN: idleDatabaseSelected ? markerBegin : "",
      TRACE_MARKER_END: idleDatabaseSelected ? markerEnd : "",
      TRACE_MARKER_DECOY: idleDatabaseSelected ? markerDecoy : "",
    };
    try {
      result = await runCommand(command, env);
      exitCode = result.code;
    } catch (error) {
      failures.push(`command: ${String(error)}`);
      result = { code: 127 };
      exitCode = 127;
    }
  } finally {
    captureEnd = new Date();
    for (const { database: dbName, values } of pgSettingsToRestore.reverse()) {
      try {
        await pool.query(
          `ALTER ROLE "${user.replaceAll('"', '""')}" IN DATABASE "${dbName.replaceAll('"', '""')}" RESET log_statement`,
        );
        for (const value of values)
          await pool.query(
            `ALTER ROLE "${user.replaceAll('"', '""')}" IN DATABASE "${dbName.replaceAll('"', '""')}" SET log_statement = '${value.replaceAll("'", "''")}'`,
          );
      } catch (error) {
        restoreErrors.push(`${dbName}: ${String(error)}`);
      }
    }
    await pool.end();
  }
}

async function runMysql() {
  const mysql = requireFrom(resolve(process.cwd(), "packages/storage-mysql"))("mysql2/promise");
  mysqlConn = await mysql.createConnection({ uri: record.urls.spine_test, timezone: "Z" });
  try {
    const [versionRows] = await mysqlConn.query("SELECT VERSION() AS version");
    throwIfInterrupted();
    serverVersion = versionRows[0]?.version;
    if (!String(serverVersion).includes(selection === "mysql84" ? "8.4." : "11.4."))
      throw new Error(`Unexpected server version: ${String(serverVersion)}`);
    const selectedExists = await mysqlConn.query(
      "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME = BINARY ?",
      [selectedDatabase ?? new URL(record.urls.spine_test).pathname.slice(1)],
    );
    if (selectedExists[0].length === 0)
      throw new Error(`Selected database does not exist: ${selectedDatabase}`);
    const [settings] = await mysqlConn.query(
      "SELECT @@GLOBAL.general_log AS general_log, @@GLOBAL.log_output AS log_output",
    );
    throwIfInterrupted();
    previousGeneralLog = Number(settings[0]?.general_log);
    previousLogOutput = String(settings[0]?.log_output);
    if (previousGeneralLog !== 0)
      throw new Error(
        "general_log was already enabled; refusing to change preexisting capture state.",
      );
    await mysqlConn.query("SET time_zone = '+00:00'");
    throwIfInterrupted();
    await mysqlConn.query("SET GLOBAL log_output = 'TABLE'");
    mysqlLogOutputChanged = true;
    throwIfInterrupted();
    await mysqlConn.query("SET GLOBAL general_log = ON");
    mysqlGeneralLogChanged = true;
    throwIfInterrupted();
    captureStart = new Date();
    const selectedUrl = (value) =>
      idleDatabaseSelected ? childDatabaseUrl(record.urls.spine_test, selectedDatabase) : value;
    const env = {
      ...process.env,
      SPINE_TS_MYSQL_URL: selectedUrl(record.urls.spine_test),
      SPINE_TS_MYSQL_ADMIN_URL: idleDatabaseSelected
        ? childDatabaseUrl(record.adminUrl, selectedDatabase)
        : record.adminUrl,
      SPINE_TS_MYSQL_TENANT_A_URL: selectedUrl(record.urls.spine_tenant_a),
      SPINE_TS_MYSQL_TENANT_B_URL: selectedUrl(record.urls.spine_tenant_b),
      SPINE_TS_MYSQL_ENGINE: mysqlEngine,
      TRACE_ENGINE: record.name,
      TRACE_SERVER_VERSION: serverVersion,
      TRACE_CONTAINER_ID: targetId,
      TRACE_OPERATION: operation,
      TRACE_SELECTED_DATABASE:
        selectedDatabase ?? new URL(record.urls.spine_test).pathname.slice(1),
      TRACE_MARKER_BEGIN: idleDatabaseSelected ? markerBegin : "",
      TRACE_MARKER_END: idleDatabaseSelected ? markerEnd : "",
      TRACE_MARKER_DECOY: idleDatabaseSelected ? markerDecoy : "",
    };
    try {
      result = await runCommand(command, env);
      exitCode = result.code;
    } catch (error) {
      failures.push(`command: ${String(error)}`);
      result = { code: 127 };
      exitCode = 127;
    }
  } finally {
    captureEnd = new Date();
    if (mysqlGeneralLogChanged) {
      try {
        await mysqlConn.query("SET GLOBAL general_log = OFF");
      } catch (error) {
        restoreErrors.push(`general_log: ${String(error)}`);
      }
    }
    if (mysqlLogOutputChanged) {
      try {
        await mysqlConn.query(
          `SET GLOBAL log_output = '${previousLogOutput.replaceAll("'", "''")}'`,
        );
      } catch (error) {
        restoreErrors.push(`log_output: ${String(error)}`);
      }
    }
    if (captureStart && captureEnd) {
      try {
        const dbNames = idleDatabaseSelected
          ? [selectedDatabase]
          : [
              ...new Set(
                Object.values(record.urls).map((value) => new URL(value).pathname.slice(1)),
              ),
            ];
        const databaseFilter = dbNames.map(() => "LOCATE(?, argument) > 0").join(" OR ");
        const [rows] = await mysqlConn.query(
          "SELECT DATE_FORMAT(event_time, '%Y-%m-%dT%H:%i:%s.%fZ') AS event_time, " +
            "user_host, thread_id, server_id, command_type, HEX(argument) AS argument_hex FROM mysql.general_log " +
            "WHERE event_time >= ? AND event_time <= ? AND thread_id IN (SELECT DISTINCT thread_id FROM mysql.general_log " +
            `WHERE event_time >= ? AND event_time <= ? AND command_type='Connect' AND (${databaseFilter})) ORDER BY event_time, thread_id`,
          [
            captureStart.toISOString().replace("T", " ").replace("Z", ""),
            captureEnd.toISOString().replace("T", " ").replace("Z", ""),
            captureStart.toISOString().replace("T", " ").replace("Z", ""),
            captureEnd.toISOString().replace("T", " ").replace("Z", ""),
            ...dbNames.map((name) => ` on ${name} `),
          ],
        );
        const lines = rows.map((row) =>
          JSON.stringify({
            ...row,
            argument: Buffer.from(row.argument_hex, "hex").toString("latin1"),
          }),
        );
        await writeFile(rawPath, lines.join("\n") + "\n", {
          mode: 0o600,
        });
        rawLogWritten = true;
        if (idleDatabaseSelected) verifyMarkers(lines.join("\n"));
      } catch (error) {
        failures.push(`trace extraction: ${String(error)}`);
      }
    }
    await mysqlConn.end();
  }
}

function verifyMarkers(rawText) {
  markerVerification = {
    warmupMarkerCaptured: rawText.includes(markerBegin),
    endMarkerCaptured: rawText.includes(markerEnd),
    decoyDatabaseControlExcluded: !rawText.includes(markerDecoy),
  };
  if (Object.values(markerVerification).some((present) => !present))
    failures.push("Selected-database marker verification failed.");
}

try {
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  verifyContainer();
  throwIfInterrupted();
  if (record.engine === "postgres") await runPostgres();
  else await runMysql();
} catch (error) {
  failures.push(String(error));
  if (exitCode === 1) exitCode = 1;
} finally {
  if (interruptedSignal && !failures.some((failure) => failure.includes("interrupted")))
    failures.push(`Capture interrupted by ${interruptedSignal}.`);
  if (selection.startsWith("postgres") && captureStart && captureEnd) {
    const logs = spawnSync(
      "docker",
      [
        "logs",
        "--timestamps",
        "--since",
        captureStart.toISOString(),
        "--until",
        captureEnd.toISOString(),
        targetId,
      ],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    if (logs.status === 0) {
      await writeFile(rawPath, logs.stdout + logs.stderr, { mode: 0o600 });
      rawLogWritten = true;
      if (idleDatabaseSelected) verifyMarkers(logs.stdout + logs.stderr);
    } else failures.push("Could not read bounded logs from the exact PostgreSQL task container.");
  }
  const metadata = {
    operation,
    engine: record.name,
    serverVersion,
    containerName: targetName,
    containerId: targetId,
    selectedDatabase: selectedDatabase ?? new URL(record.urls.spine_test).pathname.slice(1),
    image: record.image,
    startedAt: captureStart?.toISOString() ?? null,
    endedAt: captureEnd?.toISOString() ?? null,
    command: sanitizeCommand(command),
    exitCode,
    interruptedSignal: interruptedSignal ?? null,
    rawLog: rawLogWritten ? rawPath : null,
    loggingRestored: restoreErrors.length === 0,
    restoreErrors,
    failures,
    markerVerification,
  };
  await writeFile(metaPath, JSON.stringify(metadata, null, 2) + "\n", { mode: 0o600 });
  process.stdout.write(
    `Trace capture ${restoreErrors.length === 0 ? "restored" : "RESTORE FAILED"}: ${metaPath}\n`,
  );
  process.removeListener("SIGINT", onSignal);
  process.removeListener("SIGTERM", onSignal);
  if (restoreErrors.length > 0) process.exitCode = 3;
  else if (failures.length > 0 && exitCode === 0) process.exitCode = 1;
  else process.exitCode = exitCode;
}
