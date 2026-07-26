# @spine-event-engine/proto

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

The public package-root imports are `@spine-event-engine/proto`,
`@spine-event-engine/proto/client`, `@spine-event-engine/proto/delivery`, and
`@spine-event-engine/proto/delivery-server`. Model tooling also consumes the
published `./spine-proto-manifest.json`, canonical `./proto/*` source files,
and compiled `./generated/*.js` schema subpaths. The generated paths are for
schema imports such as:

```ts
import { CommandIdSchema, spineProtoModule } from "@spine-event-engine/proto";
import { EntityOptionSchema } from "@spine-event-engine/proto/generated/spine/options_pb.js";

void CommandIdSchema;
void EntityOptionSchema;
void spineProtoModule;
```

The generated runtime helper internals remain private; only the documented
package exports are supported. In particular, this package supplies wire
contracts, not an implicit delivery runtime.

## Using Spine Proto as a model dependency

Every application-owned model lists `@spine-event-engine/proto` in its
`spine-proto.json` `dependencies` and in `package.json` dependencies. The
model generator reads this package's manifest and canonical source exports to
resolve imports such as `spine/options.proto`, then writes ordinary package
imports into the generated TypeScript. A model module includes
`spineProtoModule` as a dependency, so its application registry receives the
Spine schema graph transitively.

```json
{
  "formatVersion": 1,
  "mode": "model",
  "packageName": "@acme/tasks-model",
  "protoRoot": "proto",
  "generatedRoot": "generated",
  "exportRoot": "generated",
  "dependencies": ["@spine-event-engine/proto"],
  "moduleExport": "tasksProtoModule"
}
```

The manifest is deterministic and records the package name/version, canonical
Proto files, compiled generated exports, direct dependencies, and module-export
name. It is generated rather than edited. Bad manifests, missing exported
sources, unsafe paths, and incompatible package/config identities fail before
new model output replaces the previous generation.

Spine TS packages have not been published to npm yet. The repository's local
tarball acceptance test simulates a clean registry consumer; publication is
revisited after all planned waves.

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
