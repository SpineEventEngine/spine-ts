# @spine-event-engine/proto reference

This reference is for agents using Spine TS Protobuf contracts.

## Public exports

The root `@spine-event-engine/proto` export provides the curated Spine schemas,
message types, enums, file descriptors, `spineProtoModule`, and option
extensions. It includes command/event envelopes and contexts, actor/tenant/user
identities, validation messages, time/network/UI support types, and options
such as `type_url_prefix`, `entity`, `column`, and `set_once`.

The package also exports `@spine-event-engine/proto/client`,
`@spine-event-engine/proto/auth`, `@spine-event-engine/proto/delivery`, and
`@spine-event-engine/proto/delivery-server` for the corresponding generated
service contracts. `@spine-event-engine/proto/generated/*.js` is supported for
generated schema subpaths. `./proto/*`, `spine-proto-manifest.json`, and the
model metadata files are package assets used by model generation.

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
