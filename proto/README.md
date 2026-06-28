# Proto Intake

This directory contains the first verbatim Spine `.proto` intake set.

## Copied Spine Files

The current minimal compileable closure is:

- `spine/options.proto`
- `spine/base/field_path.proto`
- `spine/string/template_string.proto`
- `spine/validation/validation_error.proto`

`proto/spine-sources.json` records the upstream repository, full commit, source
URL, raw URL, upstream path, local path, and SHA-256 checksum for each copied
file. The files are copied from the exact commits recorded in
`build-protocol/DECISION_LOG.md#d-0025-t-0004-proto-intake-uses-exact-researched-spine-source-commits`.

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
legacy enum and field names.

`proto:check-generated` fails when tracked or untracked generated output under
`packages/proto/src/generated` is dirty after generation. `pnpm verify` runs it
after `proto:generate`.
