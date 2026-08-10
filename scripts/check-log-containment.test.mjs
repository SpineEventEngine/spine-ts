import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";

function check(source, boundaries, sourcePath = "source.ts") {
  const root = mkdtempSync(join(tmpdir(), "spine-log-check-"));
  const file = join(root, sourcePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  writeFileSync(join(root, "fixture.test.ts"), "export {};\n");
  const manifest = join(root, "manifest.json");
  writeFileSync(manifest, JSON.stringify({ boundaries }));
  return spawnSync(process.execPath, ["scripts/check-log-containment.mjs", manifest], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function boundary(id, source = "source.ts") {
  return {
    id,
    source,
    operation: "retry",
    disposition: "warn",
    test: "scripts/check-log-containment.test.mjs",
  };
}

test("allows every checked containment pattern when it has an adjacent manifest binding", () => {
  for (const [name, source] of [
    ["empty catch", "// spine-log-boundary: empty\ntry {} catch {}\n"],
    ["detached catch", "// spine-log-boundary: detached\npromise.catch(() => work());\n"],
    ["voided catch", "// spine-log-boundary: voided\nvoid promise.catch(() => undefined);\n"],
    [
      "catch undefined sentinel",
      "// spine-log-boundary: undefined\nawait promise.catch(() => undefined);\n",
    ],
    [
      "catch boolean sentinel",
      "// spine-log-boundary: boolean\nawait promise.catch(() => false);\n",
    ],
    [
      "catch empty sentinel",
      "// spine-log-boundary: empty_value\nawait promise.catch(() => {});\n",
    ],
    [
      "rejection callback sentinel",
      "// spine-log-boundary: rejection\nawait promise.then(work, () => undefined);\n",
    ],
  ]) {
    const id = source.match(/spine-log-boundary: ([a-z_]+)/)?.[1];
    const result = check(source, [boundary(id)]);
    assert.equal(result.status, 0, name);
  }
});

test("names every unannotated detectable containment suppression", () => {
  for (const [name, source] of [
    ["empty catch", "try {} catch {}\n"],
    ["detached or voided catch", "promise.catch(() => work());\n"],
    ["detached or voided catch", "void promise.catch(() => undefined);\n"],
    ["catch callback fulfills sentinel", "await promise.catch(() => undefined);\n"],
    ["catch callback fulfills sentinel", "await promise.catch(() => false);\n"],
    ["catch callback fulfills sentinel", "await promise.catch(() => {});\n"],
    ["rejection callback fulfills sentinel", "await promise.then(work, () => undefined);\n"],
  ]) {
    const result = check(source, [boundary("missing")]);
    assert.equal(result.status, 1, name);
    assert.match(result.stderr, new RegExp(`unannotated ${name}`));
  }
});

test("allows rethrows, Promise.allSettled, and nested non-containment catches", () => {
  const result = check(
    [
      "// spine-log-boundary: rethrow",
      "void promise.catch((error) => { throw error; });",
      "// spine-log-boundary: settled",
      "await Promise.allSettled([promise]);",
      "const value = await promise.catch((error) => ({ error }));",
    ].join("\n"),
    [boundary("rethrow"), boundary("settled")],
  );
  assert.equal(result.status, 0, result.stderr);
});

test("requires one adjacent source comment for each manifest ID and resolves sources from the manifest", () => {
  const accepted = check(
    "// spine-log-boundary: nested\ntry {} catch { report(); }\n",
    [boundary("nested", "fixtures/source.ts")],
    "fixtures/source.ts",
  );
  assert.equal(accepted.status, 0, accepted.stderr);

  const detached = check("// spine-log-boundary: gap\n\n\npromise.then(work);\n", [
    boundary("gap"),
  ]);
  assert.equal(detached.status, 1);

  const duplicate = check("// spine-log-boundary: duplicate\ntry {} catch {}\n", [
    boundary("duplicate"),
    boundary("duplicate"),
  ]);
  assert.equal(duplicate.status, 1);

  const stale = check("// spine-log-boundary: stale\nconst value = 1;\n", [boundary("stale")]);
  assert.equal(stale.status, 1);
});

test("validates manifest roots and every required boundary field", () => {
  const root = mkdtempSync(join(tmpdir(), "spine-log-manifest-"));
  writeFileSync(
    join(root, "source.ts"),
    "// spine-log-boundary: retry\ntry {} catch { report(); }\n",
  );
  for (const manifest of [
    null,
    [],
    {},
    { boundaries: [{}] },
    { boundaries: [boundary("bad", "../source.ts")] },
    { boundaries: [{ ...boundary("absolute-test"), test: "/tmp/fixture.test.ts" }] },
    { boundaries: [{ ...boundary("traversal-test"), test: "../fixture.test.ts" }] },
  ]) {
    const path = join(root, `manifest-${Math.random().toString(16).slice(2)}.json`);
    writeFileSync(path, JSON.stringify(manifest));
    const result = spawnSync(process.execPath, ["scripts/check-log-containment.mjs", path], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
  }
});
