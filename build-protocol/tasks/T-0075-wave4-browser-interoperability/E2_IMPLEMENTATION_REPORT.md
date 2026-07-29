# T-0075 E2 implementation report

## Behavior

`interop/jvm/wire/verify.mjs` invokes the existing checksum-verified archive
extraction callback and resolves imports recursively across every frozen
`*/src/main/proto` root. It byte-compares every physically present reachable
Spine Proto against `packages/proto/proto`, treats only Google protobuf imports
as external WKT, records an unavailable annotation-only `spine/options.proto`
checksum, and fails closed for absent wire-bearing Spine contracts.

## Evidence

The locked source tree digest remains
`b677332aa8bf39da79d4205671d6f82d228d3c1c78dd1195ba8ec839038e104a`.
The first exact comparison (`spine/client/command_service.proto`) is equal at
2,721 bytes. The verifier compares 16 reachable physical files exactly, then
reports 1 annotation-only unavailable import and 8 Google WKTs. The focused
Node suite passes 2/2 and proves the caller staging directory is absent after
the verifier fails; `git diff --check` passes.

The frozen dependency POM is verified in the same extraction callback at
SHA-256 `23b875e2a0b80f14e4fa908f6ced51e05ac84211fd73281c949a3acffae85857`.
It pins `io.spine:spine-base:2.0.0-SNAPSHOT.426`,
`io.spine:spine-base-types:2.0.0-SNAPSHOT.224`, and
`io.spine:spine-time:2.0.0-SNAPSHOT.244`. A pure injected-byte regression
changes the POM without touching the cache and fails with named `provenance
incompatibility`; category mutation fails with named `category incompatibility`.
The frozen categories are 16 compared sources, 6 unresolved wire-bearing
imports, 1 annotation-only import, and 8 Google WKTs.

Focused final evidence: Node wire tests 4/4; fixture Vitest 11/11; Proto source
checksum verification 40/40; descriptor compatibility Vitest 2/2; and Prettier
plus `git diff --check` pass. The normalized complete descriptor-set digest is
`1503fe36dc426221440a9121b4d29376758ef8e48a170fa813fb0eddbae8c1be`.

## Limitations

Result label: **partial static source/descriptor compatibility; complete transitive and runtime JVM compatibility deferred.** The exact frozen core-jvm archive lacks six reachable wire-bearing
Spine imports: `spine/base/error.proto`, `spine/base/field_path.proto`,
`spine/net/email_address.proto`, `spine/net/internet_domain.proto`,
`spine/time/time.proto`, and `spine/ui/language.proto`. Their snapshot
dependency coordinates do not map to immutable source revisions in the
checked-in metadata, so this is a bounded provenance limitation rather than a
task blocker. No complete transitive or runtime JVM compatibility claim is
made. No Java, JDK, Gradle, dependency resolution, code generation, build,
test, launch, download, or any Spine JVM command was invoked. Independently,
deterministic populated generated-TypeScript fixtures cover Post/Ack,
Read/QueryResponse, Subscribe/Subscription,
Activate/EntityUpdates/EventUpdates, Cancel's method pair, ActorContext, and
Buf unknown-field preservation. Their normalized descriptor digest above and
wire fixtures are claimed as TS consistency evidence only; they do not resolve
the frozen-source provenance limitation.
