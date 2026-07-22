# @spine-ts/client

Descriptor-backed client foundations for Spine Projection queries.

Generated Projection metadata is registered with
`ProjectionColumn.register(schema, generatedDefinition)`. Registration checks
the Projection entity kind, exact `(column)` fields, descriptor identity,
singular/non-oneof shape, and descriptor-derived comparison family. The result
is immutable and cached by schema identity.

The generated collection includes declared columns plus `version`, `archived`,
and `deleted`. Strings, numeric scalars, `google.protobuf.Timestamp`, and
`spine.core.Version` support ordering operators. Boolean, bytes, enum, and
other message fields support equality only.

Application code cannot construct arbitrary columns or author generated
definitions through the package root. Aggregate and Process Manager column
factories, query expressions, transport, and execution are outside this
package slice.

Generated sources obtain their definition constructor from the dedicated
`@spine-ts/client/codegen` subpath. Application code should import only the
resulting generated definition and the root Projection API.

The package also installs `protoc-gen-spine-projection-columns` for Buf-based
generation. Run it after Protobuf-ES with the same output directory so the
`*_columns.ts` companions sit beside their generated message schemas.
