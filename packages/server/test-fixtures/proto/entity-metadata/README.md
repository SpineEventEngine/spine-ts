# Server Entity Metadata Test Fixtures

These `.proto` files are test-only fixtures for `packages/server/test/index.test.ts`.
They intentionally live outside the curated production `proto/` root so the
server tests can exercise descriptor options without broadening the public
schema surface.

Regenerate the checked-in descriptor module after editing any fixture:

```shell
node scripts/generate-server-test-fixtures.mjs
```

Validate that the generated module is synchronized with the readable sources:

```shell
node scripts/generate-server-test-fixtures.mjs --check
```

The fixtures are package-less on purpose. Buf accepts these custom Spine option
fixtures when the test files omit a `package` declaration.
