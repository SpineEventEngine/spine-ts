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
import {
  AgentAcceptedInvocationSchema,
  AgentExecutionRecordSchema,
  AgentExecutionStartSchema,
  AgentExecutionScopeSchema,
  AgentInvocationBoundsSchema,
  AgentInvocationKeySchema,
  AgentSignalKeySchema,
  AgentInvocationStatus,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import { CommandIdSchema, VersionSchema } from "@spine-event-engine/proto";
import { ModelRef } from "@spine-event-engine/ai";
import { AiModelKind } from "@spine-event-engine/proto/agent";
import type { AgentExecutionStorage } from "@spine-event-engine/storage/provider";
import type { Message } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { AgentExecutionSession } from "../../src/agent/agent-execution-session.js";

describe("Agent execution fence queue", () => {
  it("refreshes the exact record image after a serialized renewal", async () => {
    const key = create(AgentInvocationKeySchema, {
      scope: create(AgentExecutionScopeSchema, { stateType: "support.Agent", agentKey: "A" }),
      sourceSignal: create(AgentSignalKeySchema, {
        id: { case: "command", value: create(CommandIdSchema, { uuid: "source" }) },
      }),
    });
    let stored = create(AgentExecutionRecordSchema, {
      accepted: create(AgentAcceptedInvocationSchema, { key }),
      status: AgentInvocationStatus.AGENT_INVOCATION_ACTIVE,
      claimToken: "claim",
      claimExpiresAt: create(TimestampSchema, { seconds: 10n }),
    });
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const observations: Uint8Array[] = [];
    const port: Pick<
      AgentExecutionStorage<unknown, Message>,
      "capacity" | "update" | "renew" | "read" | "complete" | "markDelivered"
    > = {
      capacity: {},
      update: async (input) => {
        observations.push(input.expectedRecordBytes);
        expect(input.expectedRecordBytes).toEqual(toBinary(AgentExecutionRecordSchema, stored));
        await blocked;
        stored = clone(AgentExecutionRecordSchema, input.next);
      },
      renew: (_key, _token, expiresAt) => {
        stored = clone(AgentExecutionRecordSchema, stored);
        stored.claimExpiresAt = expiresAt;
        return Promise.resolve(true);
      },
      read: () => Promise.resolve(clone(AgentExecutionRecordSchema, stored)),
      complete: () => Promise.resolve(),
      markDelivered: () => Promise.resolve(),
    };
    const session = new AgentExecutionSession(port, stored, "claim");
    const first = session.update((record) => {
      const next = clone(AgentExecutionRecordSchema, record);
      next.started = create(AgentExecutionStartSchema, {
        deadline: create(TimestampSchema, { seconds: 100n }),
        initialVersion: create(VersionSchema, { number: 0 }),
        bounds: create(AgentInvocationBoundsSchema, { operations: 1n }),
      });
      return next;
    });
    const renewed = session.renew(create(TimestampSchema, { seconds: 20n }));
    release?.();
    await first;
    await renewed;
    await session.update((record) => clone(AgentExecutionRecordSchema, record));
    expect(observations).toHaveLength(2);
    expect(session.record().claimExpiresAt?.seconds).toBe(20n);
    expect(session.signal.aborted).toBe(false);
    session.stagePreference(AiModelKind.GENERATION, ModelRef.of("later", "v2"));
    expect(session.preferences()[0]?.selection.case).toBe("model");
    session.stagePreference(AiModelKind.GENERATION, undefined);
    expect(session.preferences()[0]?.selection.case).toBe("inheritRepositoryDefault");
    session.discardPreferenceChanges();
    expect(session.preferences()).toEqual([]);
    session.stop();
    expect(() => {
      session.stagePreference(AiModelKind.DECISION, undefined);
    }).toThrow("active");
  });
});
