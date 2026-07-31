# Entity-metadata test Protos

These `.proto` files are test-only fixtures for `packages/server/test/index.test.ts`.
They intentionally live outside the curated production `proto/` root so the
server tests can exercise descriptor options without adding test-only messages
to the public schema package.

> **🧪 Maintainer-only:** application developers do not import these files.

## 🚀 Regenerate after a change

Regenerate the checked-in descriptor module after editing any test Proto:

```shell
node scripts/generate-server-test-fixtures.mjs
```

Validate that the generated module matches the readable sources:

```shell
node scripts/generate-server-test-fixtures.mjs --check
```

## ⚠️ Why there is no package

The test Protos are package-less on purpose. Buf accepts these custom Spine option
fixtures when the test files omit a `package` declaration.
