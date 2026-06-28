# Proto Intake

This directory contains the first verbatim Spine `.proto` intake set.

## Copied Spine Files

The current minimal compileable closure is:

- `spine/options.proto`
- `spine/base/field_path.proto`
- `spine/string/template_string.proto`
- `spine/validation/validation_error.proto`

`proto/spine-sources.json` records the upstream repository, commit, path, and
SHA-256 checksum for each copied file. The files are copied from the exact
commits recorded in `build-protocol/DECISION_LOG.md#d-0025-t-0004-proto-intake-uses-exact-researched-spine-source-commits`.

## Verification And Generation

Run:

```shell
pnpm proto:verify
pnpm proto:lint
pnpm proto:generate
```

`proto:lint` and `proto:generate` verify the source manifest before running Buf.
Buf lint uses narrow compatibility exceptions because Spine upstream
`options.proto` is intentionally package-less and the copied files preserve
legacy enum and field names.
