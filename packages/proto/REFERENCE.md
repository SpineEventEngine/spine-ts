# @spine-event-engine/proto reference

This reference is for agents using Spine TS Protobuf contracts.

## `ts_type` boundary

The TypeScript generator reads `ts_type`; Java-only option fields are ignored.
`every_is.generate` produces an interface/token in `generated/interfaces/`.
`is.ts_type` requires an authored interface in the message model's module. After
realpath resolution, only the requested authored interface must be a top-level
named export. Its recursive `extends` parents must resolve to interfaces in the
same model module, but need not be top-level named exports; external property
types are allowed. Missing, misplaced, unnamed, or incompatible interfaces fail
compilation. These options do not create semantic tags or topics.

## Public exports

The root `@spine-event-engine/proto` export provides the curated Spine schemas,
message types, enums, file descriptors, `spineProtoModule`, and option
extensions. It includes command/event envelopes and contexts, actor/tenant/user
identities, validation messages, time/network/UI support types, and options
such as `type_url_prefix`, `entity`, `column`, and `set_once`.

The package also exports `@spine-event-engine/proto/client`,
`@spine-event-engine/proto/auth`, `@spine-event-engine/proto/deployment`,
`@spine-event-engine/proto/delivery`, and
`@spine-event-engine/proto/delivery-server` for the corresponding generated
contracts. The client facet includes `SubscriptionRecord`; the auth facet
includes `GatewayAuthenticatedSubscription`; and the deployment facet includes
the application-node discovery records. `@spine-event-engine/proto/generated/*.js`
is supported for low-level generated schema subpaths. `./proto/*`,
`spine-proto-manifest.json`, and the model metadata files are package assets
used by model generation.

Generated wildcard paths also contain internal `spine/system/server` schemas
used by the server runtime. They are intentionally absent from the root and
named public subpaths: application code must not depend on them as a stable
API.

Proto sources maintained by Spine TS must not use the Proto `optional` keyword. Their
documented declarations are separated by blank lines, and a multi-paragraph
`//` comment ends with a blank `//` line before its declaration. Frozen copied
JVM sources retain their upstream formatting and syntax.

## Model modules

An application model uses `spine-proto.json` with `mode: "model"`, its package
name, source/generated/export roots, direct model dependencies, and a module
export name. It must list `@spine-event-engine/proto` as both a runtime package
dependency and a model dependency when it imports Spine definitions. The
generator validates package identity and paths before replacing output.

`spineProtoModule` is a `ProtoModule`: it identifies the package, lists its
schemas, and declares dependencies. Application registries compose model
modules through this contract.

## Boundaries

This package supplies wire schemas and descriptors. It does not validate,
dispatch, persist, deliver, authenticate, or start a server. Use generated
types with `@bufbuild/protobuf` and use the appropriate Spine TS runtime
package for those responsibilities.

## Integration broker contracts

The root exports generated ExternalMessage, ExternalEventsWanted, ExternalEventType, BoundedContextOnline, ChannelId, and BoundedContextName schemas and types. They are exact copied JVM wire contracts for the integration broker and typed message transport; they do not add JSON or V8 frames.
