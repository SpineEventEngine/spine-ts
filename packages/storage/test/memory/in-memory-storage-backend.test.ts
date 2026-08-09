import { AnySchema, StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import { InMemoryStorageBackend } from "../../src/memory/in-memory-storage-backend.js";
import { TenantBoundary } from "../../src/internal/tenancy.js";
import { RecordSpec } from "../../src/record/record-spec.js";

describe("InMemoryStorageBackend", () => {
  it("keeps equal record types separate when their source types differ", () => {
    const backend = new InMemoryStorageBackend();
    const firstSpec = new RecordSpec<string, StringValue>({
      sourceType: AnySchema,
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const secondSpec = new RecordSpec<string, StringValue>({
      sourceType: StringValueSchema,
      recordType: StringValueSchema,
      idKind: "string",
      extractId: (record) => record.value,
    });
    const first = { rows: [] as string[] };
    const second = { rows: [] as string[] };
    const tenant = TenantBoundary.single;

    const firstRows = InMemoryStorageBackend.bind(
      backend,
      "record",
      tenant,
      firstSpec.sourceType.typeName,
      () => first,
    );
    const secondRows = InMemoryStorageBackend.bind(
      backend,
      "record",
      tenant,
      secondSpec.sourceType.typeName,
      () => second,
    );

    expect(firstRows).toBe(first);
    expect(secondRows).toBe(second);
    expect(firstRows).not.toBe(secondRows);
  });
});
