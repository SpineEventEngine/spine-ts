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

import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { create, toBinary } from "@bufbuild/protobuf";
import { TypeUrls } from "@spine-event-engine/core";
import { EventIdSchema } from "@spine-event-engine/proto";
import { InboxMessageIdSchema } from "@spine-event-engine/proto/delivery";
import { expect, test } from "vitest";

import {
  PortfolioIdSchema,
  PortfolioStateSchema,
} from "../dist/generated/spine/server/testing/project_workflow_pb.js";
import { projectWorkflowIds } from "../dist/test-fixtures/project-workflow.js";
import { classifyCrashReplay } from "../test-fixtures/project-process-fault-observations.mjs";

const eventId = create(EventIdSchema, { value: randomUUID() });
const messageId = create(InboxMessageIdSchema, { uuid: randomUUID() });
const recipientTypeUrl = TypeUrls.derive(PortfolioStateSchema);
const recipientId = projectWorkflowIds("fault-observation", 1).portfolio;
const priorPids = [101, 102];
const freshPids = [201, 202];

function input() {
  const observation = {
    shards: [
      {
        shard: "0/2",
        count: 1,
        truncated: false,
        rows: [
          {
            messageId: messageId.uuid,
            signalId: eventId.value,
            targetTypeUrl: recipientTypeUrl,
            targetIdTypeUrl: TypeUrls.derive(PortfolioIdSchema),
            targetIdBase64: Buffer.from(toBinary(PortfolioIdSchema, recipientId)).toString(
              "base64",
            ),
            status: "TO_DELIVER",
          },
        ],
      },
      { shard: "1/2", count: 0, truncated: false, rows: [] },
      { shard: "0/1", count: 0, truncated: false, rows: [] },
    ],
  };
  return {
    preKillObservation: {
      shards: observation.shards.map((shard) => ({
        ...shard,
        rows: shard.rows.map((row) => ({ ...row })),
      })),
    },
    observation,
    shardCount: 2,
    entries: [
      {
        method: "portfolio",
        pid: 101,
        recipientTypeUrl: TypeUrls.derive(PortfolioIdSchema),
        recipientIdBase64: Buffer.from(toBinary(PortfolioIdSchema, recipientId)).toString("base64"),
      },
      {
        method: "portfolio",
        pid: 201,
        recipientTypeUrl: TypeUrls.derive(PortfolioIdSchema),
        recipientIdBase64: Buffer.from(toBinary(PortfolioIdSchema, recipientId)).toString("base64"),
      },
    ],
    method: "portfolio",
    recipientTypeUrl,
    originalEventId: eventId.value,
    priorPids,
    freshPids,
  };
}

test("a measured original pending row permits one old and one fresh recipient entry", () => {
  expect(classifyCrashReplay(input())).toEqual({
    method: "portfolio",
    pendingMessageId: messageId.uuid,
  });
  const single = input();
  single.entries.pop();
  expect(classifyCrashReplay(single)).toBeUndefined();
});

test.each([
  ["delivered row", (value) => (value.observation.shards[0].rows[0].status = "DELIVERED")],
  ["different Event", (value) => (value.observation.shards[0].rows[0].signalId = randomUUID())],
  ["different recipient", (value) => (value.observation.shards[0].rows[0].targetTypeUrl = "other")],
  [
    "different Inbox row",
    (value) => (value.observation.shards[0].rows[0].messageId = randomUUID()),
  ],
  [
    "different recipient ID",
    (value) => (value.observation.shards[0].rows[0].targetIdBase64 = "other"),
  ],
  ["different old handler ID", (value) => (value.entries[0].recipientIdBase64 = "other")],
  ["different fresh handler ID", (value) => (value.entries[1].recipientIdBase64 = "other")],
  ["different fresh handler ID type", (value) => (value.entries[1].recipientTypeUrl = "other")],
  [
    "a delivered and pending copy after the kill",
    (value) => {
      value.observation.shards[0].rows.push({
        ...value.observation.shards[0].rows[0],
        messageId: randomUUID(),
        status: "DELIVERED",
      });
      value.observation.shards[0].count++;
    },
  ],
  [
    "a delivered and pending copy before the kill",
    (value) => {
      value.preKillObservation.shards[0].rows.push({
        ...value.preKillObservation.shards[0].rows[0],
        messageId: randomUUID(),
        status: "DELIVERED",
      });
      value.preKillObservation.shards[0].count++;
    },
  ],
  [
    "prior delivered row",
    (value) => (value.preKillObservation.shards[0].rows[0].status = "DELIVERED"),
  ],
  ["wrong process", (value) => (value.entries[1].pid = 101)],
  ["third entry", (value) => value.entries.push({ method: "portfolio", pid: 202 })],
  ["missing shard", (value) => value.observation.shards.pop()],
  ["truncated shard", (value) => (value.observation.shards[0].truncated = true)],
])("rejects %s as proof of bounded crash replay", (_label, mutate) => {
  const value = input();
  mutate(value);
  expect(() => classifyCrashReplay(value)).toThrow();
});
