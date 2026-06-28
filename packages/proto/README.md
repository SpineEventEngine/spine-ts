# @spine-ts/proto

Generated Protobuf-ES TypeScript for copied Spine Protobuf definitions.

The package root currently exposes a curated first Spine proto intake set:

- Spine custom options from `spine/options.proto`.
- `spine.base.FieldPath`.
- `spine.string.TemplateString`.
- `spine.validation.ValidationError` and
  `spine.validation.ConstraintViolation`.

Generation writes to `packages/proto/src/generated`, and the public package
entry point imports from those generated files to expose documented aliases for
the file descriptors, message schemas, message types, and the `type_url_prefix`
custom option. Generated implementation modules are not broadly re-exported
from the package root. Runtime metadata registries, `Any` packing helpers, and
the validation facade are deferred to later framework tasks.

Run:

```shell
pnpm proto:verify
pnpm proto:lint
pnpm proto:generate
pnpm proto:check-generated
```

The copied source manifest is `proto/spine-sources.json`. Verification is
network-free by default: it checks manifest shape, exact copied-file set, safe
paths, and local SHA-256 checksums against the pinned source metadata.
