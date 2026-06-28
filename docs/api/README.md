# API Reference

TypeDoc is the canonical API documentation generator for this repository.

Current status: the generated reference contains the curated `@spine-ts/proto`
root API for the first intake and the `@spine-ts/core` metadata/type registry
and validation facade APIs. Proto exports include message types, generated
schemas, file descriptors, and the `type_url_prefix` custom option. Core exports
include deterministic type URL derivation, registry and metadata types, the
default registry for the current curated Spine schema set, single-message
validation result/check helpers, `ValidationException`, structured
`ValidationError` creation, and the initial transition-validation seam. The
default registry is documented as a read-only lookup view; callers that need
mutable registration use `createSpineCoreRegistry()` or `TypeRegistry`. The
validation facade documents its safe-by-default error details, including
redacted upstream placeholder values, omitted raw field values, and structured
runtime/rule failure violations. The
generated Protobuf-ES implementation files themselves remain excluded from
TypeDoc output and are not broadly re-exported from the package root.

Run:

```shell
pnpm docs:api
pnpm docs:check
```

Generated output is written to `docs/api/reference`.

`docs:check` also emits temporary TypeDoc JSON, verifies that expected
`@spine-ts/proto` and `@spine-ts/core` entry-point exports are present in the
API model, and rejects broad generated wildcard re-exports from the proto
package root.
