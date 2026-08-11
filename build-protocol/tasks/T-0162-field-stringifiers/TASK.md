# T-0162: Field stringifiers

Status: Complete; integrated and post-merge verified

## Objective

Add JVM-compatible, reversible string conversion for supported singular Protobuf
fields, and let configured message stringifiers participate in the same mapping.

## Classification

High-risk. This adds a public conversion contract that later query filters and
`@Where` declarations will use for persistent values.

## Baseline and isolation

- Baseline: `origin/main@bed8f408`.
- Branch: `task/T-0162-field-stringifiers`.
- Worktree: `.worktrees/T-0162-field-stringifiers`.
- Preserve unrelated worktrees and the dirty primary checkout; push only `origin`.

## Acceptance criteria

1. Export `Stringifiers.forField(field, types?)` and
   `StringifierRegistry.forField(field)` with the frozen `Stringifier<unknown>`
   result contract.
2. Round-trip every supported singular scalar kind, bytes, enum, and message
   field through one canonical representation.
3. Reuse custom message mappings from `StringifierRegistry` in both storage and
   query directions.
4. Reject non-canonical, out-of-range, non-finite, malformed, repeated, and map
   values explicitly.
5. Preserve compact Proto JSON and configured `Any` expansion for message fields.
6. Cover default and custom mappings, canonical round trips, and invalid field
   shapes with focused RED/GREEN tests.

## Assignment

- Frozen plan: existing requirements splitter, explicit `gpt-5.6-sol` / high.
- Implementation: primary orchestrator acting as the bounded implementation
  owner under the existing implementer function, `gpt-5.6-terra` / medium; no
  subagents are dispatched for implementation.
- Runtime model metadata is not exposed by this surface; the configured profiles
  above are the durable assignment evidence.

## Review and verification

Style, TypeScript/API, documentation/TSDoc, and performance/reliability review
concerns are required after deterministic convergence. Security is N/A for this
pure conversion API; the Wave final security review remains required.
