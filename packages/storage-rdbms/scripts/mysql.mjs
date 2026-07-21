/* global console, process */

if (process.env.SPINE_TS_MYSQL_URL === undefined || process.env.SPINE_TS_MYSQL_URL.length === 0) {
  console.error("SPINE_TS_MYSQL_URL must name an explicit MySQL test database.");
  process.exit(1);
}
