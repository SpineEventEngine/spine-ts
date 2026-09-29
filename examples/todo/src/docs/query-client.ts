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
import { Client } from "@spine-event-engine/client-node";
import { AnyMessages } from "@spine-event-engine/core";
import type { QueryResponse } from "@spine-event-engine/proto/client";

import { TaskListIdSchema } from "../../generated/spine/examples/todo/task_id_pb.js";
import { TaskListSchema, type TaskList } from "../../generated/spine/examples/todo/task_list_pb.js";
import { TaskListQuery } from "../../generated/spine/examples/todo/task_list_query.js";

/**
 * Groups the actor-bound generated-query example methods.
 */
export const TaskListReader: Readonly<{
  readOpen(baseUrl: string, taskId: string): Promise<readonly TaskList[]>;
  states(response: QueryResponse): readonly TaskList[];
}> = Object.freeze({
  /**
   * Reads complete TaskList states through the Node client.
   *
   * @param baseUrl The running To-Do server URL.
   * @param taskId The TaskList ID created by the smoke command.
   * @returns Complete matching TaskList state messages.
   */
  async readOpen(baseUrl, taskId) {
    const client = Client.connectTo(baseUrl);
    try {
      // The generated import supplies the column and query builder.
      const query = TaskListQuery.create()
        .byId(create(TaskListIdSchema, { value: taskId }))
        .openTaskCount()
        .isAtLeast(1)
        .build();
      // send() binds the request's actor and tenant when it executes the query.
      const response = await client.onBehalfOf("todo-query-user").send(query);
      return TaskListReader.states(response);
    } finally {
      await client.close();
    }
  },

  /**
   * Decodes complete TaskList states from a query response.
   *
   * @param response The query response to inspect.
   * @returns Recognized TaskList states, omitting absent or foreign states.
   */
  states(response) {
    return response.message.flatMap((row) => {
      const state =
        row.state === undefined ? undefined : AnyMessages.unpack(row.state, TaskListSchema);
      return state === undefined ? [] : [state];
    });
  },
});
