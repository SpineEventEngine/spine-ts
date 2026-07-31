import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  baselineObservesExampleProtoEntry,
  checkExampleProtoQuality,
  escapeDiagnostic,
  scanExampleProtoContract,
  validateProtoDebtEntries,
} from "./check-example-proto-quality.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "spine-example-proto-quality-"));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: root });
  return root;
}

function writeModel(root, name, source, manifest = {}) {
  const packageRoot = join(root, "examples", name);
  const protoPath = join(packageRoot, "proto", "spine", "example", name, "v1", "model.proto");
  mkdirSync(dirname(protoPath), { recursive: true });
  writeFileSync(protoPath, source);
  writeFileSync(
    join(packageRoot, "spine-proto-manifest.json"),
    `${JSON.stringify({ formatVersion: 1, protoFiles: ["spine/example/" + name + "/v1/model.proto"], ...manifest })}\n`,
  );
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });
}

function writeTrackedProtoWithoutManifest(root) {
  const path = join(
    root,
    "examples/message-board/model/proto/spine/example/chat-model/v1/model.proto",
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `syntax = "proto3";\n// Represents a model.\nmessage Model {}\n`);
  execFileSync("git", ["add", "examples/message-board/model/proto"], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "proto without manifest"], { cwd: root });
  return path;
}

function protoDebt(name = "Model") {
  return {
    rule: "missing-comment",
    file: "examples/message-board/model/proto/spine/example/chat-model/v1/model.proto",
    identity: `message:${name}#1`,
    name,
    disposition: "migration-debt",
    reason: `Pre-T-0080C authored Proto quality debt message:${name}#1 requires remediation by the assigned slice.`,
  };
}

describe("check-example-proto-quality", () => {
  it("enforces plural domains, owned-version removal, exact prefixes, spacing, and relevant prose", () => {
    const valid = `syntax = "proto3";

package spine.examples.todo;

// Task status explains the work item state.
message Task {

  // Title names the task for a person.
  string title = 1;
}
`;
    expect(
      scanExampleProtoContract("examples/todo/proto/spine/examples/todo/tasks.proto", valid),
    ).toEqual([]);
    const invalid = `syntax = "proto3";
package spine.example.todo.v1;
// CQRS aggregate command bus metadata.
message Task {}
option (type_url_prefix) = "type.spine.examples.todo-v1";
`;
    expect(
      scanExampleProtoContract(
        "examples/todo/proto/spine/example/todo/v1/tasks.proto",
        invalid,
      ).join("\n"),
    ).toMatch(/namespace|owned-v1|type-prefix|unrelated-framework-jargon|comment-separation/);
  });

  it("does not classify required entity options as documentation jargon", () => {
    const source = `syntax = "proto3";

package spine.examples.messageboard;

// Chat message records one posted message.
message BoardMessage {
  option (entity).kind = AGGREGATE;
}
`;
    expect(
      scanExampleProtoContract(
        "examples/message-board/model/proto/spine/examples/messageboard/message_board.proto",
        source,
      ),
    ).toEqual([]);
  });

  it("rejects implementation terms in authored example documentation comments", () => {
    const source = `syntax = "proto3";

package spine.examples.messageboard;

// Read-side Projection stores the projected message.
message BoardMessageView {
  option (entity).kind = PROJECTION;
}
`;
    expect(
      scanExampleProtoContract(
        "examples/message-board/model/proto/spine/examples/messageboard/message_board.proto",
        source,
      ),
    ).toContain(
      "examples/message-board/model/proto/spine/examples/messageboard/message_board.proto unrelated-framework-jargon",
    );
  });

  it("rejects observed Projects implementation vocabulary in comments but not entity options", () => {
    const source = `syntax = "proto3";

package spine.examples.projects;

// Records a fixed-topology row for a triggering entity.
message ProjectSummary {
  option (entity).kind = PROJECTION;
  option (entity).visibility = FULL;

  // Counts updates triggered by the handled event.
  int32 updates = 1;
}
`;
    expect(
      scanExampleProtoContract(
        "examples/projects/proto/spine/examples/projects/read_models.proto",
        source,
      ),
    ).toContain(
      "examples/projects/proto/spine/examples/projects/read_models.proto unrelated-framework-jargon",
    );
  });

  it("requires a blank line before block documentation following a field", () => {
    const prefix = "examples/todo/proto/spine/examples/todo/tasks.proto";
    const invalid = `syntax = "proto3";

package spine.examples.todo;

// Task holds a work item.
message Task {

  // Title names the task.
  string title = 1;
  /* Status describes completion. */
  string status = 2;
}
`;
    expect(scanExampleProtoContract(prefix, invalid).join("\n")).toContain("comment-separation");
    expect(
      scanExampleProtoContract(prefix, invalid.replace(" = 1;\n  /*", " = 1;\n\n  /*")),
    ).toEqual([]);
  });

  it("does not treat an entity option as a preceding field", () => {
    const source = `syntax = "proto3";

package spine.examples.todo;

// Task describes one work item.
message Task {
  option (entity).kind = AGGREGATE;
  // Title gives the task a human-readable name.
  string title = 1;
}
`;
    expect(
      scanExampleProtoContract("examples/todo/proto/spine/examples/todo/tasks.proto", source),
    ).toEqual([]);
  });

  it("does not treat semicolon-looking text inside a block comment as a declaration", () => {
    const source = `syntax = "proto3";

package spine.examples.todo;

/* The prose contains ;
// but it is still one comment token. */
// Task identifies a work item.
message Task {}
`;
    expect(
      scanExampleProtoContract("examples/todo/proto/spine/examples/todo/task.proto", source),
    ).toEqual([]);
  });
  it("recursively enforces useful comments and four-component names for authored nested Proto", () => {
    const root = fixture();
    writeModel(
      root,
      "chat-model",
      `syntax = "proto3";
package spine.example.chat.v1;
message MissingComment { string field_name_with_five_parts = 1; }
`,
    );

    const failures = checkExampleProtoQuality(root);

    expect(failures.join("\n")).toContain("missing-comment message:MissingComment#1");
    expect(failures.join("\n")).toContain("semantic-name field:field_name_with_five_parts#1");
  });

  it("requires meaningful leading comments for every used named declaration form", () => {
    const root = fixture();
    writeModel(
      root,
      "forms",
      `syntax = "proto3";
package spine.example.forms.v1;
// Represents a complete form submission.
message Form {
  // TODO
  string title = 1;
  oneof choice { string text = 2; }
}
enum State { STATE_OPEN = 0; }
service FormService { rpc Submit(Form) returns (Form); }
`,
    );

    const text = checkExampleProtoQuality(root).join("\n");
    expect(text).toContain("placeholder-comment field:title#1");
    expect(text).toContain("missing-comment oneof:choice#1");
    expect(text).toContain("missing-comment field:text#1");
    expect(text).toContain("missing-comment enum:State#1");
    expect(text).toContain("missing-comment enum-value:STATE_OPEN#1");
    expect(text).toContain("missing-comment service:FormService#1");
    expect(text).toContain("missing-comment rpc:Submit#1");
  });

  it("requires comments before declaration tokens rather than between declaration tokens", () => {
    const root = fixture();
    writeModel(
      root,
      "placement",
      `syntax = "proto3";
package spine.example.placement.v1;
message // Describes the model.
Model {
  string // Stores the value.
  value = 1;
}
`,
    );

    const text = checkExampleProtoQuality(root).join("\n");
    expect(text).toContain("missing-comment message:Model#1");
    expect(text).toContain("missing-comment field:value#1");
  });

  it("rejects comments inside RPC, enum-value, and field declaration prefixes", () => {
    const root = fixture();
    writeModel(
      root,
      "prefixes",
      `syntax = "proto3";
package spine.example.prefixes.v1;
// Defines a request model.
message Request {}
// Defines a response model.
message Response {}
// Defines a model with fields.
message Model {
  // Documents a repeated field value.
  repeated // Splits the field declaration.
  string tags = 1;
  // Documents an optional field value.
  optional // Splits the field declaration.
  string alias = 2;
  // Documents a map field value.
  map // Splits the field declaration.
  <string, string> labels = 3;
  // Documents a map key field value.
  map< // Splits the map key declaration.
  string, string> labels_by_key = 4;
  // Documents a map separator field value.
  map<string // Splits the map separator declaration.
  , string> labels_by_separator = 5;
  // Documents a map value field value.
  map<string, // Splits the map value declaration.
  string> labels_by_value = 6;
  // Documents a map name field value.
  map<string, string> // Splits the map field name declaration.
  labels_by_name = 7;
  // Documents a map assignment field value.
  map<string, string> labels_by_assignment // Splits the map assignment declaration.
  = 8;
  // Documents a qualified first boundary value.
  example // Splits the field declaration.
  .prefixes.v1.Request owner_after_first = 8;
  // Documents a qualified second boundary value.
  example. // Splits the field declaration.
  prefixes.v1.Request owner_after_second = 9;
  // Documents a qualified third boundary value.
  example.prefixes // Splits the field declaration.
  .v1.Request owner_after_third = 10;
  // Documents a qualified fourth boundary value.
  example.prefixes.v1. // Splits the field declaration.
  Request owner_after_fourth = 11;
  // Documents a qualified field name value.
  example.prefixes.v1.Request // Splits the field declaration.
  owner_after_name = 12;
}
// Defines a message state enum.
enum State {
  // Documents the open state.
  STATE_OPEN // Splits the enum value declaration.
  = 0;
}
// Defines a service endpoint.
service ModelService {
  // Documents the model request.
  rpc // Splits the RPC declaration.
  Submit(Request) returns (Response);
}
`,
    );

    const text = checkExampleProtoQuality(root).join("\n");
    expect(text).toContain("missing-comment field:tags#1");
    expect(text).toContain("missing-comment field:alias#1");
    expect(text).toContain("missing-comment field:labels#1");
    expect(text).toContain("missing-comment field:labels_by_key#1");
    expect(text).toContain("missing-comment field:labels_by_separator#1");
    expect(text).toContain("missing-comment field:labels_by_value#1");
    expect(text).toContain("missing-comment field:labels_by_name#1");
    expect(text).toContain("missing-comment field:labels_by_assignment#1");
    expect(text).toContain("missing-comment field:owner_after_first#1");
    expect(text).toContain("missing-comment field:owner_after_second#1");
    expect(text).toContain("missing-comment field:owner_after_third#1");
    expect(text).toContain("missing-comment field:owner_after_fourth#1");
    expect(text).toContain("missing-comment field:owner_after_name#1");
    expect(text).toContain("missing-comment enum-value:STATE_OPEN#1");
    expect(text).toContain("missing-comment rpc:Submit#1");
  });

  it("accepts ordinary whitespace within a declaration after a leading comment", () => {
    const root = fixture();
    writeModel(
      root,
      "whitespace",
      `syntax = "proto3";
package spine.example.whitespace.v1;
// Defines a valid whitespace-tolerant model.
message
Model {
  // Stores the value in this model.
  string
  value = 1;
}
`,
    );

    expect(
      scanExampleProtoContract(
        "examples/todo/proto/spine/examples/todo/model.proto",
        `syntax = "proto3";

package spine.examples.todo;

// Defines a whitespace-tolerant task model.
message Model {

  // Stores the value for the task.
  string value = 1;
}
`,
      ),
    ).toEqual([]);
  });

  it("excludes explicitly copied sources while rejecting path-only provenance claims", () => {
    const root = fixture();
    const source = `syntax = "proto3";\npackage spine.example.copied.v1;\nmessage UnchangedCopiedNameWithFiveParts {}\n`;
    writeModel(root, "copied", source, {
      copiedProtoFiles: ["spine/example/copied/v1/model.proto"],
    });

    expect(checkExampleProtoQuality(root).join("\n")).toContain("invalid-provenance");
  });

  it("does not let an untracked manifest authorize tracked Proto", () => {
    const root = fixture();
    writeTrackedProtoWithoutManifest(root);
    writeFileSync(
      join(root, "examples/message-board/model/spine-proto-manifest.json"),
      '{"formatVersion":1,"protoFiles":["spine/example/chat-model/v1/model.proto"]}\n',
    );

    expect(checkExampleProtoQuality(root).join("\n")).toContain("invalid-provenance unlisted-file");
  });

  it("reports malformed copied provenance and absolute upstream paths deterministically", () => {
    const root = fixture();
    writeModel(root, "copied", `syntax = "proto3";\nmessage Copied {}\n`, {
      copiedProtoFiles: {},
    });
    expect(checkExampleProtoQuality(root).join("\n")).toContain("copied-source-list");

    const absolute = fixture();
    writeModel(absolute, "copied", `syntax = "proto3";\nmessage Copied {}\n`, {
      copiedProtoFiles: [
        {
          path: "spine/example/copied/v1/model.proto",
          repository: "SpineEventEngine/core-java",
          commit: "a408b0d70dafd603efc55b89c8b4b6f3e8c19d3b",
          upstreamPath: "/model.proto",
        },
      ],
    });
    expect(checkExampleProtoQuality(absolute).join("\n")).toContain("copied-source-contract");
  });

  it("accepts copied sources only with immutable upstream provenance", () => {
    const root = fixture();
    const source = `syntax = "proto3";\npackage spine.example.copied.v1;\nmessage UnchangedCopiedNameWithFiveParts {}\n`;
    writeModel(root, "copied", source, {
      copiedProtoFiles: [
        {
          path: "spine/example/copied/v1/model.proto",
          repository: "SpineEventEngine/core-java",
          commit: "a408b0d70dafd603efc55b89c8b4b6f3e8c19d3b",
          upstreamPath: "model.proto",
        },
      ],
    });

    expect(checkExampleProtoQuality(root)).toEqual([]);
  });

  it("matches Proto debt by stable declaration identity rather than mutable line number", () => {
    const entry = {
      rule: "missing-comment",
      file: "examples/todo/proto/spine/example/todo/v1/model.proto",
      identity: "message:Task#1",
    };

    expect(
      baselineObservesExampleProtoEntry(entry, `syntax = "proto3";\n\n\nmessage Task {}\n`),
    ).toBe(true);
    expect(
      baselineObservesExampleProtoEntry(
        entry,
        `syntax = "proto3";\n// Represents a task.\nmessage Task {}\n`,
      ),
    ).toBe(false);
  });

  it("discovers nested example roots and checks map fields", () => {
    const root = fixture();
    writeModel(
      root,
      "message-board/model",
      `syntax = "proto3";
package spine.example.messageboard.v1;
message Room { map<string, string> labels = 1; }
`,
    );

    const text = checkExampleProtoQuality(root).join("\n");
    expect(text).toContain(
      "examples/message-board/model/proto/spine/example/message-board/model/v1/model.proto",
    );
    expect(text).toContain("missing-comment field:labels#1");
  });

  it("does not allow a replacement ref to substitute the immutable baseline", () => {
    const root = fixture();
    writeModel(root, "chat-model", `syntax = "proto3";\nmessage Model {}\n`);
    execFileSync(
      "git",
      ["update-ref", "refs/replace/b1a3dc7b1f21e4f7239014ea56f451941ef7addd", "HEAD"],
      { cwd: root },
    );
    const directory = join(root, "build-protocol", "example-proto-debt");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "T-0080J.json"),
      '[{"rule":"missing-comment","file":"examples/message-board/model/proto/spine/example/chat-model/v1/model.proto","identity":"message:Model#1","name":"Model","disposition":"migration-debt","reason":"Pre-T-0080C authored Proto quality debt message:Model#1 requires remediation by the assigned slice."}]\n',
    );
    expect(() => checkExampleProtoQuality(root)).toThrow(
      "Immutable Proto baseline b1a3dc7b1f21e4f7239014ea56f451941ef7addd is unavailable",
    );
  });

  it("rejects malformed, duplicate, stale, broadened, and post-baseline Proto debt", () => {
    const entry = protoDebt();
    const key = `missing-comment\u0000${entry.file}\u0000${entry.identity}`;
    const valid = validateProtoDebtEntries(
      [{ partition: "T-0080J", entry }],
      new Set([key]),
      () => true,
    );
    expect(valid.stale).toEqual([]);

    expect(() =>
      validateProtoDebtEntries(
        [{ partition: "T-0080J", entry: { ...entry, extra: "no" } }],
        new Set(),
        () => true,
      ),
    ).toThrow("Malformed or broadened Proto debt entry");
    expect(() =>
      validateProtoDebtEntries(
        [
          { partition: "T-0080J", entry },
          { partition: "T-0080J", entry },
        ],
        new Set(),
        () => true,
      ),
    ).toThrow("Duplicate Proto debt entry");
    expect(
      validateProtoDebtEntries([{ partition: "T-0080J", entry }], new Set(), () => true).stale,
    ).toEqual(["message:Model#1"]);
    expect(() =>
      validateProtoDebtEntries([{ partition: "T-0080J", entry }], new Set(), () => false),
    ).toThrow("Proto debt was not observed at immutable baseline");
  });

  it("runs authored Proto quality through the root lint workflow", () => {
    expect(() =>
      execFileSync(process.execPath, ["scripts/proto-workflow.mjs", "lint"], {
        cwd: process.cwd(),
        encoding: "utf8",
      }),
    ).not.toThrow();
  });

  it("escapes control characters in stable diagnostics", () => {
    expect(escapeDiagnostic("bad\nname\u202e.proto")).toBe("bad\\u{a}name\\u{202e}.proto");
  });

  it("rejects generic mechanically copied declaration comments", () => {
    const root = fixture();
    writeModel(
      root,
      "comments",
      `syntax = "proto3";\n// This is a message.\nmessage Commented {\n  // This is a field.\n  string value = 1;\n}\n`,
    );

    const text = checkExampleProtoQuality(root).join("\n");
    expect(text).toContain("placeholder-comment message:Commented#1");
    expect(text).toContain("placeholder-comment field:value#1");
  });
});
