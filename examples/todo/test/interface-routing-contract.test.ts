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

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const todoRoot = new URL("..", import.meta.url);

function source(path: string): string {
  return readFileSync(new URL(path, todoRoot), "utf8");
}

describe("To-Do interface-routing contract", () => {
  it("marks all Task events with generated TaskEvent and only assignment lifecycle events with TaskAssignmentEvent", () => {
    const events = source("proto/spine/examples/todo/task_events.proto");
    const commands = source("proto/spine/examples/todo/task_commands.proto");

    expect(events).toContain('option (every_is).ts_type = "TaskEvent";');
    expect(events).toContain("option (every_is).generate = true;");
    expect(events).toContain('option (is).ts_type = "TaskAssignmentEvent";');
    expect(commands).not.toContain("(is)");
    expect(commands).not.toContain("(every_is)");
    expect(events).not.toContain("TaskReassignmentEvent");
  });

  it("keeps TaskList routing token-based and reassignment exact", () => {
    const application = source("src/index.ts");

    expect(application).toContain("TaskEvent");
    expect(application).toContain("TaskAssignmentEvent");
    expect(application).toContain("TaskReassignedSchema");
    expect(application).not.toContain("TaskReassignmentEvent");
  });
});
