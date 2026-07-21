import { createPool } from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";

import { MysqlStorageFactory } from "../src/index.js";

const url = process.env.SPINE_TS_MYSQL_URL ?? "";
const mysqlDescribe = url.length > 0 ? describe : describe.skip;

mysqlDescribe("MySQL Packet 1 schema", () => {
  const factories: MysqlStorageFactory[] = [];

  afterAll(async () => {
    await Promise.all(factories.map((factory) => factory.close()));
    const pool = createPool({ uri: url });
    try {
      await pool.query("DROP TABLE IF EXISTS `spine_ts_columns`");
      await pool.query("DROP TABLE IF EXISTS `spine_ts_records`");
    } finally {
      await pool.end();
    }
  });

  it("creates and verifies the two fixed normalized tables concurrently", async () => {
    const created = await Promise.all(
      Array.from({ length: 4 }, () => MysqlStorageFactory.create({ url })),
    );
    factories.push(...created);
    const pool = createPool({ uri: url });

    try {
      const [tables] = await pool.query<
        { table_name: string; table_collation: string | null; engine: string | null }[]
      >(
        `SELECT TABLE_NAME AS table_name, TABLE_COLLATION AS table_collation, ENGINE AS engine
         FROM information_schema.tables
         WHERE table_schema = DATABASE()
           AND table_name IN ('spine_ts_records', 'spine_ts_columns')
         ORDER BY table_name`,
      );
      const [version] = await pool.query<{ column_default: string | null }[]>(
        `SELECT COLUMN_DEFAULT AS column_default
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'spine_ts_records'
           AND column_name = 'schema_version'`,
      );

      expect(tables).toEqual([
        { table_name: "spine_ts_columns", table_collation: "utf8mb4_bin", engine: "InnoDB" },
        { table_name: "spine_ts_records", table_collation: "utf8mb4_bin", engine: "InnoDB" },
      ]);
      expect(version).toEqual([{ column_default: "1" }]);
    } finally {
      await pool.end();
    }
  });
});
