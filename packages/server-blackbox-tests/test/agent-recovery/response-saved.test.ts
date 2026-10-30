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
import { createConnection } from "mysql2/promise";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

interface RecoveryMessage {
  kind: string;
  result?: string;
  error?: string;
  stack?: string;
  state?: string;
  historyCount?: number;
  requests?: number;
  events?: number;
  calls?: number;
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

describe.each(providers)("$name live Agent interruption", (provider) => {
  it.each(["accepted", "response"])(
    "does not replay a %s interrupted turn and accepts a fresh signal",
    async (cut) => {
      if (!provider.ready) return;
      const unique = randomUUID().replaceAll("-", "").slice(0, 16);
      const context = `agent_interruption_${unique}`;
      const ticket = `INT-${unique}`;
      const scope = await isolatedScope(provider.key, unique);
      const first = new RecoveryChild(
        provider.key,
        "crash",
        context,
        ticket,
        cut,
        "",
        "",
        scope.environment,
      );
      let second: RecoveryChild | undefined;
      try {
        const barrier = await first.message(
          cut === "accepted" ? "receipt-saved" : "response-saved",
        );
        expect(barrier.error).toBeUndefined();
        expect((await first.kill()).signal).toBe("SIGKILL");
        second = new RecoveryChild(
          provider.key,
          "reopen",
          context,
          ticket,
          cut,
          "",
          "",
          scope.environment,
        );
        const reopened = await second.message("reopened");
        expect(reopened.state).toBeUndefined();
        expect(reopened.events).toBe(0);
        expect(reopened.requests).toBe(0);
        if (cut === "response") expect(reopened.historyCount).toBeGreaterThan(0);
        const fresh = await second.message("fresh-complete", 65_000);
        expect(fresh.state).toBe("A reviewer can help.");
        expect(fresh.requests).toBe(1);
        expect(fresh.calls).toBe(1);
        expect(fresh.historyCount).toBeGreaterThan(reopened.historyCount ?? 0);
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
