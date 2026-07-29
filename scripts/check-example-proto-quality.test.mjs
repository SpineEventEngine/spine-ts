import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  baselineObservesExampleProtoEntry,
  checkExampleProtoQuality,
  escapeDiagnostic,
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
  const path = join(root, "examples/chat/model/proto/spine/example/chat-model/v1/model.proto");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `syntax = "proto3";\n// Represents a model.\nmessage Model {}\n`);
  execFileSync("git", ["add", "examples/chat/model/proto"], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "proto without manifest"], { cwd: root });
  return path;
}

function protoDebt(name = "Model") {
  return {
    rule: "missing-comment",
    file: "examples/chat/model/proto/spine/example/chat-model/v1/model.proto",
    identity: `message:${name}#1`,
    name,
    disposition: "migration-debt",
    reason: `Pre-T-0080C authored Proto quality debt message:${name}#1 requires remediation by the assigned slice.`,
  };
}

describe("check-example-proto-quality", () => {
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
      join(root, "examples/chat/model/spine-proto-manifest.json"),
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
      "chat/model",
      `syntax = "proto3";
package spine.example.chat.v1;
message Room { map<string, string> labels = 1; }
`,
    );

    const text = checkExampleProtoQuality(root).join("\n");
    expect(text).toContain("examples/chat/model/proto/spine/example/chat/model/v1/model.proto");
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
      '[{"rule":"missing-comment","file":"examples/chat/model/proto/spine/example/chat-model/v1/model.proto","identity":"message:Model#1","name":"Model","disposition":"migration-debt","reason":"Pre-T-0080C authored Proto quality debt message:Model#1 requires remediation by the assigned slice."}]\n',
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
    const result = execFileSync(process.execPath, ["scripts/proto-workflow.mjs", "lint"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result).toContain("Example Proto quality checks passed.");
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
