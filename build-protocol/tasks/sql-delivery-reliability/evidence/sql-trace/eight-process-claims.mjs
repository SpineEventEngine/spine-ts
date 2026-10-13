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
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const file = fileURLToPath(import.meta.url);
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
assert.equal(process.cwd(), root.replace(/\/$/, ""));
const pgUrl = process.env.SPINE_TS_POSTGRESQL_URL;
const mysqlUrl = process.env.SPINE_TS_MYSQL_URL;
assert.ok(Boolean(pgUrl) !== Boolean(mysqlUrl), "Select exactly one provider.");
const provider = pgUrl ? "storage-postgres" : "storage-mysql";
const load = (path) => import(pathToFileURL(resolve(root, path)).href);

async function worker() {
  const require = createRequire(resolve(root, "packages", provider, "package.json"));
  const { create } = require("@bufbuild/protobuf");
  const { WorkerIdSchema, ShardIndexSchema } = await load(
    "packages/proto/dist/src/delivery/index.js",
  );
  const { ShardedWorkRegistry, shardSessionRecordSpec } = await load(
    "packages/server/dist/delivery/sharded-work-registry.js",
  );
  const { ShardIndex } = await load("packages/server/dist/delivery/shard-index.js");
  const adapters = await load(`packages/${provider}/dist/index.js`);
  const Factory = adapters.PostgresStorageFactory ?? adapters.MysqlStorageFactory;
  const prefix = process.argv[3];
  const slot = Number(process.argv[4]);
  const factory = await Factory.newBuilder()
    .setOptions({ url: pgUrl ?? mysqlUrl })
    .setTableName(shardSessionRecordSpec.sourceType, `${prefix}_sessions`)
    .build();
  const context = { name: prefix, multitenant: false };
  let now = 1000;
  const registry = new ShardedWorkRegistry({
    context,
    storageFactory: factory,
    leaseMs: 1000,
    now: () => new Date(now),
  });
  const records = factory.createRecordStorage(context, shardSessionRecordSpec);
  const id = create(ShardIndexSchema, { index: 0, ofTotal: 8 });
  await records.read(id);
  const held = new Map();
  let expected;
  let queue = Promise.resolve();
  async function execute(message) {
    now = message.now ?? now;
    if (message.action === "claim") {
      const workerId = create(WorkerIdSchema, {
        value: `${prefix}_${slot}_${message.phase}`,
        nodeId: { value: `${prefix}_node_${slot}` },
      });
      const session = await registry.pickUp(new ShardIndex(message.shard ?? 0, 8), workerId);
      if (session) held.set(message.phase, session);
      return { won: session !== undefined, worker: workerId.value };
    }
    if (message.action === "release")
      return { released: await registry.release(held.get(message.phase)) };
    if (message.action === "renew") {
      const session = await registry.renew(held.get(message.phase));
      if (session) held.set(message.phase, session);
      return { renewed: session !== undefined };
    }
    if (message.action === "prepare-delete") {
      expected = await records.read(id);
      assert.ok(expected);
      return { prepared: true };
    }
    if (message.action === "delete")
      return { deleted: await records.compareAndSet(id, expected, undefined) };
    if (message.action === "read-absent") return { absent: (await records.read(id)) === undefined };
    if (message.action === "close") {
      records.close();
      factory.close();
      return { closed: true };
    }
    throw new Error("Unknown worker action.");
  }
  process.on("message", (message) => {
    queue = queue.then(async () => {
      try {
        const result = await execute(message);
        process.send({ requestId: message.requestId, result, pid: process.pid });
        if (message.action === "close") process.disconnect();
      } catch (error) {
        process.send({ requestId: message.requestId, error: String(error), pid: process.pid });
      }
    });
  });
  process.send({ ready: true, pid: process.pid, slot });
}

async function parent() {
  const run = randomUUID().replaceAll("-", "");
  const prefix = `claims_${run}`;
  const children = [];
  const evidence = [];
  let sequence = 0;
  function start(slot) {
    const child = fork(file, ["worker", prefix, String(slot)], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    const entry = { child, slot, pending: new Map(), output: "", exited: false };
    children.push(entry);
    child.stdout.on("data", (chunk) => {
      entry.output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      entry.output += chunk.toString();
    });
    child.on("message", (message) => {
      const key = message.ready ? "ready" : message.requestId;
      const pending = entry.pending.get(key);
      if (!pending) return;
      entry.pending.delete(key);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message);
    });
    child.on("error", (error) => {
      for (const pending of entry.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      entry.pending.clear();
    });
    entry.exit = new Promise((resolveExit) =>
      child.once("exit", (code, signal) => {
        entry.exited = true;
        for (const pending of entry.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(new Error(`Child exited ${code}/${signal}: ${entry.output}`));
        }
        entry.pending.clear();
        resolveExit({ pid: child.pid, code, signal });
      }),
    );
    entry.ready = wait(entry, "ready");
    return entry;
  }
  function wait(entry, key) {
    return new Promise((resolveMessage, reject) => {
      const timer = setTimeout(() => {
        entry.pending.delete(key);
        reject(new Error(`Worker ${entry.slot} timed out: ${entry.output}`));
      }, 15000);
      entry.pending.set(key, { resolve: resolveMessage, reject, timer });
    });
  }
  async function request(entry, body) {
    const requestId = ++sequence;
    const result = wait(entry, requestId);
    entry.child.send({ ...body, requestId });
    const reply = await result;
    evidence.push({ slot: entry.slot, ...body, ...reply });
    return reply.result;
  }
  async function claims(phase, now) {
    const replies = await Promise.all(
      children.map((entry) => request(entry, { action: "claim", phase, now })),
    );
    const winners = replies.flatMap((reply, index) => (reply.won ? [index] : []));
    assert.equal(winners.length, 1, `${phase}: exactly one process acquires the same shard`);
    return winners[0];
  }
  try {
    for (let slot = 0; slot < 8; slot++) start(slot);
    const ready = await Promise.all(children.map((entry) => entry.ready));
    assert.equal(new Set(ready.map((message) => message.pid)).size, 8);
    const first = await claims("absent", 1000);
    const second = await claims("expired", 2000);
    assert.equal(
      (await request(children[first], { action: "renew", phase: "absent", now: 2000 })).renewed,
      false,
    );
    assert.equal(
      (await request(children[first], { action: "release", phase: "absent", now: 2000 })).released,
      false,
    );
    assert.equal(
      (await request(children[second], { action: "renew", phase: "expired", now: 2100 })).renewed,
      true,
    );
    assert.equal(
      (await request(children[second], { action: "release", phase: "expired", now: 2100 }))
        .released,
      true,
    );
    await claims("released", 2100);
    await Promise.all(children.map((entry) => request(entry, { action: "prepare-delete" })));
    const deleted = await Promise.all(
      children.map((entry) => request(entry, { action: "delete" })),
    );
    assert.equal(deleted.filter((reply) => reply.deleted).length, 1);
    const absent = await Promise.all(
      children.map((entry) => request(entry, { action: "read-absent" })),
    );
    assert.ok(absent.every((reply) => reply.absent));
    const shards = await Promise.all(
      children.map((entry) =>
        request(entry, { action: "claim", phase: "distinct-shards", now: 2200, shard: entry.slot }),
      ),
    );
    assert.equal(shards.filter((reply) => reply.won).length, 8);
    await Promise.all(children.map((entry) => request(entry, { action: "close" })));
    const exits = await Promise.all(children.map((entry) => entry.exit));
    assert.ok(exits.every(({ code, signal }) => code === 0 && signal === null));
    process.stdout.write(
      `${JSON.stringify({ run, provider, processCount: 8, shardCount: 8, pids: ready.map(({ pid }) => pid), evidence, exits, verified: true })}\n`,
    );
  } finally {
    for (const entry of children) if (!entry.exited) entry.child.kill("SIGTERM");
    const escalation = setTimeout(() => {
      for (const entry of children) if (!entry.exited) entry.child.kill("SIGKILL");
    }, 2000);
    await Promise.all(children.map((entry) => entry.exit));
    clearTimeout(escalation);
  }
}

if (process.argv[2] === "worker") await worker();
else await parent();
