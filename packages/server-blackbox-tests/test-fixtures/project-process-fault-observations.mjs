/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the
 * License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
 * express or implied. See the License for the specific language governing permissions and limitations
 * under the License.
 */

import assert from "node:assert/strict";

export function completeInboxRows(observation, shardCount) {
  assert.ok(Number.isSafeInteger(shardCount) && shardCount > 0);
  assert.ok(Array.isArray(observation?.shards), "Inbox shard observations are required.");
  const expected = Array.from({ length: shardCount }, (_, index) => `${index}/${shardCount}`);
  if (shardCount !== 1) expected.push("0/1");
  assert.deepEqual(
    observation.shards.map((shard) => shard.shard).sort(),
    expected.sort(),
    "Every expected Inbox shard must be observed exactly once.",
  );
  return observation.shards.flatMap((shard) => {
    assert.equal(shard.error, undefined, `Inbox shard ${shard.shard}: ${shard.error}`);
    assert.equal(shard.truncated, false, `Inbox shard ${shard.shard} was truncated.`);
    assert.ok(Array.isArray(shard.rows), `Inbox shard ${shard.shard} has no rows array.`);
    assert.equal(shard.count, shard.rows.length);
    for (const row of shard.rows) {
      assert.ok(typeof row.messageId === "string" && row.messageId.length > 0);
      assert.ok(typeof row.signalId === "string" && row.signalId.length > 0);
      assert.ok(typeof row.status === "string" && row.status.length > 0);
    }
    return shard.rows;
  });
}

export function classifyCrashReplay({
  preKillObservation,
  observation,
  shardCount,
  entries,
  method,
  recipientTypeUrl,
  originalEventId,
  priorPids,
  freshPids,
}) {
  const priorRows = completeInboxRows(preKillObservation, shardCount);
  const rows = completeInboxRows(observation, shardCount);
  const matching = entries.filter((entry) => entry.method === method);
  assert.ok(
    matching.length === 1 || matching.length === 2,
    `${method} entered an unexpected number of times.`,
  );
  if (matching.length === 1) return undefined;
  assert.equal(matching.filter((entry) => priorPids.includes(entry.pid)).length, 1);
  assert.equal(matching.filter((entry) => freshPids.includes(entry.pid)).length, 1);
  const recipient = matching[0];
  assert.ok(
    typeof recipient.recipientTypeUrl === "string" && recipient.recipientTypeUrl.length > 0,
  );
  assert.ok(
    typeof recipient.recipientIdBase64 === "string" && recipient.recipientIdBase64.length > 0,
  );
  for (const entry of matching) {
    assert.equal(entry.recipientTypeUrl, recipient.recipientTypeUrl);
    assert.equal(entry.recipientIdBase64, recipient.recipientIdBase64);
  }
  const exactRecipient = (row) =>
    row.targetTypeUrl === recipientTypeUrl &&
    row.signalId === originalEventId &&
    row.targetIdTypeUrl === recipient.recipientTypeUrl &&
    row.targetIdBase64 === recipient.recipientIdBase64;
  const after = rows.filter((row) => exactRecipient(row));
  const prior = priorRows.filter(exactRecipient);
  assert.equal(
    prior.length,
    1,
    `${method} replay requires one original Inbox row before the kill.`,
  );
  assert.equal(after.length, 1, `${method} replay requires one original Inbox row after the kill.`);
  assert.equal(prior[0].status, "TO_DELIVER");
  assert.equal(after[0].status, "TO_DELIVER");
  assert.equal(
    after[0].messageId,
    prior[0].messageId,
    `${method} replay must retain the exact Inbox row.`,
  );
  return { method, pendingMessageId: after[0].messageId };
}
