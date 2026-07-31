import { create } from "@bufbuild/protobuf";
import {
  ConstraintViolationSchema,
  ErrorSchema,
  FieldPathSchema,
  TemplateStringSchema,
  ValidationErrorSchema,
} from "@spine-event-engine/proto";
import { AnyMessages } from "@spine-event-engine/core";
import { describe, expect, it } from "vitest";

import { PostFeedback } from "../src/post-feedback.js";

describe("PostFeedback", () => {
  it("derives field messages from the server validation details", () => {
    const details = create(ValidationErrorSchema, {
      constraintViolation: [
        create(ConstraintViolationSchema, {
          fieldPath: create(FieldPathSchema, { fieldName: ["username"] }),
          message: create(TemplateStringSchema, { withPlaceholders: "Enter a username." }),
        }),
        create(ConstraintViolationSchema, {
          fieldPath: create(FieldPathSchema, { fieldName: ["text"] }),
          message: create(TemplateStringSchema, { withPlaceholders: "Enter a message." }),
        }),
      ],
    });
    const outcome = {
      kind: "error" as const,
      error: create(ErrorSchema, {
        type: "COMMAND_VALIDATION_ERROR",
        details: AnyMessages.pack(ValidationErrorSchema, details),
      }),
    };

    expect(PostFeedback.from(outcome)).toEqual({
      fields: { username: "Enter a username.", text: "Enter a message." },
    });
  });

  it("uses a general notice for non-validation outcomes", () => {
    expect(PostFeedback.from({ kind: "rejection", rejection: create(ErrorSchema) })).toEqual({
      general: "Message was not posted. Please retry.",
      fields: {},
    });
  });

  it("maps known placeholders and leaves unknown placeholders visible", () => {
    const details = create(ValidationErrorSchema, {
      constraintViolation: [
        create(ConstraintViolationSchema, {
          fieldPath: create(FieldPathSchema, { fieldName: ["profile", "username"] }),
          message: create(TemplateStringSchema, {
            withPlaceholders: "Use ${suggestion}; ${unknown} is unavailable.",
            placeholderValue: { suggestion: "Ada" },
          }),
        }),
        create(ConstraintViolationSchema, {
          fieldPath: create(FieldPathSchema, { fieldName: ["unrelated"] }),
          message: create(TemplateStringSchema, { withPlaceholders: "Ignored." }),
        }),
      ],
    });

    expect(
      PostFeedback.from({
        kind: "error",
        error: create(ErrorSchema, {
          details: AnyMessages.pack(ValidationErrorSchema, details),
        }),
      }),
    ).toEqual({ fields: { username: "Use Ada; ${unknown} is unavailable." } });
  });

  it("uses a general notice when validation details are missing or have another type", () => {
    const general = {
      general: "Message was not posted. Please retry.",
      fields: {},
    };

    expect(PostFeedback.from({ kind: "error", error: create(ErrorSchema) })).toEqual(general);
    expect(
      PostFeedback.from({
        kind: "error",
        error: create(ErrorSchema, {
          details: AnyMessages.pack(ErrorSchema, create(ErrorSchema)),
        }),
      }),
    ).toEqual(general);
    expect(
      PostFeedback.from({
        kind: "error",
        error: create(ValidationErrorSchema),
      } as never),
    ).toEqual(general);
  });

  it("ignores field violations without a useful message", () => {
    const details = create(ValidationErrorSchema, {
      constraintViolation: [
        create(ConstraintViolationSchema, {
          fieldPath: create(FieldPathSchema, { fieldName: ["username"] }),
        }),
        create(ConstraintViolationSchema, {
          fieldPath: create(FieldPathSchema, { fieldName: ["text"] }),
          message: create(TemplateStringSchema),
        }),
      ],
    });

    expect(
      PostFeedback.from({
        kind: "error",
        error: create(ErrorSchema, {
          details: AnyMessages.pack(ValidationErrorSchema, details),
        }),
      }),
    ).toEqual({
      general: "Message was not posted. Please retry.",
      fields: {},
    });
  });
});
