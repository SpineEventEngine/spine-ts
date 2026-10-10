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

import { clone, create, toBinary } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Time } from "@spine-event-engine/core";
import { VersionSchema } from "@spine-event-engine/proto";
import {
  AgentExecutionRecordSchema,
  AgentExecutionCompletionSchema,
  AgentInvocationStatus,
  type AgentExecutionRecord,
  type AgentInvocationKey,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { describe, expect, it } from "vitest";
import { AgentExecutionStorageFactories } from "../../src/internal/agent-execution.js";
import { InMemoryStorageFactory } from "../../src/memory/in-memory-storage-factory.js";
import { accepted, entityInput } from "./agent-execution-fixtures.js";

function open() {
  const factory = new InMemoryStorageFactory();
  return AgentExecutionStorageFactories.create(factory, {
    entity: entityInput(),
    stateType: "spine.server.testing.SupportReplyAgentState",
  });
}

async function withClaim(
  work: (
    handle: ReturnType<typeof open>,
    key: AgentInvocationKey,
    record: AgentExecutionRecord,
  ) => Promise<void> | void,
) {
  const previous = Time.setProvider({
    currentTime: () => create(TimestampSchema, { seconds: 100n }),
  });
  const handle = open();
  try {
    const source = accepted("boundary-source");
    const key = source.key;
    if (key === undefined) throw new Error("Fixture requires invocation key.");
    await handle.admit(source);
    const claim = await handle.claim(key, "token", create(TimestampSchema, { seconds: 110n }));
    if (claim === undefined) throw new Error("Fixture requires active invocation.");
    await work(handle, key, claim.record);
  } finally {
    handle.close();
    Time.setProvider(previous);
  }
}

describe("in-memory Agent execution request boundaries", () => {
  it.each([0, -1, 1.5, Number.NaN, 128])("rejects invalid discovery page size %s", (count) => {
    const handle = open();
    try {
      expect(() => handle.pending({ count })).toThrow(/count/i);
    } finally {
      handle.close();
    }
  });

  it("rejects a continuation from another repository state", async () => {
    await withClaim((handle, key) => {
      const scope = key.scope;
      if (scope === undefined) throw new Error("Fixture requires scope.");
      expect(() =>
        handle.pending({
          count: 1,
          after: {
            asOf: create(TimestampSchema, { seconds: 100n }),
            key: {
              eligibleAt: create(TimestampSchema, { seconds: 90n }),
              scope: { ...scope, stateType: "other.State" },
            },
          },
        }),
      ).toThrow(/another state/i);
    });
  });

  it("cannot shorten or repeat a claim lease", async () => {
    await withClaim(async (handle, key, record) => {
      for (const seconds of [109n, 110n]) {
        await expect(
          handle.renew(key, "token", create(TimestampSchema, { seconds })),
        ).resolves.toBe(false);
      }
      await expect(
        handle.renew(key, "other-token", create(TimestampSchema, { seconds: 111n })),
      ).resolves.toBe(false);
      expect(await handle.read(key)).toEqual(record);
    });
  });

  it("rejects empty claim tokens and an expiry equal to the current Time", async () => {
    await withClaim(async (handle, key) => {
      await expect(
        handle.claim(key, "", create(TimestampSchema, { seconds: 120n })),
      ).rejects.toThrow(/token/i);
      await expect(
        handle.claim(key, "new-token", create(TimestampSchema, { seconds: 100n })),
      ).rejects.toThrow(/future expiry/i);
    });
  });

  it("rejects a stale read image and changes to the accepted signal", async () => {
    await withClaim(async (handle, key, record) => {
      const next = clone(AgentExecutionRecordSchema, record);
      await expect(
        handle.update({ key, token: "token", expectedRecordBytes: new Uint8Array(), next }),
      ).rejects.toThrow(/no longer current/i);
      next.accepted = accepted("changed-original-signal");
      await expect(
        handle.update({
          key,
          token: "token",
          expectedRecordBytes: toBinary(AgentExecutionRecordSchema, record),
          next,
        }),
      ).rejects.toThrow(/immutable accepted/i);
      expect(await handle.read(key)).toEqual(record);
    });
  });

  it("cannot acknowledge output before completion", async () => {
    await withClaim(async (handle, key, record) => {
      await expect(
        handle.markDelivered(key, "other-token", toBinary(AgentExecutionRecordSchema, record), []),
      ).rejects.toThrow(/claim|current/i);
      await expect(handle.markDelivered(key, "token", new Uint8Array(), [])).rejects.toThrow(
        /claim|current/i,
      );
      await expect(
        handle.markDelivered(key, "token", toBinary(AgentExecutionRecordSchema, record), []),
      ).rejects.toThrow(/no completed output/i);
      expect(await handle.read(key)).toEqual(record);
    });
  });

  it.each(["missing-versions", "active-status", "changed-version"] as const)(
    "rejects invalid completion: %s",
    async (failure) => {
      await withClaim(async (handle, key, record) => {
        const next = clone(AgentExecutionRecordSchema, record);
        next.status = AgentInvocationStatus.AGENT_INVOCATION_COMPLETED;
        next.completion = create(AgentExecutionCompletionSchema, {
          initialVersion: create(VersionSchema),
          resultingVersion: create(VersionSchema),
        });
        if (failure === "missing-versions") next.completion.initialVersion = undefined;
        else if (failure === "active-status")
          next.status = AgentInvocationStatus.AGENT_INVOCATION_ACTIVE;
        else next.completion.resultingVersion = create(VersionSchema, { number: 1 });
        await expect(
          handle.complete({
            key,
            token: "token",
            expectedRecordBytes: toBinary(AgentExecutionRecordSchema, record),
            next,
          }),
        ).rejects.toThrow(/completion/i);
        expect(await handle.read(key)).toEqual(record);
      });
    },
  );

  it("releases terminated work so the next accepted signal can run", async () => {
    await withClaim(async (handle, key, record) => {
      const following = accepted("next-signal");
      if (following.order === undefined || following.key === undefined)
        throw new Error("Fixture requires key and order.");
      following.order.inboxVersion = 2n;
      await handle.admit(following);
      const next = clone(AgentExecutionRecordSchema, record);
      next.status = AgentInvocationStatus.AGENT_INVOCATION_TERMINATED;
      await handle.update({
        key,
        token: "token",
        expectedRecordBytes: toBinary(AgentExecutionRecordSchema, record),
        next,
      });
      await expect(
        handle.claim(following.key, "next-token", create(TimestampSchema, { seconds: 120n })),
      ).resolves.toMatchObject({ record: { claimToken: "next-token" } });
      expect((await handle.read(key))?.status).toBe(
        AgentInvocationStatus.AGENT_INVOCATION_TERMINATED,
      );
    });
  });
});
