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
import { BlackBox } from "@spine-event-engine/testing";

import { CreateTaskSchema } from "../../generated/spine/examples/todo/task_commands_pb.js";
import { createTodoContext } from "../todo-app.js";

/**
 * Creates a task through the BlackBox client boundary.
 */
export async function createTaskThroughBlackBox(): Promise<void> {
  const box = await BlackBox.from(await createTodoContext());
  try {
    const scope = box.asGuest();
    const acknowledgement = await scope.post(
      CreateTaskSchema,
      create(CreateTaskSchema, { id: { value: "task-42" }, title: "First task" }),
    );
    if (acknowledgement.kind !== "ok") throw new Error("CreateTask was not accepted.");
  } finally {
    await box.close();
  }
}
