import { describe, expect, it } from "vitest";

import {
  checkRejectionSourceNames,
  isRejectionSourceName,
} from "./check-rejection-conventions.mjs";

describe("rejection source conventions", () => {
  it("accepts the single-file and domain-entity filename forms", () => {
    expect(isRejectionSourceName("domain/rejections.proto")).toBe(true);
    expect(isRejectionSourceName("domain/task_rejections.proto")).toBe(true);
    expect(
      checkRejectionSourceNames([
        "examples/chat/proto/chat/rejections.proto",
        "examples/todo/proto/task_rejections.proto",
      ]),
    ).toEqual([]);
  });

  it("rejects misleading rejection-like Proto basenames", () => {
    expect(isRejectionSourceName("domain/notrejections.proto")).toBe(false);
    expect(isRejectionSourceName("domain/task-rejections.proto")).toBe(false);
    expect(
      checkRejectionSourceNames([
        "domain/notrejections.proto",
        "domain/task-rejections.proto",
        "domain/rejection.proto",
        "domain/tasks.proto",
      ]),
    ).toEqual([
      'domain/notrejections.proto must use "rejections.proto" or "*_rejections.proto".',
      'domain/rejection.proto must use "rejections.proto" or "*_rejections.proto".',
      'domain/task-rejections.proto must use "rejections.proto" or "*_rejections.proto".',
    ]);
  });
});
