import type { StorageContext } from "@spine-event-engine/storage";

import { CanonicalValue } from "./value-codec.js";

/** Canonical Datastore kinds shared by generic records and event delivery. */
export const DatastoreRecordKinds = Object.freeze({
  derive(context: StorageContext, storageKey: string): string {
    const kind = CanonicalValue.encode([context.name, context.multitenant, storageKey]);
    if (Buffer.byteLength(kind, "utf8") > 1_500)
      throw new Error("Datastore record kind exceeds the 1500-byte UTF-8 limit.");
    return kind;
  },
});
