import { describe, expect, it } from "vitest";

import { RejectionGenerator } from "../src/generation/rejection-generator.js";
import type { Schema } from "@bufbuild/protoplugin";

describe("generated rejection documentation", () => {
  it("renders leading Proto prose as a deterministic safe S1-compatible TSDoc block", () => {
    expect(
      RejectionGenerator.tsDoc(
        "Rejects an attempt.\n@param value - text\n@internal\nNever closes */ a comment.",
      ),
    ).toBe(
      "/**\n * Rejects an attempt. \\@param value - text \\@internal Never closes *&#47; a comment.\n */\n",
    );
  });

  it("uses a deterministic summary when the Proto message has no leading comment", () => {
    expect(RejectionGenerator.tsDoc(undefined)).toBe(
      "/**\n * Creates this rejection throwable.\n */\n",
    );
  });

  it("uses the deterministic summary when a leading Proto comment has no prose", () => {
    expect(RejectionGenerator.tsDoc("\n// \n\r\n")).toBe(
      "/**\n * Creates this rejection throwable.\n */\n",
    );
  });

  it("ignores non-rejection, frozen delivery, and nested-only message files", () => {
    let generated = 0;
    const schema = {
      files: [
        { proto: { name: "message_board.proto" }, messages: [], name: "chat" },
        { proto: { name: "spine/delivery/rejections.proto" }, messages: [], name: "delivery" },
        {
          proto: { name: "chat/rejections.proto" },
          messages: [{ parent: {} }],
          name: "rejections",
        },
      ],
      generateFile: () => {
        generated++;
        throw new Error("ignored source must not generate output");
      },
    } as unknown as Schema;

    RejectionGenerator.generateCompanions(schema);

    expect(generated).toBe(0);
  });

  it("emits a companion for an owned top-level rejection message", () => {
    const printed: string[] = [];
    const messageProto = {};
    const message = {
      kind: "message",
      name: "TaskRejected",
      parent: undefined,
      proto: messageProto,
      file: { proto: { messageType: [messageProto] } },
    };
    const output = {
      import: (name: string) => name,
      preamble: () => undefined,
      importSchema: () => "TaskRejectedSchema",
      print: (...parts: readonly string[]) => printed.push(parts.join("")),
      export: (_kind: string, name: string) => `export const ${name}`,
    };
    const schema = {
      files: [
        {
          proto: { name: "tasks/rejections.proto" },
          messages: [message],
          name: "tasks/rejections",
        },
      ],
      generateFile: () => output,
    } as unknown as Schema;

    RejectionGenerator.generateCompanions(schema);

    expect(printed).toEqual([
      expect.stringContaining("export const TaskRejected: { readonly create"),
    ]);
  });
});
