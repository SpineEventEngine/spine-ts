# API Reference

TypeDoc is the canonical API documentation generator for this repository.

Current status: the generated reference contains package skeleton exports plus
the public generated schema exports from `@spine-ts/proto`. The generated
Protobuf-ES source files themselves remain excluded from TypeDoc output to keep
the API reference focused on package entry points.

Run:

```shell
pnpm docs:api
```

Generated output is written to `docs/api/reference`.
