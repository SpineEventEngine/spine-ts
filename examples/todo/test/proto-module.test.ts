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

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { todoProtoModule } from "@spine-event-engine/example-todo";

const todoRoot = new URL("..", import.meta.url);

describe("Todo Proto model package", () => {
  it("publishes only Todo-owned schemas in its frozen module and manifest", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../spine-proto-manifest.json", import.meta.url), "utf8"),
    ) as { protoFiles: string[]; generatedExports: Record<string, string> };

    expect(Object.isFrozen(todoProtoModule)).toBe(true);
    expect(todoProtoModule.name).toBe("@spine-event-engine/example-todo");
    expect(todoProtoModule.dependencies).toHaveLength(1);
    expect(manifest.protoFiles).toEqual([
      "spine/examples/todo/task_commands.proto",
      "spine/examples/todo/task_events.proto",
      "spine/examples/todo/task_id.proto",
      "spine/examples/todo/task_list.proto",
      "spine/examples/todo/task_rejections.proto",
      "spine/examples/todo/tasks.proto",
    ]);
    expect(Object.keys(manifest.generatedExports)).toEqual(manifest.protoFiles);
    expect(existsSync(join(todoRoot.pathname, "generated/spine/options_pb.ts"))).toBe(false);
    expect(existsSync(join(todoRoot.pathname, "dist/generated/spine/options_pb.js"))).toBe(false);
    expect(existsSync(join(todoRoot.pathname, "dist/generated/proto-module.js"))).toBe(true);
  });
});
