# T-0095 Build-once Images Review

Status: Complete; integrated and post-merge verified
Baseline: `1c53cbdf`
Candidate: `3a62e475`

## Requirements And Evidence

- Human-imposed requirements and acceptance criteria:
  `build-protocol/tasks/T-0095-build-once-images/TASK.md`.
- Accepted requirements split:
  `build-protocol/planning/T-0095_BUILD_ONCE_IMAGES_SPLIT.md`.
- Implementation and verification evidence:
  `build-protocol/work-logs/T-0095.md`.
- Fresh build and focused tests pass the full TypeScript project, three
  deployment-entrypoint tests, and three image-builder cleanup tests.
- All three fixed local images rebuild from the offline, digest-pinned package
  set. The seven-case image contract passes artifact inspection, runtime-only
  content checks, shared Message Board artifact identity, authenticated durable
  subscription activation/cancellation, PID 1, both process signals, and the
  ten-second shutdown bound.
- Documentation API/audience checks and release-readiness checks pass with 67
  package imports, 44 package assets, and 275 relative Markdown links.

## Reviewer Assignments

All assignments used existing roles and explicitly recorded model/reasoning
profiles before dispatch. Runtime self-introspection was unavailable; the
immutable configured role/profile is accepted because no visible mismatch or
inherited fallback occurred.

- Style/maintainability: existing `style_maintainability_reviewer`, expected
  `gpt-5.6-terra` / high.
- TypeScript/API documentation: existing `typescript_api_docs_reviewer`,
  expected `gpt-5.6-terra` / high.
- Performance/reliability: existing `performance_reliability_reviewer`,
  expected `gpt-5.6-terra` / high.
- Documentation: existing `documentation_reviewer`, expected
  `gpt-5.6-luna` / medium.

Final security remains the Wave 5 release-readiness gate in T-0097.

## Concern Dispositions

- Style/maintainability: first review accepted two P2 findings: gateway
  configuration duplicated combined parsing, and the image builder duplicated
  the root pnpm version. Both were corrected. Re-review was clean.
- TypeScript/API documentation: first review was clean. Re-review after the
  binding collaborator changed accepted one TSDoc correction so the public
  declaration distinguishes general coordination from production durability.
  The final affected-concern re-review was clean.
- Performance/reliability: first review accepted production-environment
  configuration, ten-second shutdown enforcement, and finite/signal-aware
  builder-cleanup findings. Re-review then found a separately unclosed registry
  storage factory and an inactive client-only subscription probe. Production
  now reuses the environment-owned factory, and the image probe performs an
  authenticated, origin-authorized remote subscribe, activate, and cancel in
  both gateway modes. Final re-review was clean.
- Documentation: first review accepted stale local-start claims and missing
  image guidance. Corrected human documentation separates local and production
  startup and explains fixed tags, inputs, storage ownership, lifecycle, and
  limitations. Final re-review was clean after adding a copy-and-paste
  application-only container example and cleanup commands.

Every P1 and P2 finding is resolved. No P3 advice or unchanged baseline debt is
carried by this task.

## Final Verification

`pnpm --config.verify-deps-before-run=false verify:release` passes at
`3a62e475`: 175 test files and 3,473 tests pass, with 3 files and 25 tests
skipped. Coverage passes at 94.09% statements, 90.04% branches, 94.51%
functions, and 94.96% lines. Generated builds, tooling typecheck, ESLint,
cleanup and TSDoc enforcement, formatting, API documentation, documentation
audience, Proto integrity, release readiness, and full coverage all pass.

The separate real-container gate also passes all seven cases for fixed image
artifacts, runtime-only contents, shared Message Board artifact identity,
durable subscription activation/cancellation, PID 1, both process signals, and
the ten-second shutdown bound.

The conflict-free merge `1bfbd5ae` has the same tree as the verified task
endpoint. Post-merge `verify:task -- --no-tests` passes TypeScript, ESLint,
cleanup/TSDoc, formatting, API documentation, documentation audience, Proto,
generated cleanliness, 67 package imports, 44 assets, and 275 links.
