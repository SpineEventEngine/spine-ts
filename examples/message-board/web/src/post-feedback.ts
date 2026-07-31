import type { ClientOutcome } from "@spine-event-engine/client-web";
import { AnyMessages } from "@spine-event-engine/core";
import { ErrorSchema, ValidationErrorSchema } from "@spine-event-engine/proto";

/**
 * Describes validation messages returned for the MessageBoard form.
 */
export interface PostFeedbackValue {
  // prettier-ignore

  /**
   * Maps each invalid form field to the server-provided message.
   */
  readonly fields: Readonly<Partial<Record<"username" | "text", string>>>;

  /**
   * Explains a failure that is not tied to one form field.
   */
  readonly general?: string;
}

/**
 * Converts a command outcome into messages suitable for the post form.
 */
export const PostFeedback: Readonly<{
  // prettier-ignore

  from(outcome: Exclude<ClientOutcome, { readonly kind: "ok" }>): PostFeedbackValue;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Extracts field messages from packed server validation details.
   *
   * @param outcome The unsuccessful command outcome returned by the server.
   * @returns The field messages or a general retry notice.
   */
  from(outcome: Exclude<ClientOutcome, { readonly kind: "ok" }>): PostFeedbackValue {
    const general: PostFeedbackValue = {
      fields: {},
      general: "Message was not posted. Please retry.",
    };
    if (outcome.kind !== "error" || outcome.error.$typeName !== ErrorSchema.typeName)
      return general;
    const details = (
      outcome.error as { readonly details?: Parameters<typeof AnyMessages.unpack>[0] }
    ).details;
    const validation =
      details === undefined ? undefined : AnyMessages.unpack(details, ValidationErrorSchema);
    if (validation === undefined) return general;
    const fields: Partial<Record<"username" | "text", string>> = {};
    for (const violation of validation.constraintViolation) {
      const field = violation.fieldPath?.fieldName.at(-1);
      if (field !== "username" && field !== "text") continue;
      const template = violation.message;
      if (template === undefined || template.withPlaceholders.length === 0) continue;
      fields[field] = template.withPlaceholders.replace(
        /\$\{([^}]+)\}/gu,
        (match, name: string) => template.placeholderValue[name] ?? match,
      );
    }
    return Object.keys(fields).length === 0 ? general : { fields };
  },
});
