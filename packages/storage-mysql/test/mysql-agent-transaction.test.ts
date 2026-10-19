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

import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { MysqlAgentTransaction } from "../src/mysql/agent-transaction.js";

const tables = ["agent_execution", "agent_history"];

function driver(engines = ["InnoDB", "InnoDB"]) {
  const calls: string[] = [];
  const connection = {
    query: vi.fn(() => {
      calls.push("inspect");
      return Promise.resolve([engines.map((engine) => ({ engine })), []]);
    }),
    beginTransaction: vi.fn(() => {
      calls.push("begin");
      return Promise.resolve();
    }),
    commit: vi.fn(() => {
      calls.push("commit");
      return Promise.resolve();
    }),
    rollback: vi.fn(() => {
      calls.push("rollback");
      return Promise.resolve();
    }),
  };
  const acquire = vi.fn(() => Promise.resolve(connection as unknown as PoolConnection));
  const release = vi.fn((released: PoolConnection) => {
    expect(released).toBe(connection);
    calls.push("release");
  });
  return {
    transaction: new MysqlAgentTransaction({ acquire, release }),
    connection,
    calls,
    acquire,
    release,
  };
}

describe("MysqlAgentTransaction", () => {
  it("rejects a nontransactional Agent record table before running work", async () => {
    const scope = driver(["InnoDB", "MyISAM"]);
    const work = vi.fn(() => Promise.resolve("saved"));

    await expect(scope.transaction.commit(tables, work)).rejects.toThrow(
      "MySQL Agent execution requires transactional record tables.",
    );

    expect(scope.connection.query).toHaveBeenCalledWith(
      "SELECT engine AS engine FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN (?)",
      [tables],
    );
    expect(scope.calls).toEqual(["inspect", "release"]);
    expect(work).not.toHaveBeenCalled();
    expect(scope.acquire).toHaveBeenCalledOnce();
    expect(scope.release).toHaveBeenCalledOnce();
  });

  it.each(["work", "commit"] as const)(
    "rolls back and releases the connection after %s fails, preserving that error",
    async (failurePoint) => {
      const scope = driver();
      const failure = new Error(`${failurePoint} failed`);
      const work = vi.fn(() => {
        scope.calls.push("work");
        return failurePoint === "work" ? Promise.reject(failure) : Promise.resolve("saved");
      });
      if (failurePoint === "commit") {
        scope.connection.commit.mockImplementation(() => {
          scope.calls.push("commit");
          return Promise.reject(failure);
        });
      }
      scope.connection.rollback.mockImplementation(() => {
        scope.calls.push("rollback");
        return Promise.reject(new Error("rollback also failed"));
      });

      await expect(scope.transaction.commit(tables, work)).rejects.toBe(failure);

      expect(scope.calls).toEqual([
        "inspect",
        "begin",
        "work",
        ...(failurePoint === "commit" ? ["commit"] : []),
        "rollback",
        "release",
      ]);
      expect(work).toHaveBeenCalledOnce();
      expect(scope.acquire).toHaveBeenCalledOnce();
      expect(scope.release).toHaveBeenCalledOnce();
    },
  );

  it("retries one deadlock on the same connection and commits the second attempt", async () => {
    const scope = driver();
    const deadlock = Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK" });
    const work = vi.fn((connection: PoolConnection) => {
      expect(connection).toBe(scope.connection);
      scope.calls.push("work");
      return work.mock.calls.length === 1 ? Promise.reject(deadlock) : Promise.resolve("saved");
    });

    await expect(scope.transaction.commit(tables, work)).resolves.toBe("saved");

    expect(scope.calls).toEqual([
      "inspect",
      "begin",
      "work",
      "rollback",
      "begin",
      "work",
      "commit",
      "release",
    ]);
    expect(scope.acquire).toHaveBeenCalledOnce();
    expect(scope.release).toHaveBeenCalledOnce();
  });

  it("stops after the second deadlock and releases without a third attempt", async () => {
    const scope = driver();
    const first = Object.assign(new Error("first deadlock"), { code: "ER_LOCK_DEADLOCK" });
    const second = Object.assign(new Error("second deadlock"), { code: "ER_LOCK_DEADLOCK" });
    const work = vi.fn((connection: PoolConnection) => {
      expect(connection).toBe(scope.connection);
      scope.calls.push("work");
      return Promise.reject(work.mock.calls.length === 1 ? first : second);
    });

    await expect(scope.transaction.commit(tables, work)).rejects.toBe(second);

    expect(scope.calls).toEqual([
      "inspect",
      "begin",
      "work",
      "rollback",
      "begin",
      "work",
      "rollback",
      "release",
    ]);
    expect(work).toHaveBeenCalledTimes(2);
    expect(scope.acquire).toHaveBeenCalledOnce();
    expect(scope.release).toHaveBeenCalledOnce();
  });
});
