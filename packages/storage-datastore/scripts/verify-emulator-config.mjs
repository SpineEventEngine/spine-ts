/* global process */

if (!process.env.DATASTORE_EMULATOR_HOST) {
  throw new Error("DATASTORE_EMULATOR_HOST is required; start Firestore in Datastore mode first.");
}
