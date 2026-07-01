import { create } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import type { Event, EventId } from "@spine-ts/proto";
import { EventIdSchema, EventSchema } from "@spine-ts/proto";
import { describe, expect, it } from "vitest";

import {
  InMemoryStorageFactory,
  RecordColumn,
  RecordSpec,
  type StorageFactory,
} from "../../src/index.js";

describe("StorageFactory", () => {
  it("creates typed record storages through the JVM-like seam", () => {
    const factory: StorageFactory = new InMemoryStorageFactory();
    const spec = createEventSpec();
    const storage = factory.createRecordStorage(
      {
        name: "Tasks",
        multitenant: false,
      },
      spec,
    );

    expect(storage.recordSpec).toBe(spec);
  });

  it("creates isolated record storage instances", async () => {
    const factory = new InMemoryStorageFactory();
    const spec = createEventSpec();
    const first = factory.createRecordStorage({ name: "Tasks", multitenant: false }, spec);
    const second = factory.createRecordStorage({ name: "Tasks", multitenant: false }, spec);

    await first.write(createEvent("event-1", "type.spine.io/tasks.TaskCreated"));

    await expect(second.read(create(EventIdSchema, { value: "event-1" }))).resolves.toBeUndefined();
  });
});

function createEventSpec() {
  return new RecordSpec<EventId, Event>({
    schema: EventSchema,
    idSchema: EventIdSchema,
    extractId: (event) => event.id ?? create(EventIdSchema),
    columns: [new RecordColumn<Event>("typeUrl", (event) => event.message?.typeUrl)],
  });
}

function createEvent(id: string, typeUrl: string) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    message: create(AnySchema, { typeUrl }),
  });
}
