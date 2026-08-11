# T-0158 Review Record

Status: Correction in progress

## Assignments

- Implementation: existing implementer, explicit `gpt-5.6-terra` / medium,
  no subagents.
- Style/maintainability: required, configured `gpt-5.6-terra` / high.
- TypeScript/API documentation: required, configured `gpt-5.6-terra` / high.
- Documentation/TSDoc: required, configured documentation reviewer
  `gpt-5.6-luna` / medium.
- Performance/reliability: required, configured `gpt-5.6-terra` / high.
- Security: N/A because routing does not change a trust boundary.

Runtime metadata is unavailable unless the execution surface exposes it; the
explicit immutable configured role/profile is then the durable evidence.

## Mechanical Evidence

- Generated build passes.
- Focused behavior and API profile passes 5 files / 232 tests.
- Exact changed-range LCOV: statements/lines 108/113 (95.58%), branches
  100/110 (90.91%), functions 26/26 (100%).
- Changed-file ESLint, tooling typecheck, TSDoc, TypeDoc/API inventory,
  generated fixture check, Prettier, and `git diff --check` are required clean
  before reviewer dispatch.

## Review Wave

- Style/maintainability: requested correction. Repository-derived numeric
  producer IDs used the generic `DoubleValue` codec, and replay-count tests
  bypassed real admission.
- TypeScript/API documentation: requested correction. Semantic Java type names
  admitted non-canonical whitespace, the public constructor expanded the
  frozen factory API, and `CommandRoute` did not describe default context.
- Documentation/TSDoc: requested correction. A historical work-log statement
  described persisted targets as trusted without naming schema decoding and ID
  validation.
- Performance/reliability: requested correction for the typed producer-ID
  mismatch and for evidence at the real admission boundary. Its broader request
  for one route invocation across independent duplicate/retry admissions is not
  accepted: that is not the frozen contract and cannot survive restart without
  a prohibited durable route receipt or marker.
- Security: N/A; routing changes no authentication, authorization, secret, or
  external trust boundary.

## Correction Disposition

- Repository event contexts, lifecycle events, rejection events, and handler
  diagnostic receiver IDs now use one descriptor-aware `EntityIds` packer.
  JVM-compatible `Int32Value` producer IDs are readable.
- Actual `commandBus` admission followed by direct stored-target replay covers
  both Aggregate and Process Manager routes. Each accepted admission invokes
  the application route once; replay invokes it zero times.
- `CommandRouting` construction, semantic-key validation, route callback TSDoc,
  and historical route-selection wording are corrected.
- Targeted re-review is required for style/maintainability, TypeScript/API docs,
  documentation/TSDoc, and performance/reliability. Security remains N/A.
