# API Reference

TypeDoc is the canonical API documentation generator for this repository.

Current status: the generated reference contains the curated `@spine-ts/proto`
root API for copied Spine contracts and the `@spine-ts/core` metadata/type
registry and validation facade APIs. Proto exports include message types,
generated schemas, enum values and enum descriptors, file descriptors, and the
`type_url_prefix` custom option for the validation, core signal envelope,
actor/tenant/user/version context, time, net, and UI language contracts. Core
exports include deterministic type URL derivation, registry and metadata types,
the default registry for the curated Spine schema set, single-message validation
result/check helpers, `ValidationException`, structured `ValidationError`
creation, and the initial transition-validation seam. The default registry is
documented as a read-only lookup view; callers that need mutable registration
use `createSpineCoreRegistry()` or `TypeRegistry`. The validation facade
documents its safe-by-default error details, including redacted upstream and
transition-rule placeholder values, omitted raw field values, sanitized
rule-returned transition violations, and structured runtime/rule failure
violations. Core envelope construction exports include `packAny()`,
`unpackAny()`, `packCommand()`, `packEvent()`, `PackAnyOptions`,
`PackCommandInput`, and `PackEventInput`. These helpers document Spine-aware
`Any` type URLs, validation-before-packing defaults, unknown-field elision for
framework-packed payloads, safe `undefined` results for type URL mismatches or
malformed payload bytes, and caller-supplied ID/context snapshot behavior. The
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
