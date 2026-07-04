# @spine-ts/proto

Generated Protobuf-ES TypeScript for copied Spine Protobuf definitions.

The package root currently exposes a curated Spine proto intake set:

- Spine custom options from `spine/options.proto`.
- `spine.base.FieldPath`.
- `spine.string.TemplateString`.
- `spine.validation.ValidationError` and
  `spine.validation.ConstraintViolation`.
- Core signal envelope and context contracts:
  `spine.core.Command`, `CommandId`, `CommandContext`, `Event`, `EventId`,
  `EventContext`, `ActorContext`, `TenantId`, `UserId`, `Version`,
  `MessageId`, `Origin`, `Enrichment`, `Ack`, `Response`, and their nested
  support messages.
- Client service contracts and support messages from `spine/client`, including
  command/query/subscription service descriptors, `Query`, `QueryResponse`,
  filters, topics, subscriptions, and subscription updates.
- Minimal transitive support contracts from `spine.time`, `spine.net`, and
  `spine.ui` required by the core context messages.

Generation writes to `packages/proto/generated`, and the public package
entry point imports from those generated files to expose documented aliases for
the file descriptors, message schemas, message types, and the `type_url_prefix`
custom option. Generated implementation modules are not broadly re-exported from
the package root. Build output also exposes generated subpaths for callers that
intentionally need a generated module directly, including both extensionless
imports such as `@spine-ts/proto/generated/spine/core/command_pb` and natural
ESM `.js` imports such as
`@spine-ts/proto/generated/spine/core/command_pb.js`.

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
