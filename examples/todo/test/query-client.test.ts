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
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { AnyMessages } from "@spine-event-engine/core";
import { ErrorSchema, ResponseSchema, StatusSchema } from "@spine-event-engine/proto";
import {
  EntityStateWithVersionSchema,
  QueryResponseSchema,
  type QueryResponse,
} from "@spine-event-engine/proto/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskIdSchema, TaskListIdSchema } from "../generated/spine/examples/todo/task_id_pb.js";
import { TaskListSchema } from "../generated/spine/examples/todo/task_list_pb.js";

const clientProbe = vi.hoisted(() => ({
  response: undefined as QueryResponse | undefined,
  closes: 0,
}));

vi.mock("@spine-event-engine/client-node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spine-event-engine/client-node")>();
  return {
    ...actual,
    Client: {
      ...actual.Client,
      connectTo: () => ({
        onBehalfOf: () => ({
          send: () =>
            clientProbe.response === undefined
              ? Promise.reject(new Error("Missing query test response."))
              : Promise.resolve(clientProbe.response),
        }),
        close: () => {
          clientProbe.closes += 1;
          return Promise.resolve();
        },
      }),
    },
  };
});

import { TaskListReader } from "../src/docs/query-client.js";

describe("TaskListReader", () => {
  beforeEach(() => {
    clientProbe.response = undefined;
    clientProbe.closes = 0;
  });

  it("rejects a failed query response and closes its client", async () => {
    clientProbe.response = create(QueryResponseSchema, {
      response: create(ResponseSchema, {
        status: create(StatusSchema, {
          status: {
            case: "error",
            value: create(ErrorSchema, {
              type: "INVALID_QUERY",
              message: "The TaskList filter was rejected.",
            }),
          },
        }),
      }),
    });

    await expect(TaskListReader.readOpen("http://todo.test", "list-1")).rejects.toThrow(
      "The TaskList filter was rejected.",
    );
    expect(clientProbe.closes).toBe(1);
  });

  it("returns an empty successful query and closes its client", async () => {
    clientProbe.response = create(QueryResponseSchema, {
      response: create(ResponseSchema, {
        status: create(StatusSchema, {
          status: { case: "ok", value: create(EmptySchema) },
        }),
      }),
    });

    await expect(TaskListReader.readOpen("http://todo.test", "list-1")).resolves.toEqual([]);
    expect(clientProbe.closes).toBe(1);
  });

  it("decodes a successful TaskList response and omits foreign rows", async () => {
    const list = create(TaskListSchema, {
      id: create(TaskListIdSchema, { value: "list-1" }),
      openTaskCount: 1,
    });
    clientProbe.response = create(QueryResponseSchema, {
      response: create(ResponseSchema, {
        status: create(StatusSchema, {
          status: { case: "ok", value: create(EmptySchema) },
        }),
      }),
      message: [
        create(EntityStateWithVersionSchema),
        create(EntityStateWithVersionSchema, {
          state: AnyMessages.pack(TaskIdSchema, create(TaskIdSchema, { value: "foreign" })),
        }),
        create(EntityStateWithVersionSchema, { state: AnyMessages.pack(TaskListSchema, list) }),
      ],
    });

    await expect(TaskListReader.readOpen("http://todo.test", "list-1")).resolves.toEqual([list]);
    expect(clientProbe.closes).toBe(1);
  });

  it("rejects a missing query status and still closes its client", async () => {
    clientProbe.response = create(QueryResponseSchema);

    await expect(TaskListReader.readOpen("http://todo.test", "list-1")).rejects.toThrow(
      "TaskList query failed.",
    );
    expect(clientProbe.closes).toBe(1);
  });
});
