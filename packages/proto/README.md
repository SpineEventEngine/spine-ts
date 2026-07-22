# @spine-ts/proto

Generated Protobuf-ES TypeScript for copied Spine Protobuf definitions.

The package root exposes a curated core Spine proto intake set:

- Spine custom options from `spine/options.proto`.
- `spine.base.FieldPath`.
- `spine.string.TemplateString`.
- `spine.validation.ValidationError` and
  `spine.validation.ConstraintViolation`.
- Core signal envelope and context contracts:
  `spine.core.Command`, `CommandId`, `CommandContext`, `Event`, `EventId`,
  `EventContext`, `ActorContext`, `TenantId`, `UserId`, `Version`,
  `MessageId`, `Origin`, `Enrichment`, and their nested support messages.
- Minimal transitive support contracts from `spine.time`, `spine.net`, and
  `spine.ui` required by the core context messages.

The only supported public imports are `@spine-ts/proto`,
`@spine-ts/proto/client`, `@spine-ts/proto/delivery`, and
`@spine-ts/proto/delivery-server`. Arbitrary generated paths and generated
runtime helper APIs are deliberately private. The latter prevents a wire intake
task from claiming the unavailable delivery runtime behavior.

The copied source manifest and `proto/frozen-descriptor-set.sha256` together
pin the complete FileDescriptorSet compiled by Buf from the frozen source
closure. The comparison normalizes file ordering and removes only
`source_code_info`; it preserves file/package/import identities, fields,
oneofs, map entries, extension ranges and declarations, services/RPC streaming,
syntax/edition, and all known or unknown option bytes (including Spine
type-URL options). A mismatch fails generation before Protobuf-ES output is
published.

Generation writes to `packages/proto/generated`, which is reproducible and
untracked. The source manifest pins repository, commit, source path, canonical
URLs, and SHA-256 for every copied file. The frozen client/delivery closure is
from `core-java` and `delivery-server`; its `spine/time_options.proto`
dependency is pinned to `SpineEventEngine/time` commit
`57d3dd98fea8efcdc4a3843f91143acc2dce87dc` (the source associated with Core
JVM's `2.0.0-SNAPSHOT.244` dependency).

Run:

```shell
pnpm proto:verify
node packages/proto/scripts/verify-descriptor-compatibility.mjs
pnpm proto:lint
pnpm proto:generate
pnpm proto:check-generated
```

The copied source manifest is `proto/spine-sources.json`. Verification is
network-free by default: it checks manifest shape, exact copied-file set, safe
paths, and local SHA-256 checksums against the pinned source metadata.
