/* global process */

if (process.env.DATASTORE_CLOUD_TEST !== "1") {
  throw new Error("Set DATASTORE_CLOUD_TEST=1 to acknowledge the opt-in cloud smoke test.");
}

if (!process.env.DATASTORE_PROJECT_ID) {
  throw new Error("DATASTORE_PROJECT_ID is required for the opt-in cloud smoke test.");
}
