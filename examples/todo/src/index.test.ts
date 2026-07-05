import { describe, expect, it } from "vitest";

import { TaskSchema } from "../generated/spine/example/todo/v1/tasks_pb.js";
import { exampleSkeleton } from "./index.js";

describe("@spine-ts/example-todo", () => {
  it("exports skeleton metadata", () => {
    expect(exampleSkeleton).toEqual({
      implementationStatus: "skeleton",
      packageName: "@spine-ts/example-todo",
    });
  });

  it("imports generated task schemas directly", () => {
    expect(TaskSchema.typeName).toBe("spine.example.todo.v1.Task");
  });
});
