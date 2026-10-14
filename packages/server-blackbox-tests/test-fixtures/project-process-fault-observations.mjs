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
