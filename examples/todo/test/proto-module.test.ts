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
      "spine/example/todo/v1/task_commands.proto",
      "spine/example/todo/v1/task_events.proto",
      "spine/example/todo/v1/task_id.proto",
      "spine/example/todo/v1/task_list.proto",
      "spine/example/todo/v1/task_rejections.proto",
      "spine/example/todo/v1/tasks.proto",
    ]);
    expect(Object.keys(manifest.generatedExports)).toEqual(manifest.protoFiles);
    expect(existsSync(join(todoRoot.pathname, "generated/spine/options_pb.ts"))).toBe(false);
    expect(existsSync(join(todoRoot.pathname, "dist/generated/spine/options_pb.js"))).toBe(false);
    expect(existsSync(join(todoRoot.pathname, "dist/generated/proto-module.js"))).toBe(true);
  });
});
