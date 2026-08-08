import { createHash } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";

/**
 * Identifies one Entity commit in MySQL's server advisory-lock namespace.
 */
export interface MysqlEntityLockIdentity {
  // prettier-ignore

  /**
   * Names the storage context.
   */
  readonly contextName: string;

  /**
   * Names the MySQL database containing the Entity families.
   */
  readonly databaseName: string;

  /**
   * Identifies the Entity.
   */
  readonly entityKey: string;

  /**
   * Names the Entity source type.
   */
  readonly sourceTypeName: string;

  /**
   * Names the tenant when the context is multitenant.
   */
  readonly tenantId?: string;
}

/**
 * Calculates MySQL's fixed-width advisory-lock key for one Entity identity.
 *
 * @param identity Identifies the Entity commit.
 * @returns Returns the advisory-lock key.
 */
export function mysqlEntityLockKey(identity: MysqlEntityLockIdentity): string {
  return createHash("sha256")
    .update(
      [
        identity.databaseName,
        identity.contextName,
        identity.tenantId ?? "",
        identity.sourceTypeName,
        identity.entityKey,
      ].join("\u0000"),
    )
    .digest("hex");
}

/**
 * Coordinates one-connection Entity commits.
 */
export class MysqlEntityCommitCoordinator {
  // prettier-ignore

  /**
   * Creates an Entity commit coordinator.
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
   * Commits one Entity mutation with a transaction or advisory lock.
   *
   * @param tables Lists participating physical tables.
   * @param key Identifies the advisory lock.
   * @param work Performs the connection-bound mutation.
   * @returns Returns the work result.
   */
  async commit<T>(
    tables: readonly string[],
    key: string,
    work: (connection: PoolConnection, transactional: boolean) => Promise<T>,
  ): Promise<T> {
    const connection = await this.connections.acquire();
    let locked = false;
    let transactional = false;
    try {
      const [rows] = await connection.query<(RowDataPacket & { engine?: string })[]>(
        "SELECT engine AS engine FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN (?)",
        [tables],
      );
      transactional =
        rows.length === tables.length &&
        rows.every((row) => row.engine?.toLowerCase() === "innodb");
      if (transactional) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            await connection.beginTransaction();
            const result = await work(connection, true);
            await connection.commit();
            return result;
          } catch (error) {
            await connection.rollback().catch(() => undefined);
            if (attempt === 0 && isDeadlock(error)) continue;
            transactional = false;
            throw error;
          }
        }
        throw new Error("Unreachable InnoDB commit retry.");
      }
      const [lockRows] = await connection.execute<(RowDataPacket & { acquired: number })[]>(
        "SELECT GET_LOCK(?, ?) AS acquired",
        [key, 30],
      );
      if (lockRows[0]?.acquired !== 1) throw new Error("Unable to acquire MySQL entity lock.");
      locked = true;
      return await work(connection, false);
    } catch (error) {
      if (transactional) {
        await connection.rollback().catch(() => undefined);
      }
      throw error;
    } finally {
      if (locked) await connection.execute("SELECT RELEASE_LOCK(?)", [key]).catch(() => undefined);
      this.connections.release(connection);
    }
  }
}

function isDeadlock(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ER_LOCK_DEADLOCK"
  );
}
