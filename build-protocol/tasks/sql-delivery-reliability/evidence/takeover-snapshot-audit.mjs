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
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { TypeUrls } from "../../../../packages/core/dist/index.js";
import { EventSchema } from "../../../../packages/proto/dist/src/index.js";
import {
  PlanningStateSchema,
  StaffingStateSchema,
} from "../../../../packages/server-blackbox-tests/dist/generated/spine/server/testing/project_workflow_pb.js";
import { completeInboxRows } from "../../../../packages/server-blackbox-tests/test-fixtures/project-process-fault-observations.mjs";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const evidence = resolve(root, "build-protocol/tasks/sql-delivery-reliability/evidence");
const providers = ["postgres16", "postgres18", "mysql84", "mariadb114"];
const audited = [];
for (const provider of providers) {
  for (const count of [2, 8]) {
    const path = resolve(evidence, `takeover-${provider}-p${count}-default-final1.log`);
    const lines = (await readFile(path, "utf8")).trim().split("\n");
    const result = JSON.parse(lines.at(-1));
    assert.equal(result.status, "PASS");
    const load = async (name) =>
      JSON.parse(await readFile(resolve(result.evidencePath, name), "utf8"));
    const pre = await load("pre-kill.json");
    const post = await load("post-kill.json");
    const stale = await load("before-stale.json");
    const original = pre.before.events.find((event) => event.id === result.originalEventId);
    assert.ok(original);
    const targetTypeUrl = TypeUrls.derive(
      result.selectedMethod === "planning" ? PlanningStateSchema : StaffingStateSchema,
    );
    const selected = pre.entry;
    const exact = (observation, label) => {
      const matches = completeInboxRows(observation, count).filter(
        (row) =>
          row.targetTypeUrl === targetTypeUrl &&
          row.targetIdTypeUrl === selected.recipientTypeUrl &&
          row.targetIdBase64 === selected.recipientIdBase64 &&
          row.signalId === original.id,
      );
      assert.equal(matches.length, 1, `${provider} p${count} ${label}: exact row count`);
      const row = matches[0];
      assert.equal(row.signalTypeUrl, TypeUrls.derive(EventSchema));
      assert.equal(row.signalValueSha256, original.sha256);
      assert.equal(row.status, "TO_DELIVER");
      assert.equal(row.messageId, pre.pending.messageId);
      return row;
    };
    exact(pre.preKillInbox, "pre-kill");
    exact(post.afterKill, "post-kill");
    exact(stale.inbox, "before-stale");
    audited.push({ provider, count, runId: result.runId, originalEventId: original.id });
  }
}
process.stdout.write(`${JSON.stringify({ status: "PASS", audited }, null, 2)}\n`);
