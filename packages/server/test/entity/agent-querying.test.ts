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

import { create, type MessageShape } from "@bufbuild/protobuf";
import {
  ActorContextSchema,
  TenantIdSchema,
  UserIdSchema,
  VersionSchema,
} from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import { Agent, type DescriptorMessageSchema } from "../../src/index.js";
import { processManagerQueryAccess } from "../../src/entity/entity.js";
import {
  SupportReplyAgentIdSchema,
  type SupportReplyAgentId,
  SupportReplyAgentStateSchema,
  SupportKnowledgeIdSchema,
  SupportKnowledgeStateSchema,
} from "../../test-fixtures/generated/entity-metadata/support_agent_states_pb.js";
import * as supportQueries from "../../test-fixtures/generated/entity-metadata/support_agent_states_query.js";

class SupportReplyLookup extends Agent<SupportReplyAgentId, typeof SupportReplyAgentStateSchema> {
  readKnowledge() {
    return this.select(
      supportQueries.SupportKnowledgeStateQuery.create().answer().is("delivery").build(),
    );
  }
}

describe("Agent query access", () => {
  it("binds a generated projection read to the active actor and tenant", async () => {
    const agent = create(SupportReplyAgentIdSchema, { ticketNumber: "T-46" });
    const lookup = new SupportReplyLookup({
      id: agent,
      schema: SupportReplyAgentStateSchema,
      state: create(SupportReplyAgentStateSchema, { id: agent }),
      version: create(VersionSchema, { number: 0 }),
    });
    const context = create(ActorContextSchema, {
      actor: create(UserIdSchema, { value: "support-reader" }),
      tenantId: create(TenantIdSchema, { kind: { case: "value", value: "tenant-1" } }),
    });
    const article = create(SupportKnowledgeStateSchema, {
      id: create(SupportKnowledgeIdSchema, { articleNumber: "K-1" }),
      answer: "delivery",
    });
    let seenContext;
    expect(() => lookup.readKnowledge()).toThrow(
      "Entity queries are available only during repository handler execution.",
    );
    const release = processManagerQueryAccess.bind(
      lookup,
      <Schema extends DescriptorMessageSchema>(
        _plan: unknown,
        _schema: Schema,
        query: { context?: unknown },
      ) => {
        seenContext = query.context;
        return Promise.resolve([article] as unknown as readonly MessageShape<Schema>[]);
      },
      context,
    );
    const read = lookup.readKnowledge();
    expect(await read.read()).toEqual([article]);
    expect(seenContext).toEqual(context);
    release();
    await expect(read.read()).rejects.toThrow(
      "Entity queries are available only during repository handler execution.",
    );
  });
});
