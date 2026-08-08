/* global console, process */

if (process.env.SPINE_TS_MYSQL_URL === undefined || process.env.SPINE_TS_MYSQL_URL.length === 0) {
  console.error("SPINE_TS_MYSQL_URL must name an explicit MySQL test database.");
  process.exit(1);
}
if (
  process.env.SPINE_TS_MYSQL_ADMIN_URL === undefined ||
  process.env.SPINE_TS_MYSQL_ADMIN_URL.length === 0
) {
  console.error("SPINE_TS_MYSQL_ADMIN_URL must name an admin URL for trigger-injection tests.");
  process.exit(1);
}
