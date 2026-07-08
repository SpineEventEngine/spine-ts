import { describe, expect, it } from "vitest";
import { selectFormatFiles } from "./format-files.mjs";

describe("format-files", () => {
  it("selects only tracked-format paths and skips generated output", () => {
    expect(
      selectFormatFiles([
        "package.json",
        ".prettierrc.json",
        "docs/USER_GUIDE.md",
        "packages/core/src/index.ts",
        "packages/proto/generated/spine/core/command_pb.ts",
        "examples/todo/generated/task_pb.ts",
        "examples/todo/src/index.test.ts",
        "proto/spine/README.md",
        "scripts/proto-workflow.mjs",
        "build-protocol/work-logs/T-0016a.md",
        "src/out-of-scope.ts",
      ]),
    ).toEqual([
      ".prettierrc.json",
      "build-protocol/work-logs/T-0016a.md",
      "docs/USER_GUIDE.md",
      "examples/todo/src/index.test.ts",
      "package.json",
      "packages/core/src/index.ts",
      "proto/spine/README.md",
      "scripts/proto-workflow.mjs",
    ]);
  });
});
