/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const base = "build-protocol/tasks/sql-delivery-reliability/evidence/example-local-acceptance";
const parseLog = async (name) => {
  const text = await readFile(`${base}/${name}`, "utf8");
  const output = text.split("STDOUT_STDERR (merged):\n")[1]?.trim() ?? "";
  return {
    command: text.match(/^COMMAND: (.*)$/mu)?.[1] ?? null,
    exitCode: Number(text.match(/^EXIT_CODE: (\d+)$/mu)?.[1]),
    result: JSON.parse(output),
  };
};

const orders = await parseLog("orders-10-users.log");
const projects = await parseLog("projects-10-users.log");
const todo = JSON.parse(
  await readFile(`${base}/todo-local-modes-f9fdeb89-1edc-408d-82fc-67a2ef722087.json`, "utf8"),
);
const databases = JSON.parse(
  await readFile("build-protocol/tasks/sql-delivery-reliability/evidence/databases.json", "utf8"),
);
const artifactPaths = [
  "examples/orders/dist/scripts/load.mjs",
  "examples/projects/dist/scripts/load.mjs",
  "examples/todo/dist/src/single-process-app.js",
  "examples/todo/scripts/smoke.mjs",
];
const artifacts = {};
for (const path of artifactPaths) {
  artifacts[path] = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

const summary = {
  status: "PARTIAL_FAIL",
  scope:
    "Orders/Projects 10-user teaching workloads and Todo single-process memory/MySQL/PostgreSQL smoke workflows",
  configuredProfile: "orchestrator-dispatched mechanical function: gpt-6-luna / low",
  runtimeProfileIntrospection: "unavailable on this execution surface",
  runtime: { node: process.version, pnpm: "11.9.0", worktree: process.cwd() },
  commands: {
    orders: orders.command,
    projects: projects.command,
    todoHelper: todo.helperCommand,
    todoSmoke: todo.modes[0]?.smoke.command,
  },
  artifacts,
  orders: {
    requestedUsers: orders.result.users,
    processExitCode: orders.exitCode,
    failedUsers: orders.result.failedUsers,
    aggregateReportedCommandAcknowledgements: orders.result.commandAcknowledgements,
    aggregateReportedQueryVisibilities: orders.result.queryVisibilities,
    aggregateReportedSubscriptionDeliveries: orders.result.subscriptionDeliveries,
    diagnostic:
      "All ten failures identify the final subscription-correlation check. The runner reaches this check only after command POST/acknowledgement and query visibility, so each command was acknowledged and its query became visible. Ten updates arrived but none matched its requested order. The aggregate resets counts when the complete user flow rejects.",
  },
  projects: {
    requestedUsers: projects.result.users,
    processExitCode: projects.exitCode,
    failedUsers: projects.result.failedUsers,
    aggregateReportedCommandAcknowledgements: projects.result.commandAcknowledgements,
    aggregateReportedQueryVisibilities: projects.result.queryVisibilities,
    aggregateReportedSubscriptionDeliveries: projects.result.subscriptionDeliveries,
    diagnostic:
      "The public runner result reports all ten users failed but exposes no per-user stage or rejection. Exact command POST/acknowledgement count cannot be established from this output; zero is the aggregate count for fully completed user flows.",
  },
  todo: {
    status: todo.status,
    modes: todo.modes.map((mode) => ({
      name: mode.name,
      engine: mode.engine,
      engineVersion: mode.engineVersion,
      host: mode.host,
      portSelection: mode.portSelection,
      baseUrl: mode.baseUrl,
      database: mode.database ?? null,
      databaseEndpoint: mode.databaseEndpoint ?? null,
      databaseCreated: mode.databaseCreated ?? null,
      databaseDropped: mode.databaseDropped,
      commandsPosted: mode.commandsPosted,
      acknowledgement: mode.acknowledgement,
      queryVisible: mode.queryVisible,
      appClosed: mode.appClosed,
      adminClosed: mode.adminClosed ?? null,
      processExitCode: mode.exitCode,
      smoke: mode.smoke?.stdout.trim() ?? null,
    })),
  },
  databaseVersions: {
    mysql84: databases.records.find((record) => record.name === "mysql84").serverVersion,
    postgres16: databases.records.find((record) => record.name === "postgres16").serverVersion,
  },
  cleanup: {
    ordersAndProjects:
      "The load runners close their ephemeral in-memory servers in finally blocks; both processes exited 0.",
    todo: "All three Todo servers closed. Both UUID SQL databases were dropped and admin connections closed.",
  },
  firstTodoHelperAttempt:
    "Preserved separately. Memory and MySQL passed; PostgreSQL setup stopped before database creation because the registry adminUrl is null. The corrected helper used urls.spine_test and all three modes passed.",
  limitations: [
    "No builds, generation, installs, or example-source edits were performed.",
    "Orders and Projects did not produce all-green workflow results.",
    "No distributed Message Board or multi-process example was included in this assignment.",
  ],
};
await writeFile(`${base}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${base}/summary.json\n`);
