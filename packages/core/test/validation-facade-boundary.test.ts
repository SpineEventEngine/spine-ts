import { create } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationErrorSchema } from "@spine-event-engine/proto";

describe("@spine-event-engine/core validation facade upstream boundary", () => {
  afterEach(() => {
    vi.doUnmock("@spine-event-engine/validation-ts");
    vi.resetModules();
  });

  it("redacts every upstream placeholder value by default", async () => {
    vi.resetModules();
    vi.doMock("@spine-event-engine/validation-ts", () => ({
      validate: () => [
        {
          typeName: "spine.validation.ValidationError",
          fieldPath: { fieldName: ["constraint_violation"] },
          fieldValue: create(AnySchema, {
            typeUrl: "type.example.test/example.SecretPayload",
            value: new Uint8Array([115, 101, 99, 114, 101, 116]),
          }),
          message: {
            withPlaceholders: "The value `${value}` is invalid for `${token}`.",
            placeholderValue: {
              value: "raw@example.test",
              token: "secret-token",
              field: "constraint_violation",
              minimum: "3",
              candidate: "arbitrary-secret-candidate",
              email: "private@example.test",
            },
          },
        },
      ],
    }));

    const { ValidationException, checkValid, validateMessage } = await import("../src/index.js");
    const result = validateMessage(ValidationErrorSchema, create(ValidationErrorSchema, {}));

    expect(result.valid).toBe(false);
    expect(result.violations[0]?.fieldValue).toBeUndefined();
    expect(result.violations[0]?.message?.placeholderValue).toEqual({
      value: "[redacted]",
      token: "[redacted]",
      field: "[redacted]",
      minimum: "[redacted]",
      candidate: "[redacted]",
      email: "[redacted]",
    });
    expect(JSON.stringify(result.violations)).not.toContain("arbitrary-secret-candidate");
    expect(JSON.stringify(result.error)).not.toContain("raw@example.test");
    expect(JSON.stringify(result.error)).not.toContain("secret-token");
    expect(JSON.stringify(result.error)).not.toContain("private@example.test");

    try {
      checkValid(ValidationErrorSchema, create(ValidationErrorSchema, {}));
      throw new Error("Expected checkValid() to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationException);
      const validationError = (error as InstanceType<typeof ValidationException>).asMessage();

      expect(validationError.constraintViolation[0]?.message?.placeholderValue).toEqual({
        value: "[redacted]",
        token: "[redacted]",
        field: "[redacted]",
        minimum: "[redacted]",
        candidate: "[redacted]",
        email: "[redacted]",
      });
      expect(JSON.stringify(validationError)).not.toContain("arbitrary-secret-candidate");
      expect(JSON.stringify(validationError)).not.toContain("private@example.test");
    }
  });

  it("returns structured validation failures when the upstream validator throws", async () => {
    vi.resetModules();
    vi.doMock("@spine-event-engine/validation-ts", () => ({
      validate: () => {
        throw new Error("raw upstream payload secret");
      },
    }));

    const { ValidationException, checkValid, validateMessage } = await import("../src/index.js");
    const message = create(ValidationErrorSchema, {});
    const result = validateMessage(ValidationErrorSchema, message);

    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.typeName).toBe("spine.validation.ValidationError");
    expect(result.violations[0]?.message?.withPlaceholders).toBe("Validation runtime failed.");
    expect(JSON.stringify(result.error)).not.toContain("raw upstream payload secret");

    expect(() => checkValid(ValidationErrorSchema, message)).toThrow(ValidationException);

    try {
      checkValid(ValidationErrorSchema, message);
      throw new Error("Expected checkValid() to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationException);
      expect(
        (error as InstanceType<typeof ValidationException>).asMessage().constraintViolation,
      ).toHaveLength(1);
    }
  });
});
