# API Reference

TypeDoc is the canonical API documentation generator for this repository.

Current status: the generated reference contains package skeleton exports plus
the curated `@spine-ts/proto` root API for the first intake: message types,
generated schemas, file descriptors, and the `type_url_prefix` custom option.
The generated Protobuf-ES implementation files themselves remain excluded from
TypeDoc output and are not broadly re-exported from the package root.

Run:

```shell
pnpm docs:api
pnpm docs:check
```

Generated output is written to `docs/api/reference`.

`docs:check` also emits temporary TypeDoc JSON, verifies that expected
`@spine-ts/proto` entry-point exports are present in the API model, and rejects
broad generated wildcard re-exports from the package root.
