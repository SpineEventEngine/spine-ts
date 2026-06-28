# @spine-ts/proto

Generated Protobuf-ES TypeScript for copied Spine Protobuf definitions.

The package currently exports the first Spine proto intake set:

- Spine custom options from `spine/options.proto`.
- `spine.base.FieldPath`.
- `spine.string.TemplateString`.
- `spine.validation.ValidationError` and
  `spine.validation.ConstraintViolation`.

Generation writes to `packages/proto/src/generated` and the public package entry
point re-exports those generated schemas. Runtime metadata registries, `Any`
packing helpers, and the validation facade are deferred to later framework
tasks.

Run:

```shell
pnpm proto:verify
pnpm proto:lint
pnpm proto:generate
```

The copied source manifest is `proto/spine-sources.json`.
