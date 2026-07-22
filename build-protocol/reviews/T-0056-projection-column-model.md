# T-0056 Projection Column Model Review

Status: All required concerns closed; full branch verification passed

Baseline: `55b460b6`

## Required Concerns

- TypeScript/API: unforgeable descriptor-backed generic columns, correct
  schema/name/value/operator relationships, negative declaration fixtures,
  package boundaries, and absence of Aggregate/Process Manager factories.
- Documentation: current, compilable Projection snippets; declared/system
  columns; value/operator table; and explicit Wave 2 limitations.
- Style/maintainability: minimal public surface, one canonical metadata/policy
  seam, stable errors, and clear separation from the T-0057 DSL/execution work.
- Performance/reliability: schema-identity caching, immutable/stable metadata,
  registration-time failure, and no repeated/unbounded descriptor work.
- Security: N/A for this packet because it adds no external input channel,
  network protocol, authentication boundary, persistence operation, or query
  executor. Final Wave 1 security review remains T-0067.

## Specialist Assignment Gate

- Existing `typescript_api_docs_reviewer`: explicitly
  `gpt-5.6-terra` / `high`.
- Existing `documentation_reviewer`: immutable configured
  `gpt-5.6-luna` / `medium`; record the surface limitation if redundant
  explicit overrides are unavailable.
- Existing `style_maintainability_reviewer`: explicitly
  `gpt-5.6-terra` / `high`.
- Existing `performance_reliability_reviewer`: explicitly
  `gpt-5.6-terra` / `high`.
- Reviewers are read-only, may not spawn children, and return P0-P3 findings or
  `CLEAN`. Actual runtime metadata is recorded if exposed; otherwise the
  immutable configured role/profile and limitation are recorded honestly.

## Human Requirements Reference

Review against the complete ledger in
`build-protocol/tasks/T-0056-projection-column-model/TASK.md`, the T-0056 packet
in `build-protocol/planning/WAVE_1_JVM_PARITY_PLAN.md`, and the corrected
single-policy/provider boundary recorded by the T-0052 review.

## Review Wave Metadata

- TypeScript/API: existing `typescript_api_docs_reviewer`, explicitly
  `gpt-5.6-terra` / `high`; runtime self-introspection unavailable.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicitly `gpt-5.6-terra` / `high`; runtime self-introspection unavailable.
- Documentation: existing immutable `documentation_reviewer`, configured
  `gpt-5.6-luna` / `medium`; redundant override and runtime
  self-introspection unavailable.
- Style/maintainability: the Desktop surface rejected a new child after
  reaching its cumulative thread limit. The repository-configured CLI fallback
  explicitly ran the existing `style_maintainability_reviewer` with immutable
  `gpt-5.6-terra` / `high`; runtime child self-introspection remained
  unavailable. Its Sol/medium parent was instructed only to dispatch and relay
  that one existing role, and did not perform the review.

## Review Wave Dispositions

- TypeScript/API: two P1 and one P2 accepted. Emitted JavaScript can currently
  invoke the TypeScript-private `ProjectionColumn` constructor; unsupported
  repeated/map/oneof descriptors lack the required compile-negative contract;
  and generated definition entries are shallowly mutable.
- Performance/reliability: two P1 and two P2 accepted. Predicate validation is
  recursively unbounded and accepts cycles; malformed runtime shapes are not
  fully normalized; generated entries are mutable; and custom-option parsing
  accepts truncated/trailing wire payloads.
- Documentation: one P2 accepted. The guide's real TaskList snippet does not
  state its source-file location, so its relative imports do not resolve from
  the Markdown file itself.
- Style/maintainability: four P2 accepted. The generator duplicates extension
  metadata through magic numbers/partial wire parsing; generator/runtime field
  classification can drift; entry immutability is shallow; and the public
  one-implementation `StorageQueryPolicyApi` interface adds no useful seam.
- Security: remains N/A for the concrete no-new-trust-boundary reason already
  recorded; T-0067 retains final Wave 1 security ownership.

## Accepted Correction Batch

1. Add a module-private runtime construction guard and built-JavaScript
   forgery regression. Copy/freeze every generated definition entry as well as
   its container and prove mutation resistance before/after registration.
2. Constrain generated definition entries to supported singular, non-oneof
   descriptors and add compile-negative unsupported-kind fixtures while
   preserving registration-time stable errors for malformed runtime input.
3. Replace recursive predicate validation with bounded iterative traversal,
   cycle detection, stable depth/node overflow errors, and complete runtime
   shape validation for discriminants, arrays, entries, directions, masks,
   limits, and capabilities before provider admission.
4. Replace magic-number/partial custom-option decoding with descriptor-driven
   Protobuf option access from the plugin request. Keep one shared
   descriptor-to-comparison classification source for generator and runtime,
   and cover real-descriptor parity plus malformed option data.
5. Remove the redundant public `StorageQueryPolicyApi` interface/expectation;
   retain the frozen policy value and canonical normalized plan types.
6. Make the guide snippet's real application-source location and import base
   explicit so the shown paths are mechanically truthful.

The complete deduplicated batch returns once to the existing implementer
context. Re-review is limited to the four substantively affected concerns.

## Final Re-Review Dispositions

- TypeScript/API: `CLEAN` after the construction guard, compile-negative field
  constraints, and defensive definition capture. Existing
  `typescript_api_docs_reviewer`, configured `gpt-5.6-terra` / `high`; runtime
  self-introspection unavailable.
- Documentation: the follow-up P2 corrected the false complete-file claim by
  distinguishing the real application declaration from illustrative property
  accesses. Final result `CLEAN`. Existing immutable
  `documentation_reviewer`, configured `gpt-5.6-luna` / `medium`; runtime
  self-introspection unavailable. The Desktop thread limit required the
  repository-aware read-only CLI fallback, whose parent only dispatched and
  relayed the configured role.
- Style/maintainability: the descriptor-driven option parser, shared field
  classifier, deep definition capture, removed redundant interface, and
  descriptor-derived Projection enum number are `CLEAN`. Existing
  `style_maintainability_reviewer`, configured `gpt-5.6-terra` / `high`;
  runtime self-introspection unavailable. The same read-only CLI fallback was
  used after the Desktop cumulative thread limit.
- Performance/reliability: follow-up review first found sparse-array admission,
  pre-budget wide-child allocation, and shallow descriptor mutability. Final
  re-review is `CLEAN` after structural-first indexed validation, pre-enqueue
  node budgeting, cycle-safe reachable descriptor freezing, and immutable
  registration facts with nested-mutation regressions. Existing
  `performance_reliability_reviewer`, configured `gpt-5.6-terra` / `high`;
  runtime self-introspection unavailable.
- Security: `N/A` remains accepted because T-0056 adds no executor, persistence
  operation, network input, authentication boundary, or external trust
  channel. T-0067 retains the final Wave 1 security review.

All accepted findings are resolved. No canonical concern remains open.
