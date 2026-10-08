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

import { clone, create } from "@bufbuild/protobuf";
import { AnyMessages, Time } from "@spine-event-engine/core";
import {
  AgentHistoryCursorSchema,
  AgentHistoryEntrySchema,
  ConversationIdSchema,
} from "@spine-event-engine/proto/agent";
import { EventContextSchema, EventSchema } from "@spine-event-engine/proto";
import {
  AgentAcceptedInvocationSchema,
  AgentExecutionRecordSchema,
  AgentExecutionScopeSchema,
  AgentExecutionStartSchema,
  AgentInvocationBoundsSchema,
  AgentInvocationKeySchema,
  AgentProjectionReadResultSchema,
  type AgentExecutionRecord,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { describe, expect, it } from "vitest";
import { QuerySchema } from "@spine-event-engine/proto/client";
import { ActorContextSchema, UserIdSchema } from "@spine-event-engine/proto";
import { TypeUrls } from "@spine-event-engine/core";
import { AgentReadRuntime } from "../../src/agent/agent-read-runtime.js";
import { ReviewStartedSchema } from "../../test-fixtures/generated/handler-registry/events_pb.js";
import {
  ProjectOverviewStateSchema,
  ProjectStateSchema,
} from "../../test-fixtures/generated/entity-metadata/project_states_pb.js";

const scope = { context: "Support", tenant: "null", repository: "support.Agent", entity: "A" };

function readSession(recordedReads: bigint, maxRecoveryBytes: bigint) {
  let record = create(AgentExecutionRecordSchema, {
    accepted: create(AgentAcceptedInvocationSchema, {
      key: create(AgentInvocationKeySchema, {
        scope: create(AgentExecutionScopeSchema, { stateType: "support.Agent", agentKey: "A" }),
      }),
    }),
    started: create(AgentExecutionStartSchema, {
      bounds: create(AgentInvocationBoundsSchema, { recordedReads, maxRecoveryBytes }),
    }),
  });
  return {
    record: () => clone(AgentExecutionRecordSchema, record),
    update: (change: (current: AgentExecutionRecord) => AgentExecutionRecord) => {
      record = change(clone(AgentExecutionRecordSchema, record));
      return Promise.resolve(clone(AgentExecutionRecordSchema, record));
    },
    capacity: () => ({}),
  };
}

describe("Agent saved history reads", () => {
  it("retains a conversation cursor and rejects a changed cursor on replay", async () => {
    const session = readSession(1n, 10_000n);
    const conversation = create(ConversationIdSchema, { value: "ticket-T-1" });
    const cursor = create(AgentHistoryCursorSchema, { value: "page-2" });
    const view = { kind: "conversation" as const, conversation };
    const first = new AgentReadRuntime(session, 0);
    const page = { entries: [], hasMore: false };
    expect(
      await first.history(scope, view, { pageSize: 2, cursor }, () => Promise.resolve(page), 1_024),
    ).toEqual(page);
    first.finish();
    const replay = new AgentReadRuntime(session, 0);
    expect(
      await replay.history(
        scope,
        view,
        { pageSize: 2, cursor },
        () => Promise.reject(new Error("Live history was queried.")),
        1_024,
      ),
    ).toEqual(page);
    replay.finish();
    await expect(
      new AgentReadRuntime(session, 0).history(
        scope,
        view,
        { pageSize: 2, cursor: create(AgentHistoryCursorSchema, { value: "page-3" }) },
        () => Promise.reject(new Error("Live history was queried.")),
        1_024,
      ),
    ).rejects.toMatchObject({ reason: "REPLAY_DIVERGENCE" });
  });

  it("does not finish while an ordered live read is pending", async () => {
    const session = readSession(1n, 10_000n);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = new AgentReadRuntime(session, 0);
    const pending = runtime.history(
      scope,
      { kind: "full" },
      { pageSize: 1 },
      async () => {
        await gate;
        return { entries: [], hasMore: false };
      },
      1_024,
    );
    expect(() => {
      runtime.finish();
    }).toThrow("in progress");
    if (release === undefined) throw new Error("Expected live read gate.");
    release();
    await pending;
    runtime.finish();
  });

  it.each(["missing request", "missing result", "different state type"] as const)(
    "rejects a saved projection with %s before querying live storage",
    async (corruption) => {
      const session = readSession(1n, 10_000n);
      const query = create(QuerySchema, {
        id: { value: "q-first" },
        target: {
          type: TypeUrls.derive(ProjectStateSchema),
          criterion: { case: "includeAll", value: true },
        },
        context: create(ActorContextSchema, {
          actor: create(UserIdSchema, { value: "reviewer-1" }),
          timestamp: Time.currentTime(),
        }),
      });
      await new AgentReadRuntime(session, 0).query(ProjectStateSchema, query, () =>
        Promise.resolve([create(ProjectStateSchema, { id: "project-1" })]),
      );
      await session.update((record) => {
        const evidence = record.journal[0]?.evidence;
        if (evidence?.case !== "read") throw new Error("Expected a saved projection read.");
        if (corruption === "missing request") evidence.value.request = undefined;
        else if (corruption === "missing result") evidence.value.result = undefined;
        else {
          const saved =
            evidence.value.result &&
            AnyMessages.unpack(evidence.value.result, AgentProjectionReadResultSchema);
          if (saved === undefined) throw new Error("Expected a saved projection result.");
          saved.states[0] = AnyMessages.pack(
            ProjectOverviewStateSchema,
            create(ProjectOverviewStateSchema),
          );
          evidence.value.result = AnyMessages.pack(AgentProjectionReadResultSchema, saved);
        }
        return record;
      });
      await expect(
        new AgentReadRuntime(session, 0).query(ProjectStateSchema, query, () =>
          Promise.reject(new Error("Live projection was queried.")),
        ),
      ).rejects.toMatchObject({ reason: "REPLAY_DIVERGENCE" });
    },
  );

  it("rejects a different Agent scope before querying live history", async () => {
    const session = readSession(1n, 10_000n);
    let queried = false;
    await expect(
      new AgentReadRuntime(session, 0).history(
        { ...scope, entity: "B" },
        { kind: "full" },
        { pageSize: 1 },
        () => {
          queried = true;
          return Promise.resolve({ entries: [], hasMore: false });
        },
        1_024,
      ),
    ).rejects.toMatchObject({ reason: "REPLAY_DIVERGENCE" });
    expect(queried).toBe(false);
    expect(session.record().journal).toHaveLength(0);
  });

  it("rejects exhausted read credit before querying live history", async () => {
    const session = readSession(0n, 10_000n);
    let queried = false;
    await expect(
      new AgentReadRuntime(session, 0).history(
        scope,
        { kind: "full" },
        { pageSize: 1 },
        () => {
          queried = true;
          return Promise.resolve({ entries: [], hasMore: false });
        },
        1_024,
      ),
    ).rejects.toMatchObject({ reason: "READ_BUDGET_EXCEEDED" });
    expect(queried).toBe(false);
  });

  it("rejects a missing saved page instead of falling back to live storage", async () => {
    const session = readSession(1n, 10_000n);
    await new AgentReadRuntime(session, 0).history(
      scope,
      { kind: "full" },
      { pageSize: 1 },
      () => Promise.resolve({ entries: [], hasMore: false }),
      1_024,
    );
    await session.update((record) => {
      const evidence = record.journal[0]?.evidence;
      if (evidence?.case !== "read") throw new Error("Expected saved read.");
      evidence.value.result = undefined;
      return record;
    });
    await expect(
      new AgentReadRuntime(session, 0).history(
        scope,
        { kind: "full" },
        { pageSize: 1 },
        () => Promise.reject(new Error("Live storage was queried.")),
        1_024,
      ),
    ).rejects.toThrow("Saved Agent history page");
  });

  it("replays exact projection states while ignoring only a regenerated Query ID", async () => {
    const session = readSession(1n, 10_000n);
    const acceptedAt = Time.currentTime();
    const query = (id: string) =>
      create(QuerySchema, {
        id: { value: id },
        target: {
          type: TypeUrls.derive(ProjectStateSchema),
          criterion: { case: "includeAll", value: true },
        },
        context: create(ActorContextSchema, {
          actor: create(UserIdSchema, { value: "reviewer-1" }),
          timestamp: acceptedAt,
        }),
      });
    const state = create(ProjectStateSchema, { id: "project-1" });
    let liveReads = 0;
    const live = () => {
      liveReads++;
      return Promise.resolve([state]);
    };
    const first = new AgentReadRuntime(session, 0);
    expect(await first.query(ProjectStateSchema, query("q-first"), live)).toEqual([state]);
    first.finish();
    const replay = new AgentReadRuntime(session, 0);
    expect(
      await replay.query(ProjectStateSchema, query("q-new"), () => {
        throw new Error("Live projection must not be queried on replay.");
      }),
    ).toEqual([state]);
    replay.finish();
    expect(liveReads).toBe(1);
    const changed = query("q-another");
    if (changed.target === undefined) throw new Error("Expected typed query target.");
    changed.target.type = "type.spine.io/other.State";
    await expect(
      new AgentReadRuntime(session, 0).query(ProjectStateSchema, changed, live),
    ).rejects.toThrow("changed");
  });
  it("returns the exact saved page without querying changed live storage", async () => {
    const session = readSession(1n, 10_000n);
    const occurredAt = Time.currentTime();
    const page = {
      entries: [
        create(AgentHistoryEntrySchema, {
          occurredAt,
          item: {
            case: "domainEvent",
            value: create(EventSchema, {
              id: { value: "saved-read-event" },
              message: AnyMessages.pack(
                ReviewStartedSchema,
                create(ReviewStartedSchema, { id: "A" }),
              ),
              context: create(EventContextSchema, { timestamp: occurredAt }),
            }),
          },
        }),
      ],
      hasMore: true,
    };
    let reads = 0;
    const live = () => {
      reads++;
      return Promise.resolve(page);
    };
    const first = new AgentReadRuntime(session, 0);
    expect(await first.history(scope, { kind: "full" }, { pageSize: 1 }, live, 1_024)).toEqual(
      page,
    );
    expect(reads).toBe(1);
    const resumed = new AgentReadRuntime(session, 0);
    const saved = await resumed.history(scope, { kind: "full" }, { pageSize: 1 }, live, 1_024);
    expect(saved).toEqual(page);
    expect(reads).toBe(1);
    await expect(
      new AgentReadRuntime(session, 0).history(
        scope,
        { kind: "full" },
        { pageSize: 2 },
        live,
        1_024,
      ),
    ).rejects.toThrow("changed");
    expect(reads).toBe(1);
  });

  it("journals concurrent reads in call order and replays without either provider read", async () => {
    const session = readSession(2n, 10_000n);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const firstLive = async () => {
      order.push("first-start");
      await gate;
      order.push("first-end");
      return { entries: [], hasMore: true };
    };
    const secondLive = () => {
      order.push("second");
      return Promise.resolve({ entries: [], hasMore: false });
    };
    const firstRun = new AgentReadRuntime(session, 0);
    const first = firstRun.history(scope, { kind: "full" }, { pageSize: 1 }, firstLive, 1_024);
    const second = firstRun.history(scope, { kind: "domain" }, { pageSize: 1 }, secondLive, 1_024);
    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    if (release === undefined) throw new Error("Expected first read gate.");
    release();
    expect(await Promise.all([first, second])).toEqual([
      { entries: [], hasMore: true },
      { entries: [], hasMore: false },
    ]);
    firstRun.finish();
    expect(order).toEqual(["first-start", "first-end", "second"]);
    expect(
      session
        .record()
        .journal.map((entry) =>
          entry.evidence.case === "read" ? entry.evidence.value.readName : "other",
        ),
    ).toEqual(["history:0", "history:1"]);

    const replay = new AgentReadRuntime(session, 0);
    const unavailable = () => {
      throw new Error("Live provider must not be queried.");
    };
    const saved = await Promise.all([
      replay.history(scope, { kind: "full" }, { pageSize: 1 }, unavailable, 1_024),
      replay.history(scope, { kind: "domain" }, { pageSize: 1 }, unavailable, 1_024),
    ]);
    replay.finish();
    expect(saved[0].hasMore).toBe(true);
    expect(saved[1].hasMore).toBe(false);
  });

  it("does not record failed or oversized reads and detects omitted recovery reads", async () => {
    const session = readSession(1n, 10_000n);
    const runtime = new AgentReadRuntime(session, 0);
    await expect(
      runtime.history(
        scope,
        { kind: "full" },
        { pageSize: 1 },
        () => Promise.reject(new Error("provider failure")),
        1_024,
      ),
    ).rejects.toThrow("provider failure");
    expect(session.record().journal).toHaveLength(0);
    await runtime.history(
      scope,
      { kind: "full" },
      { pageSize: 1 },
      () => Promise.resolve({ entries: [], hasMore: false }),
      1_024,
    );
    runtime.finish();
    expect(session.record().journal[0]?.evidence.case).toBe("read");
    expect(() => {
      new AgentReadRuntime(session, 0).finish();
    }).toThrow("sequence changed");
    await expect(
      new AgentReadRuntime(session, 0).history(
        scope,
        { kind: "system" },
        { pageSize: 1 },
        () => Promise.reject(new Error("unexpected provider read")),
        1_024,
      ),
    ).rejects.toThrow("request or scope changed");

    const tight = readSession(1n, 1n);
    await expect(
      new AgentReadRuntime(tight, 0).history(
        scope,
        { kind: "full" },
        { pageSize: 1 },
        () => Promise.resolve({ entries: [], hasMore: false }),
        1_024,
      ),
    ).rejects.toThrow("exceeds durable record bytes");
    expect(tight.record().journal).toHaveLength(0);
  });
});
