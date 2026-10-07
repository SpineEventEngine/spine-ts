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

import type { CommandId } from "@spine-event-engine/proto";
import {
  Agent,
  Projection,
  type BoundedContext,
  type Repository,
} from "@spine-event-engine/server";
import { readAgentHistoryPage } from "@spine-event-engine/server/testing";
import type { BlackBox } from "../src/black-box/black-box.js";
import {
  SupportReplyAgentStateSchema,
  type SupportReplyAgentId,
  SupportKnowledgeStateSchema,
  type SupportKnowledgeId,
} from "../../server/test-fixtures/generated/entity-metadata/support_agent_states_pb.js";

class TypedHistoryAgent extends Agent<SupportReplyAgentId, typeof SupportReplyAgentStateSchema> {}
class TypedKnowledgeProjection extends Projection<
  SupportKnowledgeId,
  typeof SupportKnowledgeStateSchema
> {}

/**
 * Checks the public history read binds a repository to its generated domain ID.
 * @param box Running test box.
 * @param repository Registered typed Agent repository.
 * @param agentId Correct Agent identifier.
 * @param commandId Different domain identifier.
 * @param context Context bound to the server/testing bridge.
 * @param projection Real non-Agent repository.
 * @param knowledgeId Correct ID for the non-Agent Projection.
 */
export function checkAgentHistoryIdTypes(
  box: BlackBox,
  repository: Repository<typeof TypedHistoryAgent>,
  agentId: SupportReplyAgentId,
  commandId: CommandId,
  context: BoundedContext,
  projection: Repository<typeof TypedKnowledgeProjection>,
  knowledgeId: SupportKnowledgeId,
): void {
  void box.readAgentHistory(repository, agentId, { pageSize: 1 });
  void box.readAgentHistory(TypedHistoryAgent, agentId, { pageSize: 1 });
  // @ts-expect-error A Command ID cannot identify a SupportReply Agent.
  void box.readAgentHistory(repository, commandId, { pageSize: 1 });
  // @ts-expect-error A Command ID cannot identify the generated Agent class.
  void box.readAgentHistory(TypedHistoryAgent, commandId, { pageSize: 1 });
  // @ts-expect-error A Projection repository cannot provide Agent history.
  void box.readAgentHistory(projection, knowledgeId, { pageSize: 1 });
  // @ts-expect-error A Projection class cannot provide Agent history.
  void box.readAgentHistory(TypedKnowledgeProjection, knowledgeId, { pageSize: 1 });
  // @ts-expect-error The server/testing bridge also excludes Projection repositories.
  void readAgentHistoryPage(context, projection, knowledgeId, { pageSize: 1 });
  // @ts-expect-error The server/testing bridge also excludes Projection classes.
  void readAgentHistoryPage(context, TypedKnowledgeProjection, knowledgeId, { pageSize: 1 });
}
