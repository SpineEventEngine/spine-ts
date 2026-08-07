import { describe, expect, it } from "vitest";
import { ownedProtoStyleFailures } from "./check-owned-proto-style.mjs";

describe("authored Proto style", () => {
  it("rejects optional outside comments and strings", () => {
    expect(
      ownedProtoStyleFailures(
        'syntax = "proto3";\nmessage Item {\n  optional string value = 1;\n}',
      ),
    ).toContain("authored.proto: authored Proto must not use optional");
    expect(
      ownedProtoStyleFailures('// optional is forbidden.\noption note = "optional";\n'),
    ).toEqual([]);
  });

  it("requires blank separation before declaration documentation", () => {
    const source = [
      'syntax = "proto3";',
      "",
      "message Item {",
      "",
      "  // The first value.",
      "  string first = 1;",
      "  // The second value.",
      "  string second = 2;",
      "}",
    ].join("\n");

    expect(ownedProtoStyleFailures(source)).toContain(
      "authored.proto:7: declaration documentation needs a blank line",
    );
  });

  it("requires a trailing blank comment line after multiple paragraphs", () => {
    const source = [
      'syntax = "proto3";',
      "",
      "// A stored item.",
      "//",
      "// It survives a restart.",
      "message Item {}",
    ].join("\n");

    expect(ownedProtoStyleFailures(source)).toContain(
      "authored.proto:6: multi-paragraph comment must end with //",
    );
  });
});
