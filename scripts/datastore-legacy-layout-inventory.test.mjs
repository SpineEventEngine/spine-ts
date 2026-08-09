import { describe, expect, it } from "vitest";

import {
  datastoreEntityFindings,
  datastoreProject,
  inspectDatastore,
} from "../packages/storage-datastore/scripts/inventory-legacy-layout.mjs";

describe("Datastore legacy-layout inventory", () => {
  it("reports scope properties and scope-derived key names", () => {
    const KEY = Symbol("KEY");
    expect(
      datastoreEntityFindings(
        "Dtenant",
        "Message",
        [{ _scope: "old", [KEY]: { name: "old-scope\u0000old-id" } }],
        KEY,
      ),
    ).toEqual(["Dtenant/Message:_scope", "Dtenant/Message:scope-derived-key"]);
  });

  it("accepts direct keys and properties", () => {
    const KEY = Symbol("KEY");
    expect(
      datastoreEntityFindings(
        "",
        "Message",
        [{ bytes: new Uint8Array(), [KEY]: { name: "1" } }],
        KEY,
      ),
    ).toEqual([]);
  });

  it("enumerates native namespaces and their kinds", async () => {
    const KEY = Symbol("KEY");
    const queries = [];
    const client = {
      KEY,
      createQuery(namespace, kind) {
        const query = { namespace, kind, select: () => query };
        queries.push(query);
        return query;
      },
      runQuery(query) {
        if (query.kind === "__namespace__") {
          return Promise.resolve([[{ [KEY]: { name: "Dtenant" } }]]);
        }
        if (query.kind === "__kind__") {
          return Promise.resolve([[{ [KEY]: { name: "Message" } }]]);
        }
        return Promise.resolve([[{ _scope: "legacy", [KEY]: { name: "scope\u0000id" } }]]);
      },
    };
    await expect(inspectDatastore(client)).resolves.toEqual([
      "(default)/Message:_scope",
      "(default)/Message:scope-derived-key",
      "Dtenant/Message:_scope",
      "Dtenant/Message:scope-derived-key",
    ]);
    expect(queries.some(({ namespace }) => namespace === "Dtenant")).toBe(true);
  });

  it("requires an explicit project", () => {
    expect(datastoreProject(["--project", "spine-test"], {})).toBe("spine-test");
    expect(() => datastoreProject([], {})).toThrow("Provide --project");
  });
});
