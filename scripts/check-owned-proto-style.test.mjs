import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkOwnedProtoStyle,
  fixtureProtoNameFailures,
  ownedProtoStyleFailures,
  protoRoleFailures,
} from "./check-owned-proto-style.mjs";

function protoStyleFixture() {
  const root = mkdtempSync(join(tmpdir(), "spine-proto-style-"));
  run("git", ["init"], root);
  run("git", ["config", "user.email", "test@example.invalid"], root);
  run("git", ["config", "user.name", "Test User"], root);
  mkdirSync(join(root, "packages/proto/proto"), { recursive: true });
  writeFileSync(join(root, "packages/proto/proto/spine-sources.json"), '{"sources":[]}\n');
  return root;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`);
}

function markOriginMaster(root) {
  run("git", ["update-ref", "refs/remotes/origin/master", "HEAD"], root);
}

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

  it("accepts Buf-formatted documentation for a message's first field", () => {
    const source = [
      'syntax = "proto3";',
      "",
      "message Item {",
      "  // The stored value.",
      "  string value = 1;",
      "}",
    ].join("\n");

    expect(ownedProtoStyleFailures(source)).toEqual([]);
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

  it("enforces state and signal source roles while leaving domain meaning to review", () => {
    const entitySource = 'option (entity).kind = "Project";\n';

    expect(
      protoRoleFailures('syntax = "proto3";\nmessage Project {}\n', "fixture/states.proto"),
    ).toEqual(["fixture/states.proto: state source must declare an (entity).kind option"]);
    expect(
      protoRoleFailures('syntax = "proto3";\nmessage Project {}\n', "fixture/commands.proto"),
    ).toEqual([]);
    for (const path of ["fixture/project_commands.proto", "fixture/project_events.proto"]) {
      expect(protoRoleFailures(entitySource, path)).toEqual([
        `${path}: command/event source must not declare an entity state`,
      ]);
    }
  });

  it("rejects generic package fixture Proto filenames", () => {
    for (const name of ["black_box.proto", "signal_envelopes.proto"]) {
      expect(fixtureProtoNameFailures(`packages/core/test-fixtures/proto/${name}`)).not.toEqual([]);
    }
  });

  it("ignores unchanged example baseline style debt but rejects a modified example", () => {
    const root = protoStyleFixture();
    const path = join(root, "examples/todo/proto/spine/examples/todo/commands.proto");
    mkdirSync(join(root, "examples/todo/proto/spine/examples/todo"), { recursive: true });
    writeFileSync(path, "message Baseline {}\n// A command.\nmessage Command {}\n");
    run("git", ["add", "."], root);
    run("git", ["commit", "-m", "baseline"], root);
    markOriginMaster(root);

    expect(checkOwnedProtoStyle(root)).toEqual([]);

    writeFileSync(
      path,
      "message Baseline {}\n// A command.\nmessage Command {}\n// Another command.\nmessage Next {}\n",
    );
    expect(checkOwnedProtoStyle(root)).toContain(
      "examples/todo/proto/spine/examples/todo/commands.proto:2: declaration documentation needs a blank line",
    );
  });

  it("rejects untracked non-frozen package fixture Proto", () => {
    const root = protoStyleFixture();
    const path = join(root, "packages/core/test-fixtures/proto/fixture.proto");
    mkdirSync(join(root, "packages/core/test-fixtures/proto"), { recursive: true });
    writeFileSync(path, 'syntax = "proto3";\n');
    run("git", ["add", "."], root);
    run("git", ["commit", "-m", "baseline"], root);
    markOriginMaster(root);
    writeFileSync(
      join(root, "packages/core/test-fixtures/proto/invalid.proto"),
      'syntax = "proto3";\n',
    );

    expect(checkOwnedProtoStyle(root)).toContain(
      "packages/core/test-fixtures/proto/invalid.proto: test-fixture Proto filename needs a role suffix",
    );
  });
});
