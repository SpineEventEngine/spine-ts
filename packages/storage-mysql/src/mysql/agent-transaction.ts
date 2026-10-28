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

import type { PoolConnection, RowDataPacket } from "mysql2/promise";

/**
 * Coordinates native MySQL Agent execution transactions.
 */
export class MysqlAgentTransaction {
  // prettier-ignore

  /**
   * Creates an Agent execution transaction helper.
   *
   * @param connections Acquires and releases MySQL connections.
   */
  constructor(
    private readonly connections: {
      acquire(): Promise<PoolConnection>;
      release(connection: PoolConnection): void;
    },
  ) {}

  /**
   * Commits one fenced Agent mutation in a native transaction.
   *
   * @param tables Lists participating physical tables.
   * @param work Performs the connection-bound mutation.
   * @typeParam T The mutation result type.
   * @returns Returns the work result.
   */
  async commit<T>(
    tables: readonly string[],
    work: (connection: PoolConnection) => Promise<T>,
  ): Promise<T> {
    const connection = await this.connections.acquire();
    try {
      const transactional = await this.allTransactional(connection, tables);
      if (!transactional)
        throw new Error("MySQL Agent execution requires transactional record tables.");
      return await this.commitTransaction(connection, work);
    } finally {
      this.connections.release(connection);
    }
  }

  /**
   * Checks every declared live Agent table for native transaction support.
   * @param tables Participating physical table names.
   * @returns Completion after a read-only InnoDB inspection.
   */
  async check(tables: readonly string[]): Promise<void> {
    const connection = await this.connections.acquire();
    try {
      if (!(await this.allTransactional(connection, tables)))
        throw new Error("MySQL Agent execution requires transactional record tables.");
    } finally {
      this.connections.release(connection);
    }
  }

  /**
   * Determines whether every participating table supports transactions.
   *
   * @param connection Provides the connection used for metadata inspection.
   * @param tables Lists participating physical tables.
   * @returns Resolves whether every table uses InnoDB.
   */
  private async allTransactional(
    connection: PoolConnection,
    tables: readonly string[],
  ): Promise<boolean> {
    const [rows] = await connection.query<(RowDataPacket & { engine?: string })[]>(
      "SELECT engine AS engine FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN (?)",
      [tables],
    );
    return (
      rows.length === tables.length && rows.every((row) => row.engine?.toLowerCase() === "innodb")
    );
  }

  /**
   * Commits transactional work and retries one deadlock.
   *
   * @param connection Provides the transaction connection.
   * @param work Performs the connection-bound mutation.
   * @typeParam T The mutation result type.
   * @returns Resolves to the mutation result.
   */
  private async commitTransaction<T>(
    connection: PoolConnection,
    work: (connection: PoolConnection) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await connection.beginTransaction();
        const result = await work(connection);
        await connection.commit();
        return result;
      } catch (error) {
        await connection.rollback().catch(() => undefined);
        if (attempt === 0 && this.isDeadlock(error)) continue;
        throw error;
      }
    }
    throw new Error("Unreachable InnoDB commit retry.");
  }

  /**
   * Checks whether a failed transaction may be retried once after a deadlock.
   *
   * @param error Native MySQL failure.
   * @returns Whether the error identifies an InnoDB deadlock.
   */
  private isDeadlock(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "ER_LOCK_DEADLOCK"
    );
  }
}
