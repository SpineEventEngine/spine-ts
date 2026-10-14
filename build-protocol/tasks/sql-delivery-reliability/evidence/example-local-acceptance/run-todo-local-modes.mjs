/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import process from "node:process";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { startTodoServer } from "../../../../../examples/todo/dist/src/single-process-app.js";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const evidenceDir = fileURLToPath(new URL("./", import.meta.url));
const outputPath = resolve(evidenceDir, `todo-local-modes-${randomUUID()}.json`);
const logPath = outputPath.replace(/\.json$/u, ".log");
const requireFrom = (packagePath) => createRequire(resolve(root, packagePath));
const pg = requireFrom("packages/storage-postgres/package.json")("pg");
const mysql = requireFrom("packages/storage-mysql/package.json")("mysql2/promise");
const dbRegistry = JSON.parse(
  await readFile(
    resolve(root, "build-protocol/tasks/sql-delivery-reliability/evidence/databases.json"),
    "utf8",
  ),
);
const runtimeTmp = resolve(
  root,
  "build-protocol/tasks/sql-delivery-reliability/evidence/runtime-tmp",
);
const record = {
  status: "RUNNING",
  startedAt: new Date().toISOString(),
  scriptPid: process.pid,
  configuredProfile: "orchestrator-dispatched mechanical function: gpt-6-luna / low",
  runtimeProfileIntrospection: "unavailable on this execution surface",
  helperCommand: `TMPDIR=${runtimeTmp} node build-protocol/tasks/sql-delivery-reliability/evidence/example-local-acceptance/run-todo-local-modes.mjs`,
  modes: [],
};
const log = [];
let failure;

async function writeEvidence() {
  record.finishedAt = new Date().toISOString();
  record.status = failure
    ? "FAIL"
    : record.modes.length === 3 && record.modes.every((mode) => mode.status === "PASS")
      ? "PASS"
      : "FAIL";
  if (failure)
    record.failure = { name: failure.name, message: failure.message, stack: failure.stack };
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`);
  await writeFile(logPath, `${log.join("\n")}\n`);
}

try {
  await runMode({ name: "memory", provider: undefined });
  await runMode({
    name: "mysql",
    provider: dbRegistry.records.find((item) => item.name === "mysql84"),
  });
  await runMode({
    name: "postgresql",
    provider: dbRegistry.records.find((item) => item.name === "postgres16"),
  });
} catch (error) {
  failure = error instanceof Error ? error : new Error(String(error));
} finally {
  await writeEvidence();
}
globalThis.console.log(
  JSON.stringify({
    result: record.status,
    outputPath,
    logPath,
    modeResults: record.modes.map((mode) => ({
      mode: mode.name,
      status: mode.status,
      commandsPosted: mode.commandsPosted,
      queryVisible: mode.queryVisible,
      databaseDropped: mode.databaseDropped ?? null,
    })),
  }),
);
if (failure || record.status !== "PASS") process.exitCode = 1;

async function runMode({ name, provider }) {
  const mode = {
    name,
    startedAt: new Date().toISOString(),
    engine: provider?.engine ?? "in-memory",
    engineVersion: provider?.serverVersion ?? null,
    host: "127.0.0.1",
    portSelection: "0 (OS-assigned loopback port)",
    smokeCommand: "node examples/todo/scripts/smoke.mjs",
    commandsPosted: 1,
    acknowledgement: false,
    queryVisible: false,
    databaseDropped: null,
    status: "RUNNING",
  };
  let admin;
  let databaseCreated = false;
  let server;
  try {
    const env = process.env;
    env.TODO_STORAGE = name;
    delete env.TODO_MYSQL_URL;
    delete env.TODO_POSTGRESQL_URL;
    if (provider !== undefined) {
      mode.database = `todo_example_${randomUUID().replaceAll("-", "")}`;
      const adminUrl = provider.adminUrl ?? provider.urls.spine_test;
      const targetUrl = new URL(adminUrl);
      targetUrl.pathname = `/${mode.database}`;
      mode.databaseEndpoint = `${targetUrl.protocol}//${targetUrl.hostname}:${targetUrl.port}/${mode.database}`;
      const postgres = provider.engine === "postgres";
      const quoted = postgres ? `"${mode.database}"` : `\`${mode.database}\``;
      admin = postgres
        ? new pg.Client({ connectionString: adminUrl })
        : await mysql.createConnection(adminUrl);
      if (postgres) await admin.connect();
      await admin.query(`CREATE DATABASE ${quoted}`);
      databaseCreated = true;
      if (postgres) env.TODO_POSTGRESQL_URL = targetUrl.href;
      else env.TODO_MYSQL_URL = targetUrl.href;
      mode.databaseCreated = true;
    }

    server = await startTodoServer({ host: "127.0.0.1", port: 0 });
    mode.baseUrl = server.baseUrl;
    const smoke = await runSmoke(server.baseUrl);
    mode.smoke = smoke;
    mode.acknowledgement = smoke.exitCode === 0 && smoke.stdout.includes("to-do smoke ok:");
    mode.queryVisible = mode.acknowledgement;
    mode.exitCode = smoke.exitCode;
    mode.status = mode.acknowledgement && mode.queryVisible ? "PASS" : "FAIL";
    log.push(
      `${name}: endpoint=${server.baseUrl} database=${mode.database ?? "none"} exit=${smoke.exitCode}`,
    );
    log.push(`${name} smoke stdout: ${smoke.stdout.trim()}`);
    if (smoke.stderr.trim() !== "") log.push(`${name} smoke stderr: ${smoke.stderr.trim()}`);
    if (mode.status !== "PASS")
      throw new Error(`${name} Todo smoke failed (exit ${smoke.exitCode}).`);
  } catch (error) {
    mode.status = "FAIL";
    mode.error = { name: error.name, message: error.message };
    throw error;
  } finally {
    if (server !== undefined) {
      try {
        await bounded(server.close(), 10_000, `${name} app close`);
        mode.appClosed = true;
      } catch (error) {
        mode.appClosed = false;
        mode.cleanupError = String(error);
        failure ??= error;
      }
    }
    if (admin !== undefined) {
      try {
        const postgres = provider.engine === "postgres";
        const quoted = postgres ? `"${mode.database}"` : `\`${mode.database}\``;
        if (databaseCreated) {
          await admin.query(`DROP DATABASE ${quoted}`);
          mode.databaseDropped = true;
        }
      } catch (error) {
        mode.databaseDropped = false;
        mode.cleanupError = `${mode.cleanupError ?? ""} database cleanup: ${String(error)}`.trim();
        failure ??= error;
      } finally {
        try {
          if (provider.engine === "postgres") await admin.end();
          else await admin.end();
          mode.adminClosed = true;
        } catch (error) {
          mode.adminClosed = false;
          mode.cleanupError = `${mode.cleanupError ?? ""} admin close: ${String(error)}`.trim();
          failure ??= error;
        }
      }
    }
    mode.finishedAt = new Date().toISOString();
    record.modes.push(mode);
    await writeEvidence();
  }
}

function bounded(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      globalThis.setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}

function runSmoke(baseUrl) {
  return new Promise((resolveResult, reject) => {
    const command = process.execPath;
    const args = [resolve(root, "examples/todo/scripts/smoke.mjs")];
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, TMPDIR: runtimeTmp, SPINE_TODO_BASE_URL: baseUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = globalThis.setTimeout(() => child.kill("SIGTERM"), 20_000);
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      globalThis.clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      globalThis.clearTimeout(timeout);
      resolveResult({ command: [command, ...args], exitCode: code, signal, stdout, stderr });
    });
  });
}
