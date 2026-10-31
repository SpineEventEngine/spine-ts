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
import { TypeUrls } from "@spine-event-engine/core";
import { QuerySchema } from "@spine-event-engine/proto/client";
import { describe, expect, it, vi } from "vitest";
import { AgentLiveBudget } from "../../src/agent/agent-live-budget.js";
import { AgentLiveReadRuntime } from "../../src/agent/agent-live-read-runtime.js";
import { ProjectOverviewStateSchema } from "../../test-fixtures/generated/entity-metadata/project_states_pb.js";

const scope = {
  context: "Projects",
  tenant: "null",
  repository: ProjectOverviewStateSchema.typeName,
  entity: "P-1",
};
const page = { entries: [], hasMore: false };

describe("live Agent reads", () => {
  it("keeps an outward history policy inside the admitted read lifetime", async () => {
    let entered!: () => void;
    let release!: () => void;
    const policyEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const policyGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reads = new AgentLiveReadRuntime(scope, new AgentLiveBudget({ recordedReads: 1 }));
    const result = reads.history(
      scope,
      { pageSize: 1 },
      () => Promise.resolve(page),
      undefined,
      async () => {
        entered();
        await policyGate;
        return { items: [] };
      },
    );
    await policyEntered;
    expect(() => {
      reads.finish();
    }).toThrow("still in progress");
    release();
    await expect(result).resolves.toEqual({ items: [] });
    reads.finish();
  });

  it("serializes provider reads and charges the shared bound before a second callback", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const calls: string[] = [];
    const reads = new AgentLiveReadRuntime(scope, new AgentLiveBudget({ recordedReads: 1 }));
    const first = reads.history(
      scope,
      { pageSize: 1 },
      async () => {
        calls.push("first");
        await firstGate;
        return page;
      },
      undefined,
    );
    const secondLive = vi.fn(() => Promise.resolve(page));
    const second = reads.history(scope, { pageSize: 1 }, secondLive, undefined);
    await Promise.resolve();
    expect(calls).toEqual(["first"]);
    expect(() => {
      reads.finish();
    }).toThrow("still in progress");
    releaseFirst?.();
    await expect(first).resolves.toEqual(page);
    await expect(second).rejects.toThrow("read budget");
    expect(secondLive).not.toHaveBeenCalled();
    reads.finish();
  });

  it("validates typed query target and returns domain states without a saved snapshot", async () => {
    const reads = new AgentLiveReadRuntime(scope, new AgentLiveBudget({ recordedReads: 1 }));
    const query = create(QuerySchema, {
      target: { type: TypeUrls.derive(ProjectOverviewStateSchema) },
    });
    const states = [create(ProjectOverviewStateSchema, { name: "current" })];
    const live = vi.fn(() => Promise.resolve(states));
    await expect(reads.query(ProjectOverviewStateSchema, query, live)).resolves.toBe(states);
    expect(live).toHaveBeenCalledOnce();
    reads.finish();
    await expect(reads.query(ProjectOverviewStateSchema, query, live)).rejects.toThrow("closed");
    expect(live).toHaveBeenCalledOnce();
  });
});
