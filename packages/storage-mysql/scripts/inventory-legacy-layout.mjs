import console from "node:console";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import process from "node:process";

import { createPool } from "mysql2/promise";

export function mysqlLegacyFindings(columns, primaryKeys) {
  const findings = [];
  for (const column of columns) {
    const name = String(column.column_name ?? "").toLowerCase();
    if (name === "_scope" || name === "_revision") {
      findings.push(`${String(column.table_name)}.${name}`);
    }
  }
  const byTable = new Map();
  for (const column of primaryKeys) {
    const table = String(column.table_name);
    const names = byTable.get(table) ?? [];
    names.push({
      name: String(column.column_name).toLowerCase(),
      order: Number(column.seq_in_index),
    });
    byTable.set(table, names);
  }
  for (const [table, names] of byTable) {
    names.sort((left, right) => left.order - right.order);
    if (names.some(({ name }) => name === "_scope")) findings.push(`${table}.PRIMARY(_scope)`);
  }
  return [...new Set(findings)].sort();
}

export async function inspectMysqlUrl(url, poolFactory = createPool) {
  const pool = poolFactory(url);
  try {
    const [columns] = await pool.query(
      "SELECT table_name, column_name FROM information_schema.columns " +
        "WHERE table_schema=DATABASE() AND LOWER(column_name) IN ('_scope', '_revision')",
    );
    const [primaryKeys] = await pool.query(
      "SELECT table_name, column_name, seq_in_index FROM information_schema.statistics " +
        "WHERE table_schema=DATABASE() AND index_name='PRIMARY' ORDER BY table_name, seq_in_index",
    );
    return mysqlLegacyFindings(columns, primaryKeys);
  } finally {
    await pool.end();
  }
}

export function mysqlInventoryUrls(args, environment = process.env) {
  const urls = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--url") throw new Error(`Unknown MySQL inventory option: ${args[index]}`);
    const value = args[index + 1];
    if (value === undefined || value.length === 0) throw new Error("--url requires a value.");
    urls.push(value);
    index += 1;
  }
  if (urls.length === 0 && environment.SPINE_MYSQL_URL !== undefined) {
    urls.push(environment.SPINE_MYSQL_URL);
  }
  if (urls.length === 0) throw new Error("Provide at least one --url or SPINE_MYSQL_URL.");
  return urls;
}

async function main() {
  const urls = mysqlInventoryUrls(process.argv.slice(2));
  let failed = false;
  for (const [index, url] of urls.entries()) {
    try {
      const findings = await inspectMysqlUrl(url);
      if (findings.length === 0) continue;
      failed = true;
      console.error(`MySQL target ${String(index + 1)} contains legacy Spine layout:`);
      for (const finding of findings) console.error(`  ${finding}`);
    } catch {
      failed = true;
      console.error(`MySQL target ${String(index + 1)} could not be inventoried.`);
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
