import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { EntityColumn } from "../dist/index.js";
import * as clientRoot from "../dist/index.js";
import { GeneratedEntityColumns } from "../dist/codegen/index.js";
import { ProjectionStateSchema } from "../test-fixtures/entity-column-fixtures.js";

describe("@spine-event-engine/client-node built exports", () => {
  it("declares the Node-only client package identity", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { readonly name?: string };

    expect(manifest.name).toBe("@spine-event-engine/client-node");
  });

  it("keeps public declarations independent of server, test, and wire implementation types", () => {
    const declarations = readFileSync(new URL("../dist/index.d.ts", import.meta.url), "utf8");
    for (const forbidden of [
      "@spine-event-engine/server",
      "@spine-event-engine/testing",
      "vitest",
      "jest",
      "test-fixtures",
      /\bSubscriptionUpdate\b/u,
      /\bSubscriptionService\b/u,
      "@connectrpc/connect",
    ]) {
      expect(declarations).not.toMatch(forbidden);
    }
  });

  it("rejects direct construction through emitted JavaScript", () => {
    expect(() => {
      Reflect.construct(EntityColumn, [{}]);
    }).toThrow(/Entity columns can only be constructed during registration/);
  });

  it("ships the Projection companion generator as a package bin", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      readonly bin?: Readonly<Record<string, string>>;
      readonly files?: readonly string[];
    };

    expect(manifest.bin?.["protoc-gen-spine-entity-columns"]).toBe(
      "./codegen/generate-entity-columns.mjs",
    );
    expect(manifest.files).toContain("codegen");
  });

  it("keeps generated construction on the codegen subpath and preserves definition identity", () => {
    expect("GeneratedEntityColumns" in clientRoot).toBe(false);
    expect(GeneratedEntityColumns.define).toBeTypeOf("function");

    const definition = GeneratedEntityColumns.define(ProjectionStateSchema, {
      title: { field: ProjectionStateSchema.field.title, comparison: "ordering" },
      priority: { field: ProjectionStateSchema.field.priority, comparison: "ordering" },
      status: { field: ProjectionStateSchema.field.status, comparison: "equality" },
      dueAt: { field: ProjectionStateSchema.field.dueAt, comparison: "ordering" },
      owner: { field: ProjectionStateSchema.field.owner, comparison: "equality" },
      fingerprint: { field: ProjectionStateSchema.field.fingerprint, comparison: "equality" },
      active: { field: ProjectionStateSchema.field.active, comparison: "equality" },
      sequence: { field: ProjectionStateSchema.field.sequence, comparison: "ordering" },
    });
    const columns = EntityColumn.register(ProjectionStateSchema, definition);

    expect(columns.title.descriptor).toBe(ProjectionStateSchema.field.title);
    expect(EntityColumn.register(ProjectionStateSchema, definition)).toBe(columns);
  });
});
