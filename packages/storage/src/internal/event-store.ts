/**
 * Provider-only Event Store record layout.
 *
 * Storage adapters use this subpath to address the same durable records as the
 * framework Event Store without adding the layout to the end-user package root.
 */
export { eventStoreAccess, eventStoreRecordSpec } from "../event/event-store.js";
