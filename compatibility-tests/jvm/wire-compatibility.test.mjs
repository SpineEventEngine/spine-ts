import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  assertImportCategories,
  assertPomProvenance,
  restoreFrozenProto,
  verifyTypeScriptFixtures,
  verifyWireCompatibility,
} from "./wire/verify.mjs";

test("compares approved local adaptations as frozen upstream bytes and rejects other changes", async () => {
  const manifest = JSON.parse(await readFile("packages/proto/proto/spine-sources.json", "utf8"));
  const sources = new Map(manifest.sources.map((entry) => [entry.localPath, entry]));
  for (const file of ["spine/client/filters.proto", "spine/client/query_service.proto"]) {
    const local = await readFile(`packages/proto/proto/${file}`);
    const restored = restoreFrozenProto(file, local, sources);
    assert.notDeepEqual(restored, local);
    const changed = Buffer.from(local.toString("utf8").replace("syntax =", "syntax  ="));
    assert.throws(
      () => restoreFrozenProto(file, changed, sources),
      /file incompatibility: local checksum differs/,
    );
  }
});

test("fails closed when the frozen POM provenance or category manifest changes", async () => {
  assert.throws(
    () =>
      assertImportCategories({ compared: 0, unresolvedWire: 6, annotationOnly: 1, googleWkt: 8 }),
    /category incompatibility/,
  );
  assert.throws(
    () => assertPomProvenance(Buffer.from("<project/>")),
    /provenance incompatibility: frozen POM digest changed/,
  );
});

test("creates deterministic populated TypeScript-owned fixtures and preserves unknown fields", async () => {
  const first = await verifyTypeScriptFixtures();
  const second = await verifyTypeScriptFixtures();
  assert.equal(first.length > 0, true);
  assert.deepEqual(first, second);
});

test("fails closed after inventorying missing frozen wire dependencies and removes extraction", async () => {
  await assert.rejects(
    verifyWireCompatibility(),
    /file incompatibility: missing wire-bearing imports \(6\): spine\/base\/error\.proto, spine\/base\/field_path\.proto, spine\/net\/email_address\.proto, spine\/net\/internet_domain\.proto, spine\/time\/time\.proto, spine\/ui\/language\.proto; compared=16; annotation-only=1; wkt=8/,
  );
  await assert.rejects(access(resolve("compatibility-tests/jvm/.cache/staging")));
});

test("fails closed with a descriptor category when the service closure changes", async () => {
  await assert.rejects(verifyWireCompatibility({ services: [] }), /descriptor incompatibility:/);
});
