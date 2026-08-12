# T-0169 Copyright And License Review

Status: Correction complete; re-review ready

## Required Concerns

- Style/maintainability: required for checker design, deterministic Git
  behavior, bounded enumeration, diagnostics, and mechanical migration hygiene.
- Documentation/license: required for exact license/header/package claims and
  third-party notice preservation.
- TypeScript/API documentation: N/A unless a public TypeScript/API contract is
  changed; the checker is repository tooling.
- Performance/reliability: N/A unless implementation adds runtime, persistence,
  concurrency, resource, or lifecycle behavior.
- Security: N/A unless implementation changes trust, authentication, secrets,
  network, or executable runtime boundaries.

## Assignment Evidence

The implementation owner is the existing `implementer` role, explicitly
dispatched as `gpt-5.6-terra` with medium reasoning. Reviewer dispatch and
runtime-profile evidence will be recorded before accepting review results.

- Style/maintainability review: existing `style_maintainability_reviewer`,
  configured `gpt-5.6-terra` / high. Both profile fields are explicit in the
  orchestrator dispatch.
- Documentation/license review: existing `documentation_reviewer`, immutable
  configured `gpt-5.6-luna` / medium. The role fixes this profile; the
  orchestrator dispatch records the role explicitly and records runtime
  metadata when the surface exposes it.
- TypeScript/API documentation: N/A because no public TypeScript export,
  declaration, or TypeDoc contract changed.
- Performance/reliability: N/A because no application runtime, persistence,
  concurrency, resource, or lifecycle behavior changed.
- Security: N/A because no trust, authentication, authorization, secret,
  network, or executable application boundary changed.
  The execution surface does not expose runtime model metadata; this record uses
  the immutable dispatched role/profile as the available evidence.

## Implementation Evidence

- 2026-08-12: TDD RED recorded with `pnpm exec vitest run
scripts/check-copyright.test.mjs`: the test suite failed at import because
  `scripts/check-copyright.mjs` did not exist. The failure established the
  intended checker module boundary before production code was written.
- 2026-08-12: TDD GREEN recorded with the same command: 4 tests passed. The
  unwired checker covers exact authored-header placement, stale years,
  shebang/Proto placement, and canonical upstream exclusion.
- 2026-08-12: The canonical Proto generator removed the header from the tracked
  eligible `examples/message-board/app/src/model-registry.ts`; this made the
  required `proto:generate` then copyright-gate sequence fail. The orchestrator
  authorized a narrow ownership expansion for `scripts/proto-workflow.mjs` and
  its focused test only. A RED test observed no `withCopyrightHeader` helper;
  GREEN was `pnpm exec vitest run scripts/proto-workflow.test.mjs` (57 passed),
  followed by `pnpm proto:generate` and `pnpm lint:copyright` (both passed).
- 2026-08-12: Before the checker correction, future-year and rename adversarial
  tests produced three expected failures. The converged checker now uses
  injected Git/base seams, normalized-content comparison, and fail-closed
  enumeration/base lookup behavior. Focused fixture and live-inventory evidence
  is recorded in the work log; specialist review remains pending.
- 2026-08-12: AC9 fixture audit added explicit Git parsing and failure-path
  coverage. One duplicate rename across Git comparison scopes was a genuine
  false ambiguity; it was corrected test-first. Specialist review remains
  pending.

## Findings

The documentation/license reviewer found the license/header claims otherwise
clean. The style/maintainability reviewer accepted the correction batch after
requiring exact-template recognition, current-year generated output, and
NUL-safe Git path handling. Both reviewer profiles were explicitly dispatched
under the project review matrix; runtime profile metadata was unavailable.
Residual style feedback found one mixed NUL name-status parser defect; the
test-first correction is complete and awaits orchestrated re-review.
