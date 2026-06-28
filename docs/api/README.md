# API Reference

TypeDoc is the canonical API documentation generator for this repository.

Current status: the generated reference contains package skeleton exports plus
TypeDoc-visible `@spine-ts/proto` entry-point aliases for the first-intake
generated schemas, file descriptors, and the `type_url_prefix` custom option.
The generated Protobuf-ES source files themselves remain excluded from TypeDoc
output to keep the API reference focused on package entry points.

Run:

```shell
pnpm docs:api
pnpm docs:check
```

Generated output is written to `docs/api/reference`.

`docs:check` also emits temporary TypeDoc JSON and verifies that expected
`@spine-ts/proto` entry-point exports are present in the API model.
