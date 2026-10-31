/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { TypeUrls } from "@spine-event-engine/core";
import { TenantIdSchema } from "@spine-event-engine/proto";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";
import { serverTestFixturesProtoModule } from "../../test-fixtures/generated/proto-module.js";
import {
  ProjectOverviewStateSchema,
  type ProjectOverviewState,
} from "../../test-fixtures/generated/entity-metadata/project_states_pb.js";
import { ReadSideFilter, type ReadSideContext } from "../../src/stand/read-side-filter.js";
import { Stand, standAccess, type StandReadOptions } from "../../src/stand/stand.js";

void serverTestFixturesProtoModule;

describe("Stand read-side boundary", () => {
  it("keeps an async policy inside the read lifetime and propagates cancellation", async () => {
    let entered!: () => void;
    let release!: () => void;
    const policyEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    class Wait extends ReadSideFilter<typeof ProjectOverviewStateSchema> {
      constructor() {
        super(ProjectOverviewStateSchema);
      }
      async filter(state: ProjectOverviewState): Promise<ProjectOverviewState> {
        entered();
        await gate;
        return state;
      }
    }
    const stand = new Stand({
      context: { name: "Projects", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectOverviewStateSchema);
    standAccess.installReadFilters(stand, [new Wait()]);
    await stand.update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, {
        id: "project-1",
        name: "Private",
        priority: 1,
      }),
    );
    const abort = new AbortController();
    const reading = stand.read(ProjectOverviewStateSchema, "project-1", {
      signal: abort.signal,
    });
    await policyEntered;
    let closed = false;
    const closing = stand.close().then(() => {
      closed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
    abort.abort();
    release();
    await expect(reading).rejects.toMatchObject({ code: Code.Canceled });
    await closing;
    expect(closed).toBe(true);
  });

  it("filters outward direct reads without changing retained or stored state", async () => {
    const calls: ReadSideContext[] = [];
    class Redact extends ReadSideFilter<typeof ProjectOverviewStateSchema> {
      constructor() {
        super(ProjectOverviewStateSchema);
      }
      filter(state: ProjectOverviewState, context: ReadSideContext): ProjectOverviewState {
        calls.push(context);
        state.name = "Visible";
        return state;
      }
    }
    const stand = new Stand({
      context: { name: "Projects", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectOverviewStateSchema);
    standAccess.installReadFilters(stand, [new Redact()]);
    const original = create(ProjectOverviewStateSchema, {
      id: "project-1",
      name: "Private",
      priority: 1,
    });
    await stand.update(ProjectOverviewStateSchema, original);

    const result = await stand.read(ProjectOverviewStateSchema, "project-1");
    expect(result?.name).toBe("Visible");
    expect(original.name).toBe("Private");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.operation).toEqual({
      kind: "direct",
      read: { typeUrl: TypeUrls.derive(ProjectOverviewStateSchema), id: "project-1" },
    });
    expect(
      (await standAccess.readCurrent(stand, ProjectOverviewStateSchema, "project-1", {}))?.state
        .name,
    ).toBe("Private");
    await stand.close();
  });

  it("removes direct roots without replenishing query rows or deleting stored state", async () => {
    class RemovePrivate extends ReadSideFilter<typeof ProjectOverviewStateSchema> {
      constructor() {
        super(ProjectOverviewStateSchema);
      }
      filter(state: ProjectOverviewState): ProjectOverviewState | null {
        return state.name === "Private" ? null : state;
      }
    }
    const stand = new Stand({
      context: { name: "Projects", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectOverviewStateSchema);
    standAccess.installReadFilters(stand, [new RemovePrivate()]);
    for (const [id, name] of [
      ["project-1", "Private"],
      ["project-2", "Public"],
    ] as const) {
      await stand.update(
        ProjectOverviewStateSchema,
        create(ProjectOverviewStateSchema, { id, name, priority: 1 }),
      );
    }
    expect(await stand.read(ProjectOverviewStateSchema, "project-1")).toBeUndefined();
    expect(
      (await stand.queryVersioned(ProjectOverviewStateSchema, {})).map((row) => row.state.id),
    ).toEqual(["project-2"]);
    expect(
      (await standAccess.readCurrent(stand, ProjectOverviewStateSchema, "project-1", {}))?.state
        .name,
    ).toBe("Private");
    await stand.close();
  });

  it("keeps one trusted context snapshot across asynchronously filtered query rows", async () => {
    let entered!: () => void;
    let release!: () => void;
    const first = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const observed: ReadSideContext[] = [];
    class Inspect extends ReadSideFilter<typeof ProjectOverviewStateSchema> {
      constructor() {
        super(ProjectOverviewStateSchema);
      }
      async filter(
        state: ProjectOverviewState,
        context: ReadSideContext,
      ): Promise<ProjectOverviewState> {
        observed.push(context);
        if (observed.length === 1) {
          entered();
          await gate;
        }
        return state;
      }
    }
    const stand = new Stand({
      context: { name: "Projects", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectOverviewStateSchema);
    standAccess.installReadFilters(stand, [new Inspect()]);
    await stand.update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, {
        id: "project-1",
        name: "Private one",
        priority: 1,
      }),
    );
    await stand.update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, {
        id: "project-2",
        name: "Private two",
        priority: 1,
      }),
    );
    const request = {};
    const facts = { principal: { id: "reader-1" }, authorityFacts: { roles: ["reader"] } };
    const reading = stand.queryVersioned(ProjectOverviewStateSchema, request, {
      reader: facts,
    });
    await first;
    facts.principal.id = "reader-2";
    facts.authorityFacts.roles.push("admin");
    release();
    expect(await reading).toHaveLength(2);
    expect(observed.map((context) => context.principal?.id)).toEqual(["reader-1", "reader-1"]);
    expect(observed.map((context) => context.authorityFacts?.roles)).toEqual([
      ["reader"],
      ["reader"],
    ]);
    await stand.close();
  });

  it("uses the admitted tenant snapshot rather than a mutable caller claim", async () => {
    const observed: ReadSideContext[] = [];
    class Inspect extends ReadSideFilter<typeof ProjectOverviewStateSchema> {
      constructor() {
        super(ProjectOverviewStateSchema);
      }
      filter(state: ProjectOverviewState, context: ReadSideContext): ProjectOverviewState {
        observed.push(context);
        return state;
      }
    }
    const stand = new Stand({
      context: { name: "TenantProjects", multitenant: true },
      storageFactory: new InMemoryStorageFactory(),
    });
    stand.register(ProjectOverviewStateSchema);
    standAccess.installReadFilters(stand, [new Inspect()]);
    const tenant = create(TenantIdSchema, { kind: { case: "value", value: "tenant-a" } });
    await stand.update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, {
        id: "project-1",
        name: "Private",
        priority: 1,
      }),
      { tenantId: tenant },
    );
    let entered!: () => void;
    let release!: () => void;
    const admitted = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    standAccess.setAdmission(stand, async () => {
      entered();
      await gate;
    });
    const input = create(TenantIdSchema, { kind: { case: "value", value: "tenant-a" } });
    const claimed = create(TenantIdSchema, { kind: { case: "value", value: "tenant-b" } });
    const reading = stand.read(ProjectOverviewStateSchema, "project-1", {
      tenantId: input,
      readSide: {
        operation: { kind: "query", query: { $typeName: "forged" } },
        effectiveTenant: claimed,
      },
    } as unknown as StandReadOptions);
    await admitted;
    input.kind = { case: "value", value: "tenant-b" };
    release();
    expect((await reading)?.name).toBe("Private");
    expect(observed[0]?.effectiveTenant).toEqual(tenant);
    expect(observed[0]?.operation).toEqual({
      kind: "direct",
      read: { typeUrl: TypeUrls.derive(ProjectOverviewStateSchema), id: "project-1" },
    });
    await stand.close();
  });
});
