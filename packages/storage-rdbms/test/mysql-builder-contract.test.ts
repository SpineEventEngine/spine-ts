import { StringValueSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { createPool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { MysqlStorageFactory, type MysqlStorageFactoryBuilder } from "../src/index.js";

vi.mock("mysql2/promise", () => ({ createPool: vi.fn() }));

describe("MysqlStorageFactory builder contract", () => {
  it("exposes the JVM-style builder without a static create alias", () => {
    const builder: MysqlStorageFactoryBuilder = MysqlStorageFactory.newBuilder();

    expect(builder.setTableName(StringValueSchema, "records")).toBe(builder);
    expect("create" in MysqlStorageFactory).toBe(false);
  });

  it("rejects a missing options value and malformed or database-less URLs before connecting", async () => {
    await expect(MysqlStorageFactory.newBuilder().build()).rejects.toThrow(/options are required/i);
    await expect(
      MysqlStorageFactory.newBuilder().setOptions({ url: "not a URL" }).build(),
    ).rejects.toThrow(/valid URL/i);
    await expect(
      MysqlStorageFactory.newBuilder().setOptions({ url: "mysql://user:pass@localhost" }).build(),
    ).rejects.toThrow(/database/i);
  });

  it("validates table registrations while preserving independent record names", () => {
    const builder = MysqlStorageFactory.newBuilder();

    builder.setTableName(StringValueSchema, "string_values");
    expect(builder.setTableName(TimestampSchema, "timestamps")).toBe(builder);
    expect(() => builder.setTableName(StringValueSchema, "bad-name")).toThrow(/invalid/i);
    expect(() => builder.setTableName(TimestampSchema, "string_values")).toThrow(/collides/i);
  });

  it("keeps grouped registrations separate from a record-only registration", () => {
    const builder = MysqlStorageFactory.newBuilder();

    expect(builder.setTableName(StringValueSchema, "ungrouped_values")).toBe(builder);
    expect(builder.setTableName(TimestampSchema, StringValueSchema, "grouped_values")).toBe(
      builder,
    );
  });

  it("connects with parsed options, releases its probe, and closes its pool once", async () => {
    const release = vi.fn();
    const end = vi.fn(() => Promise.resolve());
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.resolve({ release })),
      end,
    } as never);

    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({
        url: "mysql://user:secret@db.example:3307/test_db",
        connectionLimit: 2,
        connectTimeoutMs: 10,
        tls: { rejectUnauthorized: false },
      })
      .build();
    factory.close();
    factory.close();
    await Promise.resolve();

    expect(createPool).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "db.example",
        port: 3307,
        database: "test_db",
        user: "user",
        password: "secret",
        connectionLimit: 2,
        connectTimeout: 10,
      }),
    );
    expect(release).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("sanitizes connection failures and closes the failed pool", async () => {
    const end = vi.fn(() => Promise.resolve());
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.reject(new Error("credential leak"))),
      end,
    } as never);

    await expect(
      MysqlStorageFactory.newBuilder().setOptions({ url: "mysql://db.example/database" }).build(),
    ).rejects.toThrow("Unable to connect to MySQL.");
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("connects with only required URL fields without inventing optional pool settings", async () => {
    const release = vi.fn();
    vi.mocked(createPool).mockReturnValue({
      getConnection: vi.fn(() => Promise.resolve({ release })),
      end: vi.fn(() => Promise.resolve()),
    } as never);

    const factory = await MysqlStorageFactory.newBuilder()
      .setOptions({ url: "mysql://db.example/defaults" })
      .build();
    factory.close();
    await Promise.resolve();

    expect(createPool).toHaveBeenLastCalledWith({ host: "db.example", database: "defaults" });
    expect(release).toHaveBeenCalledOnce();
  });
});
