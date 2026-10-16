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

import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { fromBinary } from "@bufbuild/protobuf";
import { AnyMessages } from "@spine-event-engine/core";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { createConnection } from "mysql2/promise";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
// prettier-ignore
import {
  SupportDraftProjectionStateSchema as DraftStateSchema,
} from "../../generated/spine/server/testing/support_recovery_states_pb.js";
import { startToolEndpoint } from "./tool-endpoint.js";

interface RecoveryMessage {
  kind: string;
  result?: string;
  reply?: string;
  error?: string;
  operation?: string;
  physicalRequests?: number;
  state?: string;
  projection?: string;
  version?: number;
  events?: string[];
  operations?: string[];
  historyCount?: number;
  readSnapshots?: number;
  inboxHash?: string;
  inboxIdBytes?: string;
  inboxStatus?: number;
  recordStatus?: number;
  acceptedActor?: string;
  acceptedTenant?: string;
  keyBytes?: string;
  uncertainAttempts?: number;
  reservedOutputBytes?: string;
  toolIntents?: {
    effect?: number;
    dispatched: boolean;
    outcomeUnknown: boolean;
    hasResponse: boolean;
  }[];
  protocolCalls?: {
    method: string;
    settled: boolean;
    reservedBytes: string;
  }[];
  outgoing?: {
    kind: string;
    id?: string;
    delivered: boolean;
    targets?: { kind: number; fingerprint: string }[];
  }[];
  systemOriginalId?: string;
  systemStoredId?: string;
  systemEqual?: boolean;
  terminationReason?: string;
  unresolvedAttempts?: number;
  unresolvedToolCalls?: number;
  message?: string;
}

interface RecoveryScope {
  readonly environment: NodeJS.ProcessEnv;
  close(): Promise<void>;
}

async function postgresScope(unique: string): Promise<RecoveryScope> {
  const url = process.env.SPINE_TS_POSTGRESQL_URL;
  if (!url) throw new Error("PostgreSQL recovery URL is required.");
  const schema = `agent_recovery_${unique}`;
  const admin = new Pool({ connectionString: url });
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
  } finally {
    await admin.end();
  }
  return {
    environment: { SPINE_TS_POSTGRESQL_SCHEMA: schema },
    close: async () => {
      const cleanup = new Pool({ connectionString: url });
      try {
        await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

async function persistedExecutionBytes(schema: string): Promise<readonly Buffer[]> {
  const url = process.env.SPINE_TS_POSTGRESQL_URL;
  if (!url || !/^agent_recovery_[a-f0-9]{16}$/.test(schema))
    throw new Error("Execution proof requires an isolated PostgreSQL schema.");
  const pool = new Pool({ connectionString: url });
  try {
    const rows = await pool.query<{ bytes: Buffer }>(
      `SELECT "bytes" FROM "${schema}"."agent_execution_agentexecutionrecord" ORDER BY "ID"`,
    );
    return rows.rows.map((row) => row.bytes);
  } finally {
    await pool.end();
  }
}

async function mysqlScope(unique: string): Promise<RecoveryScope> {
  const url = process.env.SPINE_TS_MYSQL_URL;
  if (!url) throw new Error("MySQL recovery URL is required.");
  const database = `agent_recovery_${unique}`;
  const admin = await createConnection(url);
  try {
    await admin.query(`CREATE DATABASE \`${database}\``);
  } finally {
    await admin.end();
  }
  const isolated = new URL(url);
  isolated.pathname = `/${database}`;
  return {
    environment: { SPINE_TS_MYSQL_URL: isolated.toString() },
    close: async () => {
      const cleanup = await createConnection(url);
      try {
        await cleanup.query(`DROP DATABASE \`${database}\``);
      } finally {
        await cleanup.end();
      }
    },
  };
}

async function isolatedScope(provider: string, unique: string): Promise<RecoveryScope> {
  if (provider === "postgres") return postgresScope(unique);
  if (provider === "mysql") return mysqlScope(unique);
  if (provider === "datastore")
    return {
      environment: { SPINE_TS_DATASTORE_PROJECT: `spine-agent-recovery-${unique}` },
      close: () => Promise.resolve(),
    };
  throw new Error(`Unknown recovery provider: ${provider}.`);
}

async function persistedDraftProjection(
  schema: string,
  ticket: string,
): Promise<{ reply: string; version: number } | undefined> {
  const url = process.env.SPINE_TS_POSTGRESQL_URL;
  if (!url || !/^agent_recovery_[a-f0-9]{16}$/.test(schema))
    throw new Error("Projection proof requires an isolated PostgreSQL schema.");
  const pool = new Pool({ connectionString: url });
  try {
    const tables = await pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname=$1 ORDER BY tablename",
      [schema],
    );
    const table = tables.rows.find((row) => row.tablename.includes("supportdraftprojectionstate"));
    if (!table) return undefined;
    const rows = await pool.query<{ bytes: Buffer }>(
      `SELECT "bytes" FROM "${schema}"."${table.tablename}"`,
    );
    const record = rows.rows[0]?.bytes
      ? fromBinary(EntityRecordSchema, rows.rows[0].bytes)
      : undefined;
    const state = record?.state ? AnyMessages.unpack(record.state, DraftStateSchema) : undefined;
    if (state?.id?.ticketNumber !== ticket) return undefined;
    return { reply: state.proposedReply, version: record?.version?.number ?? 0 };
  } finally {
    await pool.end();
  }
}

async function waitForDraftProjection(
  schema: string,
  ticket: string,
): Promise<{ reply: string; version: number }> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const projected = await persistedDraftProjection(schema, ticket);
    if (projected) return projected;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("First fan-out recipient did not persist the support draft.");
}

class RecoveryChild {
  readonly process: ChildProcess;
  readonly #messages: RecoveryMessage[] = [];
  readonly #waiters = new Map<string, (message: RecoveryMessage) => void>();
  readonly #exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  #stderr = "";

  constructor(
    provider: string,
    mode: string,
    context: string,
    ticket: string,
    cut = "response",
    expectedKey = "",
    expectedInbox = "",
    environment: NodeJS.ProcessEnv = {},
  ) {
    this.process = fork(
      fileURLToPath(new URL("./recovery-child.mjs", import.meta.url)),
      [provider, mode, context, ticket, cut, expectedKey, expectedInbox],
      {
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        env: { ...process.env, ...environment },
      },
    );
    this.process.stderr?.on("data", (chunk: Buffer) => {
      this.#stderr = (this.#stderr + chunk.toString()).slice(-16_000);
    });
    this.process.on("message", (candidate: unknown) => {
      this.receive(candidate);
    });
    this.#exit = new Promise((resolve) => {
      this.process.once("exit", (code, signal) => {
        resolve({ code, signal });
      });
    });
  }

  private receive(candidate: unknown): void {
    if (typeof candidate !== "object" || candidate === null || !("kind" in candidate)) return;
    const message = candidate as RecoveryMessage;
    this.#messages.push(message);
    this.#waiters.get(message.kind)?.(message);
    this.#waiters.delete(message.kind);
  }

  async message(kind: string, timeoutMs = 20_000): Promise<RecoveryMessage> {
    const existing = this.#messages.find((message) => message.kind === kind);
    if (existing !== undefined) return existing;
    return new Promise<RecoveryMessage>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          new Error(
            `${kind} not reached; messages=${JSON.stringify(this.#messages)}; stderr=${this.#stderr}`,
          ),
        );
      }, timeoutMs);
      this.#waiters.set(kind, (message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(message);
      });
      void this.#exit.then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(
          new Error(
            `Child exited before ${kind}; messages=${JSON.stringify(this.#messages)}; stderr=${this.#stderr}`,
          ),
        );
      });
    });
  }

  async kill(): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    this.process.kill("SIGKILL");
    return this.#exit;
  }

  async exit(): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return this.#exit;
  }
}

const providers = [
  { name: "PostgreSQL", key: "postgres", ready: process.env.SPINE_TS_POSTGRESQL_URL !== undefined },
  { name: "MySQL", key: "mysql", ready: process.env.SPINE_TS_MYSQL_URL !== undefined },
  {
    name: "Datastore emulator",
    key: "datastore",
    ready:
      process.env.DATASTORE_EMULATOR_HOST !== undefined &&
      process.env.SPINE_TS_DATASTORE_PROJECT !== undefined,
  },
] as const;

describe.each(providers)("$name Agent response-saved process recovery", (provider) => {
  it.skipIf(!provider.ready)(
    "reuses the persisted response after SIGKILL without a second model request",
    async () => {
      const unique = randomUUID().replaceAll("-", "").slice(0, 16);
      const context = `agent_recovery_${unique}`;
      const ticket = `REC-${unique}`;
      const scope = await isolatedScope(provider.key, unique);
      const first = new RecoveryChild(
        provider.key,
        "crash",
        context,
        ticket,
        "response",
        "",
        "",
        scope.environment,
      );
      let second: RecoveryChild | undefined;
      try {
        const admitted = await first.message("admitted");
        expect(admitted.result, admitted.error).toBe("ok");
        const saved = await first.message("response-saved");
        expect(saved.physicalRequests).toBe(1);
        expect(saved.operation).toBeTruthy();
        expect((await first.kill()).signal).toBe("SIGKILL");

        second = new RecoveryChild(
          provider.key,
          "recover",
          context,
          ticket,
          "response",
          "",
          "",
          scope.environment,
        );
        expect((await second.message("recovery-start")).historyCount).toBeGreaterThan(0);
        const recovered = await second.message("recovered", 65_000);
        expect(recovered.state).toBe("A reviewer can help.");
        expect(recovered.version).toBe(1);
        expect(recovered.events).toEqual(["A reviewer can help."]);
        expect(recovered.operations).toContain(saved.operation);
        expect(recovered.historyCount).toBeGreaterThan(0);
        expect(recovered.physicalRequests).toBe(0);
        expect((await second.exit()).code).toBe(0);
      } finally {
        if (first.process.exitCode === null && first.process.signalCode === null)
          await first.kill();
        if (second?.process.exitCode === null && second.process.signalCode === null)
          await second.kill();
        await scope.close();
      }
    },
    80_000,
  );
});

describe("PostgreSQL Agent actor and tenant recovery", () => {
  it.skipIf(!process.env.SPINE_TS_POSTGRESQL_URL)(
    "retains the original actor and tenant when a saved response resumes",
    async () => {
      const unique = randomUUID().replaceAll("-", "").slice(0, 16);
      const context = `agent_tenant_${unique}`;
      const ticket = `TEN-${unique}`;
      const scope = await isolatedScope("postgres", unique);
      const first = new RecoveryChild(
        "postgres",
        "crash",
        context,
        ticket,
        "tenant-response",
        "",
        "",
        scope.environment,
      );
      let second: RecoveryChild | undefined;
      try {
        expect((await first.message("admitted")).result).toBe("ok");
        let saved: RecoveryMessage;
        try {
          saved = await first.message("response-saved");
        } catch (error) {
          first.process.send({ kind: "probe-tenant" });
          const probe = await first.message("tenant-probe");
          throw new Error(`${String(error)}; nativeProbe=${JSON.stringify(probe)}`);
        }
        expect(saved.acceptedActor).toBe("reviewer-a");
        expect(saved.acceptedTenant).toBe("tenant-a");
        expect(saved.keyBytes).toBeTruthy();
        expect((await first.kill()).signal).toBe("SIGKILL");

        second = new RecoveryChild(
          "postgres",
          "recover",
          context,
          ticket,
          "tenant-response",
          saved.keyBytes,
          "",
          scope.environment,
        );
        const recovered = await second.message("recovered", 65_000);
        expect(recovered.acceptedActor).toBe("reviewer-a");
        expect(recovered.acceptedTenant).toBe("tenant-a");
        expect(recovered.state).toBe("A reviewer can help.");
        expect(recovered.version).toBe(1);
        expect(recovered.events).toEqual(["A reviewer can help."]);
        expect(recovered.physicalRequests).toBe(0);
        expect((await second.exit()).code).toBe(0);
      } finally {
        if (first.process.exitCode === null && first.process.signalCode === null)
          await first.kill();
        if (second?.process.exitCode === null && second.process.signalCode === null)
          await second.kill();
        await scope.close();
      }
    },
    80_000,
  );
});

describe.each(providers)("$name Agent admission process recovery", (provider) => {
  it.skipIf(!provider.ready)(
    "discovers persisted Inbox work after SIGKILL before execution",
    async () => {
      const unique = randomUUID().replaceAll("-", "").slice(0, 16);
      const context = `agent_admission_${unique}`;
      const ticket = `ADM-${unique}`;
      const scope = await isolatedScope(provider.key, unique);
      const first = new RecoveryChild(
        provider.key,
        "crash",
        context,
        ticket,
        "admission",
        "",
        "",
        scope.environment,
      );
      let second: RecoveryChild | undefined;
      try {
        const stored = await first.message("admission-saved");
        expect(stored.result).toBe("persisted");
        expect(stored.physicalRequests).toBe(0);
        expect(stored.inboxHash).toBeTruthy();
        expect((await first.kill()).signal).toBe("SIGKILL");

        second = new RecoveryChild(
          provider.key,
          "recover",
          context,
          ticket,
          "admission",
          "",
          stored.inboxIdBytes,
          scope.environment,
        );
        const recovered = await second.message("recovered", 65_000);
        expect(recovered.state).toBe("A reviewer can help.");
        expect(recovered.version).toBe(1);
        expect(recovered.events).toEqual(["A reviewer can help."]);
        expect(recovered.physicalRequests).toBe(1);
        expect((await second.exit()).code).toBe(0);
      } finally {
        if (first.process.exitCode === null && first.process.signalCode === null)
          await first.kill();
        if (second?.process.exitCode === null && second.process.signalCode === null)
          await second.kill();
        await scope.close();
      }
    },
    80_000,
  );
});

describe.each(providers)("$name Agent completion process recovery", (provider) => {
  it.skipIf(!provider.ready)(
    "delivers committed output after SIGKILL before acknowledgement",
    async () => {
      const unique = randomUUID().replaceAll("-", "").slice(0, 16);
      const context = `agent_completion_${unique}`;
      const ticket = `COM-${unique}`;
      const scope = await isolatedScope(provider.key, unique);
      const first = new RecoveryChild(
        provider.key,
        "crash",
        context,
        ticket,
        "complete",
        "",
        "",
        scope.environment,
      );
      let second: RecoveryChild | undefined;
      try {
        expect((await first.message("admitted")).result).toBe("ok");
        const completed = await first.message("completion-saved");
        expect(completed.result).toBe("persisted");
        expect(completed.physicalRequests).toBe(1);
        expect((await first.kill()).signal).toBe("SIGKILL");

        second = new RecoveryChild(
          provider.key,
          "recover",
          context,
          ticket,
          "complete",
          "",
          "",
          scope.environment,
        );
        const recovered = await second.message("recovered", 65_000);
        expect(recovered.state).toBe("A reviewer can help.");
        expect(recovered.version).toBe(1);
        expect(recovered.events).toEqual(["A reviewer can help."]);
        expect(recovered.physicalRequests).toBe(0);
        expect((await second.exit()).code).toBe(0);
      } finally {
        if (first.process.exitCode === null && first.process.signalCode === null)
          await first.kill();
        if (second?.process.exitCode === null && second.process.signalCode === null)
          await second.kill();
        await scope.close();
      }
    },
    80_000,
  );
});

describe.skipIf(process.env.SPINE_TS_POSTGRESQL_URL === undefined)(
  "PostgreSQL Agent partial fan-out process recovery",
  () => {
    it("retains the first recipient and resumes the second after SIGKILL", async () => {
      const unique = randomUUID().replaceAll("-", "").slice(0, 16);
      const context = `agent_fanout_${unique}`;
      const ticket = `FAN-${unique}`;
      const scope = await isolatedScope("postgres", unique);
      const first = new RecoveryChild(
        "postgres",
        "crash",
        context,
        ticket,
        "fanout",
        "",
        "",
        scope.environment,
      );
      let second: RecoveryChild | undefined;
      try {
        expect((await first.message("admitted")).result).toBe("ok");
        const firstReceipt = await first.message("first-recipient-delivered", 65_000);
        expect(firstReceipt.reply).toBe("A reviewer can help.");
        const entered = await first.message("second-recipient-entered", 65_000);
        expect(entered.reply).toBe(firstReceipt.reply);
        first.process.send({ kind: "probe-fanout" });
        const saved = await first.message("fanout-saved");
        expect(saved.recordStatus).toBe(3);
        expect(saved.keyBytes).toBeTruthy();
        expect(saved.outgoing).toHaveLength(1);
        const original = saved.outgoing?.[0];
        expect(original?.kind).toBe("event");
        expect(original?.id).toBeTruthy();
        expect(original?.delivered).toBe(false);
        expect(original?.targets).toHaveLength(2);
        for (const target of original?.targets ?? []) expect(target.fingerprint).toBeTruthy();
        expect((await first.kill()).signal).toBe("SIGKILL");

        second = new RecoveryChild(
          "postgres",
          "recover",
          context,
          ticket,
          "fanout",
          saved.keyBytes,
          "",
          scope.environment,
        );
        const delivered = await second.message("second-recipient-delivered", 65_000);
        expect(delivered.reply).toBe(firstReceipt.reply);
        const recovered = await second.message("recovered", 65_000);
        expect(recovered.state).toBe("A reviewer can help.");
        expect(recovered.version).toBe(1);
        expect(recovered.events).toEqual(["A reviewer can help."]);
        expect(recovered.physicalRequests).toBe(0);
        expect(recovered.outgoing?.[0]?.id).toBe(saved.outgoing?.[0]?.id);
        expect(recovered.outgoing?.[0]?.targets).toEqual(saved.outgoing?.[0]?.targets);
        const schema = scope.environment.SPINE_TS_POSTGRESQL_SCHEMA;
        if (!schema) throw new Error("PostgreSQL schema was not supplied to the recovery test.");
        expect(await waitForDraftProjection(schema, ticket)).toEqual({
          reply: "A reviewer can help.",
          version: 1,
        });
        expect((await second.exit()).code).toBe(0);
      } finally {
        if (first.process.exitCode === null && first.process.signalCode === null)
          await first.kill();
        if (second?.process.exitCode === null && second.process.signalCode === null)
          await second.kill();
        await scope.close();
      }
    }, 90_000);
  },
);

describe.skipIf(process.env.SPINE_TS_POSTGRESQL_URL === undefined)(
  "PostgreSQL Agent changed-registration process recovery",
  () => {
    it("rejects a missing generated recipient without changing saved work", async () => {
      const unique = randomUUID().replaceAll("-", "").slice(0, 16);
      const context = `agent_binding_${unique}`;
      const ticket = `BND-${unique}`;
      const scope = await isolatedScope("postgres", unique);
      const schema = scope.environment.SPINE_TS_POSTGRESQL_SCHEMA;
      if (!schema) throw new Error("PostgreSQL schema was not supplied to the recovery test.");
      const first = new RecoveryChild(
        "postgres",
        "crash",
        context,
        ticket,
        "complete",
        "",
        "",
        scope.environment,
      );
      let blocked: RecoveryChild | undefined;
      let restored: RecoveryChild | undefined;
      try {
        expect((await first.message("admitted")).result).toBe("ok");
        expect((await first.message("completion-saved")).result).toBe("persisted");
        expect((await first.kill()).signal).toBe("SIGKILL");
        const before = await persistedExecutionBytes(schema);
        expect(before).toHaveLength(1);

        blocked = new RecoveryChild(
          "postgres",
          "missing-receiver",
          context,
          ticket,
          "complete",
          "",
          "",
          scope.environment,
        );
        const rejected = await blocked.message("fatal");
        expect(rejected.message).toContain(
          "Generated standalone receiver SupportDraftObserver has no explicitly registered instance",
        );
        expect(await persistedExecutionBytes(schema)).toEqual(before);

        restored = new RecoveryChild(
          "postgres",
          "recover",
          context,
          ticket,
          "complete",
          "",
          "",
          scope.environment,
        );
        const recovered = await restored.message("recovered", 65_000);
        expect(recovered.state).toBe("A reviewer can help.");
        expect(recovered.version).toBe(1);
        expect(recovered.events).toEqual(["A reviewer can help."]);
        expect(recovered.physicalRequests).toBe(0);
        expect((await restored.exit()).code).toBe(0);
      } finally {
        if (first.process.exitCode === null && first.process.signalCode === null)
          await first.kill();
        if (blocked?.process.exitCode === null && blocked.process.signalCode === null)
          await blocked.kill();
        if (restored?.process.exitCode === null && restored.process.signalCode === null)
          await restored.kill();
        await scope.close();
      }
    }, 90_000);
  },
);

describe.each(providers)("$name Agent write-tool process recovery", (provider) => {
  it.skipIf(!provider.ready)(
    "retains a dispatched write intent without sending the tool a second time",
    async () => {
      const unique = randomUUID().replaceAll("-", "").slice(0, 16);
      const context = `agent_write_${unique}`;
      const ticket = `WRT-${unique}`;
      const scope = await isolatedScope(provider.key, unique);
      const endpoint = await startToolEndpoint();
      const environment = {
        ...scope.environment,
        SPINE_TS_RECOVERY_ENDPOINT: endpoint.base,
      };
      const first = new RecoveryChild(
        provider.key,
        "crash",
        context,
        ticket,
        "tool-write",
        "",
        "",
        environment,
      );
      let second: RecoveryChild | undefined;
      try {
        expect((await first.message("admitted")).result).toBe("ok");
        const accepted = await first.message("execution-admitted");
        expect(accepted.keyBytes).toBeTruthy();
        await endpoint.waitForWrite();
        expect(endpoint.providerRequests).toBe(1);
        expect(endpoint.writeCalls).toBe(1);
        first.process.send({ kind: "probe-tool" });
        const saved = await first.message("tool-journal");
        expect(saved.toolIntents).toEqual([
          expect.objectContaining({ dispatched: true, hasResponse: false }),
        ]);
        expect(saved.protocolCalls).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ method: "tools/call", settled: false }),
          ]),
        );
        expect((await first.kill()).signal).toBe("SIGKILL");

        second = new RecoveryChild(
          provider.key,
          "recover",
          context,
          ticket,
          "tool-write",
          accepted.keyBytes,
          "",
          environment,
        );
        let terminal: RecoveryMessage;
        try {
          terminal = await second.message("tool-unknown-terminated", 65_000);
        } catch (error) {
          throw new Error(
            `${String(error)}; providerRequests=${String(endpoint.providerRequests)}; ` +
              `writeCalls=${String(endpoint.writeCalls)}`,
          );
        }
        expect(terminal.recordStatus).toBe(5);
        expect(terminal.version).toBe(0);
        expect(terminal.events).toEqual([]);
        expect(terminal.terminationReason).toBe("TOOL_OUTCOME_UNKNOWN");
        expect(terminal.unresolvedToolCalls).toBe(1);
        expect(terminal.systemOriginalId).toBeTruthy();
        expect(terminal.systemStoredId).toBe(terminal.systemOriginalId);
        expect(terminal.systemEqual).toBe(true);
        expect(endpoint.writeCalls).toBe(1);
        expect(endpoint.providerRequests).toBe(1);
        expect((await second.exit()).code).toBe(0);
      } finally {
        if (first.process.exitCode === null && first.process.signalCode === null)
          await first.kill();
        if (second?.process.exitCode === null && second.process.signalCode === null)
          await second.kill();
        await endpoint.close();
        await scope.close();
      }
    },
    85_000,
  );
});

describe.skipIf(process.env.SPINE_TS_POSTGRESQL_URL === undefined)(
  "PostgreSQL Agent saved read process recovery",
  () => {
    it("reuses the original Projection read and completed lookup tool result", async () => {
      const unique = randomUUID().replaceAll("-", "").slice(0, 16);
      const context = `agent_lookup_${unique}`;
      const ticket = `LKP-${unique}`;
      const scope = await isolatedScope("postgres", unique);
      const endpoint = await startToolEndpoint("read");
      const environment = { ...scope.environment, SPINE_TS_RECOVERY_ENDPOINT: endpoint.base };
      const first = new RecoveryChild(
        "postgres",
        "crash",
        context,
        ticket,
        "tool-read",
        "",
        "",
        environment,
      );
      let revised: RecoveryChild | undefined;
      let second: RecoveryChild | undefined;
      try {
        expect((await first.message("admitted")).result).toBe("ok");
        const saved = await first.message("tool-result-saved", 65_000);
        expect(saved.keyBytes).toBeTruthy();
        expect(saved.readSnapshots).toBe(1);
        expect(saved.toolIntents).toEqual([
          expect.objectContaining({ dispatched: true, hasResponse: true }),
        ]);
        expect(endpoint.providerRequests).toBe(1);
        expect(endpoint.readCalls).toBe(1);
        expect((await first.kill()).signal).toBe("SIGKILL");

        revised = new RecoveryChild(
          "postgres",
          "revise-projection",
          context,
          ticket,
          "tool-read",
          "",
          "",
          environment,
        );
        expect((await revised.message("projection-revised")).reply).toBe("Revised draft");
        expect((await revised.exit()).code).toBe(0);

        second = new RecoveryChild(
          "postgres",
          "recover",
          context,
          ticket,
          "tool-read",
          saved.keyBytes,
          "",
          environment,
        );
        let recovered: RecoveryMessage;
        try {
          recovered = await second.message("recovered", 65_000);
        } catch (error) {
          throw new Error(
            `${String(error)}; providerRequests=${String(endpoint.providerRequests)}; ` +
              `readCalls=${String(endpoint.readCalls)}`,
          );
        }
        expect(recovered.state).toBe("Ticket found; we can help. Earlier draft: Original draft");
        expect(recovered.events).toEqual([recovered.state]);
        expect(recovered.version).toBe(1);
        expect(recovered.readSnapshots).toBe(1);
        expect(recovered.toolIntents).toEqual([
          expect.objectContaining({ dispatched: true, hasResponse: true }),
        ]);
        expect(endpoint.providerRequests).toBe(2);
        expect(endpoint.readCalls).toBe(1);
        expect(endpoint.writeCalls).toBe(0);
        expect((await second.exit()).code).toBe(0);
      } finally {
        if (first.process.exitCode === null && first.process.signalCode === null)
          await first.kill();
        if (revised?.process.exitCode === null && revised.process.signalCode === null)
          await revised.kill();
        if (second?.process.exitCode === null && second.process.signalCode === null)
          await second.kill();
        await endpoint.close();
        await scope.close();
      }
    }, 95_000);
  },
);

describe.skipIf(process.env.SPINE_TS_POSTGRESQL_URL === undefined)(
  "PostgreSQL Agent dispatched-request process recovery",
  () => {
    it("retains uncertain request credit without sending the model again", async () => {
      const unique = randomUUID().replaceAll("-", "").slice(0, 16);
      const context = `agent_dispatched_${unique}`;
      const ticket = `DSP-${unique}`;
      const scope = await isolatedScope("postgres", unique);
      const first = new RecoveryChild(
        "postgres",
        "crash",
        context,
        ticket,
        "dispatched",
        "",
        "",
        scope.environment,
      );
      let second: RecoveryChild | undefined;
      try {
        expect((await first.message("admitted")).result).toBe("ok");
        const dispatched = await first.message("request-dispatched");
        expect(dispatched.physicalRequests).toBe(1);
        expect(dispatched.uncertainAttempts).toBe(1);
        expect(BigInt(dispatched.reservedOutputBytes ?? "0")).toBeGreaterThan(0n);
        expect(dispatched.keyBytes).toBeTruthy();
        expect((await first.kill()).signal).toBe("SIGKILL");

        second = new RecoveryChild(
          "postgres",
          "recover",
          context,
          ticket,
          "dispatched",
          dispatched.keyBytes,
          "",
          scope.environment,
        );
        const terminal = await second.message("uncertain-terminated", 65_000);
        expect(terminal.recordStatus).toBe(5);
        expect(terminal.uncertainAttempts).toBe(1);
        expect(terminal.reservedOutputBytes).toBe(dispatched.reservedOutputBytes);
        expect(terminal.version).toBe(0);
        expect(terminal.events).toEqual([]);
        expect(terminal.terminationReason).toBe("MODEL_OUTCOME_UNKNOWN");
        expect(terminal.unresolvedAttempts).toBe(1);
        expect(terminal.systemOriginalId).toBeTruthy();
        expect(terminal.systemStoredId).toBe(terminal.systemOriginalId);
        expect(terminal.systemEqual).toBe(true);
        expect(terminal.physicalRequests).toBe(0);
        expect((await second.exit()).code).toBe(0);
      } finally {
        if (first.process.exitCode === null && first.process.signalCode === null)
          await first.kill();
        if (second?.process.exitCode === null && second.process.signalCode === null)
          await second.kill();
        await scope.close();
      }
    }, 80_000);
  },
);

describe.skipIf(process.env.SPINE_TS_POSTGRESQL_URL === undefined)(
  "PostgreSQL Agent execution admission process recovery",
  () => {
    it("discovers a persisted Agent invocation after SIGKILL", async () => {
      const unique = randomUUID().replaceAll("-", "").slice(0, 16);
      const context = `agent_execution_admission_${unique}`;
      const ticket = `EXA-${unique}`;
      const scope = await isolatedScope("postgres", unique);
      const first = new RecoveryChild(
        "postgres",
        "crash",
        context,
        ticket,
        "execution-admit",
        "",
        "",
        scope.environment,
      );
      let second: RecoveryChild | undefined;
      try {
        const stored = await first.message("execution-admission-saved");
        expect(stored.result).toBe("persisted");
        expect(stored.physicalRequests).toBe(0);
        expect(stored.keyBytes).toBeTruthy();
        expect((await first.kill()).signal).toBe("SIGKILL");

        second = new RecoveryChild(
          "postgres",
          "recover",
          context,
          ticket,
          "execution-admit",
          stored.keyBytes,
          stored.inboxIdBytes,
          scope.environment,
        );
        const recovered = await second.message("recovered", 65_000);
        expect(recovered.state).toBe("A reviewer can help.");
        expect(recovered.version).toBe(1);
        expect(recovered.events).toEqual(["A reviewer can help."]);
        expect(recovered.physicalRequests).toBe(1);
        expect((await second.exit()).code).toBe(0);
      } finally {
        if (first.process.exitCode === null && first.process.signalCode === null)
          await first.kill();
        if (second?.process.exitCode === null && second.process.signalCode === null)
          await second.kill();
        await scope.close();
      }
    }, 80_000);
  },
);
