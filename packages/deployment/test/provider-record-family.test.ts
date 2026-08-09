import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import { createPool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { LeasedNodeRegistry } from "../src/index.js";
import { leaseRecordSpec } from "../src/registry/leased-node-registry.js";
import { MysqlStorageFactory } from "../../storage-rdbms/src/index.js";

vi.mock("mysql2/promise", () => ({ createPool: vi.fn() }));

describe("node-discovery provider configuration", () => {
  it("opens the configured MySQL table for the node-discovery record family", async () => {
    expect(vi.isMockFunction(createPool)).toBe(true);
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() =>
        Promise.resolve({ query: vi.fn(() => Promise.resolve([[], []])), release: vi.fn() }),
      ),
      end: vi.fn(() => Promise.resolve()),
    } as never);
    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/node_discovery" })
      .setTableName(leaseRecordSpec.recordType, "application_node_leases")
      .build();

    const storage = factory.createRecordStorage(
      { name: "provider-selection", multitenant: false },
      leaseRecordSpec,
    );

    expect((storage as unknown as { readonly tableName: string }).tableName).toBe(
      "application_node_leases",
    );
    factory.close();
  });

  it("selects Datastore custom storage for the node-discovery record family", () => {
    const fallback = new InMemoryStorageFactory();
    let selected = false;
    const factory = DatastoreStorageFactory.newBuilder()
      .setClient({} as never)
      .useRecordStorage(leaseRecordSpec.sourceType, leaseRecordSpec.recordType, (context, spec) => {
        selected = spec.recordType === leaseRecordSpec.recordType;
        return fallback.createRecordStorage(context, spec);
      })
      .build();

    const registry = new LeasedNodeRegistry({ factory, namespace: "provider-selection" });

    expect(selected).toBe(true);
    void registry.close();
  });
});
