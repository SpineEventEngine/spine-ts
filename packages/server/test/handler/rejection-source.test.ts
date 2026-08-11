import { describe, expect, it } from "vitest";

import { RejectionSources } from "../../src/handler/rejection-source.js";

describe("rejection source matching", () => {
  it("accepts only the two rejection basename forms", () => {
    expect(RejectionSources.matches("domain/rejections.proto")).toBe(true);
    expect(RejectionSources.matches("domain/task_rejections.proto")).toBe(true);
    expect(RejectionSources.matches("domain/notrejections.proto")).toBe(false);
    expect(RejectionSources.matches("domain/task-rejections.proto")).toBe(false);
  });
});
