import { create } from "@bufbuild/protobuf";
import type { Event, EventId } from "@spine-ts/proto";
import { EventIdSchema, EventSchema } from "@spine-ts/proto";

import { RecordColumn } from "../record/record-column.js";
import type { RecordQuery } from "../record/record-query.js";
import { RecordSpec } from "../record/record-spec.js";
import type { RecordStorage } from "../record/record-storage.js";
import type { StorageContext } from "../storage/storage.js";
import type { StorageFactory } from "../storage/storage-factory.js";

/** Framework event store backed by a record storage. */
export class EventStore {
  readonly #storage: RecordStorage<EventId, Event>;

  constructor(context: StorageContext, factory: StorageFactory) {
    this.#storage = factory.createRecordStorage(context, eventSpec);
  }

  /** Whether the underlying event record storage remains open. */
  isOpen(): boolean {
    return this.#storage.isOpen();
  }

  /** Close the underlying event record storage. */
  close(): void {
    this.#storage.close();
  }

  /** Append one generated Spine event. */
  async append(event: Event): Promise<void> {
    await this.#storage.write(event);
  }

  /** Append generated Spine events in order. */
  async appendAll(events: Iterable<Event>): Promise<void> {
    const records = [...events];

    if (records.length > 0) {
      await this.#storage.writeAll(records);
    }
  }

  /** Read persisted events through the underlying record-storage query seam. */
  read(query: RecordQuery<EventId> = {}): Promise<readonly Event[]> {
    return this.#storage.query(query);
  }
}

const eventSpec = new RecordSpec<EventId, Event>({
  schema: EventSchema,
  idSchema: EventIdSchema,
  extractId: (event) => event.id ?? create(EventIdSchema),
  columns: [
    new RecordColumn("timestamp", (event) => event.context?.timestamp?.seconds ?? 0n),
    new RecordColumn("typeUrl", (event) => event.message?.typeUrl),
  ],
});
