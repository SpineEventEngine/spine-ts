# Entity-metadata test Protos

These `.proto` files are test-only fixtures for the server package tests.
They intentionally live outside the curated production `proto/` root so the
server tests can exercise descriptor options without adding test-only messages
to the public schema package.

> **🧪 Maintainer-only:** application developers do not import these files.

## 🚀 Regenerate after a change

Regenerate the standard test schemas after editing any test Proto:

```shell
pnpm proto:generate
```

Validate that generated output matches the readable sources:

```shell
pnpm proto:check-generated
```

## Fixture package

`packages/server/test-fixtures` is a private model package. Its generated output
is ignored and recreated by the repository's normal Proto workflow.
