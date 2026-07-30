import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  assertImportCategories,
  assertPomProvenance,
  verifyTypeScriptFixtures,
  verifyWireCompatibility,
} from "./wire/verify.mjs";

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
