# T-0177: Copyright Header Spacing Correction

Status: Complete, integrated, and post-merge verified

## Objective

Correct every eligible authored TypeScript and TSX file so the approved
CodeMatters copyright header is followed by exactly one empty line, and make
the permanent checker and generators enforce that invariant.

## Classification

Standard shared-tooling correction with a repository-wide mechanical migration.
The legal text and year policy do not change. Runtime and public APIs do not
change.

## Human-Imposed Requirements Ledger

- This correction exists because the previous implementation encoded and
  described the spacing rule incorrectly. Do not infer the result from memory.
- Every eligible authored `.ts` and `.tsx` file has exactly one empty line
  between the closing `*/` of the approved header and the next import,
  declaration, ordinary comment, or TSDoc block.
- Shebang-bearing TypeScript files keep the shebang first, then the exact
  approved header, then exactly one empty line.
- Zero empty lines and two-or-more empty lines both fail deterministically with
  a spacing-specific diagnostic.
- The approved legal text and current-year/content-change policy remain exact.
  Third-party/frozen exclusions retain their upstream headers.
- Proto spacing is not changed by this TS/TSX correction.
- All eligible current files, checked-in generated TypeScript, and every
  generator/fixture capable of producing an eligible TypeScript file converge
  on the same spacing.
- Use TDD: observe a spacing test fail against current behavior before changing
  the checker or generator.
- Use independent sub-agents for inventory/generator analysis and final review.
- Preserve README/documentation look and feel; product documentation is out of
  scope except this governing record.
- Push every checkpoint to `origin`; integrate only after focused gates,
  relevant specialist review, and the selected release profile pass.

## Assignment And Review Profiles

- Read-only inventory and generator audits: orchestrator-dispatched explorer,
  explicit `gpt-5.6-terra` / medium.
- Implementation: existing `implementer`, explicit `gpt-5.6-terra` / medium,
  sole writer for checker, generator, migration, tests, and records.
- Style/maintainability review: existing `style_maintainability_reviewer`,
  explicit `gpt-5.6-terra` / high.
- Performance/reliability: N/A unless runtime code changes; whitespace-only
  source migration and tooling must not change behavior.
- TypeScript/API documentation and documentation: N/A except deterministic
  verification of the governing rule; no public API or reader docs change.
- Security: N/A because no trust boundary, secret handling, dependency, or
  runtime behavior changes.

Runtime metadata is recorded when exposed; otherwise explicit immutable
configured roles/profiles are the accepted evidence unless a mismatch or
fallback is visible.

## Verification

- Focused checker/helper/generator tests with observed RED/GREEN evidence.
- Exact Git-tracked eligible TS/TSX inventory: zero missing, zero extra, zero or
  multiple blank-line violations, correct shebang placement, exclusions clean.
- Canonical Proto generation followed by a second inventory scan.
- Tooling typecheck, changed-file ESLint, cleanup, TSDoc, copyright, formatting,
  generated-clean, and diff hygiene.
- Because shared release tooling and hundreds of tracked source files change,
  run one converged `pnpm verify:release` after review corrections.

## Implementation Evidence (2026-08-12)

- TDD RED: the focused suite failed 3/81 tests before implementation because
  the normalizer left zero spacing, the checker accepted zero/multiple spacing,
  and the MessageBoard producer emitted no empty line.
- TDD GREEN: the same focused suite passed 81/81 after the minimal shared
  normalizer/checker change.
- After canonical Proto generation and the server-fixture generator, the exact
  tracked inventory reports 502 eligible TS/TSX files: 0 zero-spacing, 502
  one-spacing, 0 multiple-spacing, 0 missing headers; all 3 shebang files have
  exactly one empty line. `pnpm lint:copyright` passes.
- Cheap preflight passed: build/tooling typechecks, ESLint, cleanup, TSDoc,
  formatting, documentation audience/API, generated Proto lint/cleanliness,
  logging containment, release-readiness, diff hygiene, and the 81 focused
  tests. The selected release profile remains intentionally unrun.

## Review Correction Evidence (2026-08-12)

- Accepted P1-1: future-year comparison now canonicalizes post-header TS/TSX
  spacing before deciding whether content changed, so a zero/multiple/
  whitespace-only correction to exact-one does not require a year bump.
- Accepted P1-2: checker validation and normalization share
  `separateCopyrightHeader()` as their boundary rule. Whitespace-only lines are
  rejected and normalized exactly like zero or multiple blank lines.
- Correction TDD RED had 3 expected failures; GREEN has 82/82 focused tests.
  Post-generation inventory remains 502 eligible files with 0 zero, 502 one,
  0 multiple, 0 whitespace-only, and 3/3 compliant shebangs.
- Targeted style/maintainability re-review is CLEAN. The independent mechanical
  re-audit reran both canonical generators and confirmed that all 463 migrated
  TS/TSX files contain only the required added newline.
- Fresh `pnpm verify:release` passed: 246 test files passed and 3 skipped;
  3,913 tests passed and 14 skipped. Coverage was 94.18% statements, 90.41%
  branches, 94.09% functions, and 95.19% lines.
