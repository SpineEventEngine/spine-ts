# Proto Intake

This directory contains the verbatim Spine `.proto` intake sets used by the
framework's client and delivery contracts.

## Frozen Source Closure

The manifest pins 39 verbatim source files. They comprise the curated root
contracts and transitive support below, seven `spine.client` service/query/
subscription contracts, five Core JVM server/catch-up/delivery contracts, six
simple delivery-server contracts plus gRPC health, and the option/time sources
needed to compile them. The complete authoritative inventory is
[`spine-sources.json`](spine-sources.json); do not treat the shorter list below
as exhaustive.

The original curated package-root subset includes:

- `spine/options.proto`
- `spine/base/field_path.proto`
- `spine/string/template_string.proto`
- `spine/validation/validation_error.proto`
- `spine/core/command.proto`
- `spine/core/event.proto`
- `spine/core/actor_context.proto`
- `spine/core/tenant_id.proto`
- `spine/core/user_id.proto`
- `spine/core/version.proto`
- `spine/core/diagnostics.proto`
- `spine/core/enrichment.proto`
- `spine/time/time.proto`
- `spine/net/email_address.proto`
- `spine/net/internet_domain.proto`
- `spine/ui/language.proto`

`proto/spine-sources.json` records the upstream repository, full commit, source
URL, raw URL, upstream path, local path, and SHA-256 checksum for each copied
file. Buf resolves standard imported descriptors while compiling these 39
sources, producing the 48-file frozen descriptor set checked by the workflow.

## Verification And Generation

Run:

```shell
pnpm proto:verify
pnpm proto:lint
pnpm proto:generate
pnpm proto:check-generated
```

`proto:verify`, `proto:lint`, and `proto:generate` use network-free local drift
protection. They validate the manifest, require exact set equality with every
copied `proto/**/*.proto` file (including the frozen gRPC health contract),
reject unsafe paths, and verify local SHA-256 checksums before Buf runs. The
manifest's pinned source URLs are provenance for review and future refreshes;
default verification does not fetch upstream.

Before lint or generation, the workflow also builds a complete
`google.protobuf.FileDescriptorSet` from the verified frozen sources and
compares its normalized SHA-256 with `frozen-descriptor-set.sha256`. The
normalizer removes only `source_code_info` and orders files by name. It retains
all other descriptor data, including custom-option unknown fields, so a change
to a type-URL option or any other compatibility-relevant descriptor element
fails the workflow.

Buf lint uses narrow compatibility exceptions because Spine upstream
`options.proto` is intentionally package-less and the copied files preserve
legacy enum and field names, including lowercase ISO language enum values in
`spine/ui/language.proto`.

`proto:generate` removes and regenerates `packages/proto/generated` before Buf
runs. It refuses a symlinked generated directory so cleanup cannot follow a
link outside the package tree. `proto:check-generated` fails when generated
output is tracked by Git, not ignored, missing, symlinked, stale, or contains
orphaned files compared with a clean temporary generation. `pnpm verify` runs
`proto:generate` before typecheck/build/doc consumers and checks generated
cleanliness again near the end.
