# T-0177 Copyright Spacing Review

Status: Implementation converged; specialist review pending

The task Human-Imposed Requirements Ledger is binding. Review the actual Git
inventory and generated outputs, not a remembered convention.

## Required concerns

- Style/maintainability: exact single-empty-line contract, deterministic
  diagnostics, generator symmetry, shebangs, exclusions, and maintainable shared
  policy.
- Mechanical inventory: every eligible tracked TS/TSX file and every producer
  is covered before and after canonical generation.
- Runtime/API/reliability/security: N/A unless the diff contains a non-whitespace
  production change or changes a public/tooling contract beyond spacing.

One complete finding batch returns to the existing implementation owner.

## Implementation handoff (2026-08-12)

- Scope: shared copyright checker/normalizer, their focused tests, producer
  coverage, and a 502-file eligible TS/TSX spacing migration.
- Mechanical evidence before review: focused tests 81/81 pass;
  `pnpm lint:copyright` passes; canonical Proto generation and the fixture
  generator were run before the final inventory (0 zero, 502 one, 0 multiple;
  3/3 shebang files compliant). Cheap preflight then passed all task gates;
  `verify:release` remains intentionally unrun pending review.
- Review still required: style/maintainability only. Reliability, public API,
  documentation, and security remain N/A for the stated reasons unless a
  review finding expands scope.

## Review correction batch (2026-08-12)

- P1-1 accepted and corrected: header-spacing-only TS/TSX corrections are
  ignored by future-year content comparison, including zero, multiple, and
  whitespace-only blank-line forms.
- P1-2 accepted and corrected: `separateCopyrightHeader()` is the single
  boundary rule for normalizing, validating, and future-year comparison.
  Proto remains outside that spacing policy.
- TDD evidence: RED 3 failures / 19 passes; GREEN 82/82 focused tests. Canonical
  generation and exact inventory then report 502 eligible, 0 zero, 502 one,
  0 multiple, 0 whitespace-only; all 3 shebang files comply.
- Targeted re-review: style/maintainability of the two P1 corrections only.
