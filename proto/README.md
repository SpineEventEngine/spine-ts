# Proto Intake

This directory contains verbatim Spine `.proto` intake sets.

## Copied Spine Files

The current minimal compileable closure includes:

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
file. The files are copied from the exact commits recorded in
`build-protocol/DECISION_LOG.md#d-0025-t-0004-proto-intake-uses-exact-researched-spine-source-commits`
and the later task-specific decisions that extend the manifest.

## Verification And Generation

Run:

```shell
pnpm proto:verify
pnpm proto:lint
pnpm proto:generate
pnpm proto:check-generated
```

`proto:verify`, `proto:lint`, and `proto:generate` use network-free local drift
protection. They validate the manifest, require exact set equality with copied
`proto/spine/**/*.proto` files, reject unsafe paths, and verify local SHA-256
checksums before Buf runs. The manifest's pinned source URLs are provenance for
review and future refreshes; default verification does not fetch upstream.

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
