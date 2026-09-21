import { describe, expect, it, vi } from "vitest";

import { PostgresTableInitializer } from "../src/postgres/table-initializer.js";

describe("PostgresTableInitializer", () => {
  it.each([
    ["missing column", catalog({ columns: columns().slice(0, 1) })],
    ["extra column", catalog({ columns: [...columns(), column("extra")] })],
    ["wrong type", catalog({ columns: [column("ID", "text"), column("bytes", "bytea")] })],
    [
      "wrong nullability",
      catalog({ columns: [column("ID", "character varying", "YES"), column("bytes", "bytea")] }),
    ],
    [
      "wrong default",
      catalog({
        columns: [column("ID", "character varying", "NO", "x"), column("bytes", "bytea")],
      }),
    ],
    [
      "wrong ordered primary key",
      catalog({ primary: [{ column_name: "bytes", ordinal_position: 1 }] }),
    ],
    [
      "incompatible unique constraint",
      catalog({
        unique: [
          { constraint_name: "records_bytes_key", column_name: "bytes", ordinal_position: 1 },
        ],
      }),
    ],
  ])("rolls back and rejects a %s catalog layout", async (_name, layout) => {
    const fixture = client(layout);

    await expect(initialize(fixture).prepare()).rejects.toThrow(/incompatible/i);

    expect(fixture.calls).toContain("ROLLBACK");
    expect(fixture.release).toHaveBeenCalledOnce();
  });

  it("commits an exact compatible catalog layout using parameterized schema and table", async () => {
    const fixture = client(catalog());
    const initializer = initialize(fixture, "spine", "records");

    await initializer.prepare();
    await initializer.prepare();

    expect(fixture.calls).toContain("COMMIT");
    expect(fixture.release).toHaveBeenCalledOnce();
    expect(fixture.query).toHaveBeenCalledWith(expect.stringContaining("table_schema=$1"), [
      "spine",
      "records",
    ]);
  });

  it("accepts PostgreSQL information_schema integer for a declared INT column", async () => {
    const fixture = client(
      catalog({ columns: [...columns(), column("version", "integer", "YES")] }),
    );
    const initializer = new PostgresTableInitializer(fixture, "spine", {
      tableName: "states",
      columns: [
        { name: "ID", postgresType: "VARCHAR(512)", nullable: false },
        { name: "bytes", postgresType: "BYTEA", nullable: false },
        { name: "version", postgresType: "INT", nullable: true },
      ],
      primaryKey: ["ID"],
    } as never);

    await initializer.prepare();

    expect(fixture.calls).toContain("COMMIT");
  });

  it("retries the complete initialization once for a serialization failure with a fresh client", async () => {
    const first = client(catalog(), { code: "40001" });
    const second = client(catalog());
    const acquire = vi.fn().mockResolvedValueOnce(first.value).mockResolvedValueOnce(second.value);

    await initialize({ acquire }, "spine", "records").prepare();

    expect(acquire).toHaveBeenCalledTimes(2);
    expect(first.calls).toContain("ROLLBACK");
    expect(first.release).toHaveBeenCalledOnce();
    expect(second.calls).toContain("COMMIT");
  });

  it("does not retry a schema failure", async () => {
    const fixture = client(catalog({ columns: columns().slice(0, 1) }));
    const acquire = vi.fn().mockResolvedValue(fixture.value);

    await expect(initialize({ acquire }).prepare()).rejects.toThrow(/incompatible/i);

    expect(acquire).toHaveBeenCalledOnce();
  });

  it("uses the same advisory lock identity for independently constructed initializers", async () => {
    const first = client(catalog());
    const second = client(catalog());
    await initialize({
      acquire: () => Promise.resolve(first.value),
      lockIdentity: "db-a",
    }).prepare();
    await initialize({
      acquire: () => Promise.resolve(second.value),
      lockIdentity: "db-a",
    }).prepare();

    const lock = "SELECT pg_advisory_xact_lock($1)";
    expect(first.query.mock.calls.find(([sql]) => sql === lock)?.[1]).toEqual(
      second.query.mock.calls.find(([sql]) => sql === lock)?.[1],
    );
  });
});

function initialize(
  lifecycle: { readonly acquire: () => Promise<never>; readonly lockIdentity?: string },
  schema = "spine",
  tableName = "records",
): PostgresTableInitializer {
  return new PostgresTableInitializer(lifecycle, schema, {
    tableName,
    columns: [
      { name: "ID", postgresType: "VARCHAR(512)", nullable: false },
      { name: "bytes", postgresType: "BYTEA", nullable: false },
    ],
    primaryKey: ["ID"],
  } as never);
}

function client(layout: Catalog, failure?: { readonly code: string }) {
  const calls: string[] = [];
  const release = vi.fn();
  let fail = failure;
  const query = vi.fn((sql: string) => {
    calls.push(sql);
    if (sql === "BEGIN" && fail !== undefined) {
      const error = fail;
      fail = undefined;
      return Promise.reject(Object.assign(new Error(error.code), { code: error.code }));
    }
    if (sql.includes("information_schema.columns"))
      return Promise.resolve({ rows: layout.columns });
    if (sql.includes("constraint_type = 'PRIMARY KEY'"))
      return Promise.resolve({ rows: layout.primary });
    if (sql.includes("constraint_type = 'UNIQUE'")) return Promise.resolve({ rows: layout.unique });
    return Promise.resolve({ rows: [] });
  });
  return {
    calls,
    query,
    release,
    value: { query, release },
    acquire: () => Promise.resolve({ query, release } as never),
  };
}

function catalog(overrides: Partial<Catalog> = {}): Catalog {
  return {
    columns: columns(),
    primary: [{ column_name: "ID", ordinal_position: 1 }],
    unique: [],
    ...overrides,
  };
}

function columns() {
  return [column("ID", "character varying"), column("bytes", "bytea")];
}

function column(
  name: string,
  data_type = "integer",
  is_nullable = "NO",
  column_default: string | null = null,
) {
  return {
    column_name: name,
    data_type,
    udt_name: data_type,
    character_maximum_length: data_type === "character varying" ? 512 : null,
    is_nullable,
    column_default,
  };
}

interface Catalog {
  readonly columns: ReturnType<typeof columns>;
  readonly primary: readonly { readonly column_name: string; readonly ordinal_position: number }[];
  readonly unique: readonly {
    readonly constraint_name: string;
    readonly column_name: string;
    readonly ordinal_position: number;
  }[];
}
