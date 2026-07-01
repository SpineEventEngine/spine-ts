import type { Message } from "@bufbuild/protobuf";

import { EventStore } from "../event/event-store.js";
import type { RecordSpec } from "../record/record-spec.js";
import type { RecordStorage } from "../record/record-storage.js";
import type { StorageContext } from "./storage.js";
import { StorageObject } from "./storage-object.js";

/** Mandatory storage-adapter seam for Spine TS runtime storage. */
export abstract class StorageFactory extends StorageObject {
  /** Create a record storage for one context and one declarative record specification. */
  createRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    this.requireOpen("StorageFactory");
    return this.onCreateRecordStorage(context, recordSpec);
  }

  /** Create the framework event store delegate for generated Spine events. */
  createEventStore(context: StorageContext): EventStore {
    this.requireOpen("StorageFactory");
    return new EventStore(context, this);
  }

  protected abstract onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R>;
}
