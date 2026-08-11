import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkRejectionSourceNames,
  isRejectionSourceName,
  main,
  trackedProtoSources,
} from "./check-rejection-conventions.mjs";

describe("rejection source conventions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("reports invalid sources and returns a failing CLI status", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(main(["domain/notrejections.proto"])).toBe(1);
    expect(error).toHaveBeenCalledWith(
      'domain/notrejections.proto must use "rejections.proto" or "*_rejections.proto".',
    );
  });

  it("enumerates the tracked repository sources in the live CLI path", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    expect(main()).toBe(0);
    expect(log).toHaveBeenCalledWith("Rejection source naming checks passed.");
  });

  it("fails closed when Git cannot enumerate tracked Proto sources", () => {
    const failure = new Error("git is unavailable");

    expect(() => trackedProtoSources(() => ({ error: failure, status: null, stdout: "" }))).toThrow(
      failure,
    );
    expect(() => trackedProtoSources(() => ({ error: undefined, status: 1, stdout: "" }))).toThrow(
      "Could not enumerate tracked Proto sources.",
    );
  });
});
