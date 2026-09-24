/* global console, process */

const url = process.env.SPINE_TS_POSTGRESQL_URL;

if (url === undefined || url.length === 0) {
  console.error("SPINE_TS_POSTGRESQL_URL must name an explicit PostgreSQL test database.");
  process.exit(1);
}

for (const name of ["SPINE_TS_POSTGRESQL_TENANT_A_URL", "SPINE_TS_POSTGRESQL_TENANT_B_URL"]) {
  if (process.env[name] === undefined || process.env[name].length === 0) {
    console.error(`${name} must name an explicit PostgreSQL tenant test database.`);
    process.exit(1);
  }
}

const expectedMajor = process.env.SPINE_TS_POSTGRESQL_EXPECTED_MAJOR;
if (expectedMajor !== undefined && expectedMajor !== "16" && expectedMajor !== "18") {
  console.error("SPINE_TS_POSTGRESQL_EXPECTED_MAJOR must be 16 or 18 when provided.");
  process.exit(1);
}
