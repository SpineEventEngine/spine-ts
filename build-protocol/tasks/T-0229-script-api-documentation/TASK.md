# T-0229: Script API Documentation

Status: Complete
Start: `2026-09-16`
Baseline: `1dfcab47c356516750458b82203c5fdc355ec6c1`
Branch: `fix-package-dependency-cycles`
Classification: Standard; broad tooling documentation and a bounded enforcement
change, with no runtime or public package contract change.

## Objective

Document every exported declaration under `scripts/` with useful TSDoc and make
the existing TSDoc checker reject newly undocumented script exports.

## Evidence

The initial inventory found 135 exports in `.js`, `.mjs`, and `.ts` script
sources: 38 had an immediately preceding TSDoc block and 97 did not. Review
then found three more exports in tracked `.d.mts` declarations, bringing the
complete inventory to 138. Existing TSDoc enforcement checked block layout in
JavaScript files, but its declaration pass did not require documentation for
script exports.

## Acceptance

- Every exported function and constant under `scripts/` has accurate TSDoc.
- Function documentation describes inputs and return values where meaningful,
  plus material side effects or failure behavior.
- Documentation is written for maintainers and contains no task chronology.
- The checker rejects undocumented script exports in every supported source
  form and accepts documented equivalents; the first regression is observed
  RED before implementation.
- Existing TSDoc, formatting, lint, focused tests, and the applicable repository
  verification profile pass.
- The correction is independently reviewed and pushed to the existing branch.

## Estimate

Expected active work is 1–2 hours, plus the repository verification gate. The
range covers 97 missing declarations across release, package, Proto, generated
source, and policy tooling, each of which must be described from its actual
implementation rather than filled with generic text.

## Dispatch And Review

Implementation uses the existing implementer role with explicit
`gpt-5.6-terra` / `medium`. The implementer is responsible for script TSDoc,
the checker, and its focused tests. Desktop supports the required explicit
profile; runtime self-introspection is not exposed, so configured dispatch
fields are the acceptance evidence. Independent documentation/API review will
use the existing TypeScript/API documentation reviewer at explicit
`gpt-5.6-terra` / `high` with no conversation history. Style/maintainability
review is also relevant to the enforcement change. Performance/reliability,
security, domain, public API, wire, and storage concerns are N/A because no
runtime path or published contract changes.

The first implementation context completed the checker regression and all 135
export summaries but exhausted two turns during tag normalization. A bounded
normalization context made the checker mechanically clean, then correctly
reported that its automatic tag completion left 383 generic phrases. That
output is not acceptable documentation. Recovery is split across three
non-overlapping documentation-only file batches so semantic rewrites can run in
parallel without conflicting writers: release/package/snapshot tooling,
Proto/generated tooling, and general repository-policy tooling. Each uses the
existing implementer role with explicit `gpt-5.6-terra` / `medium`, may edit
only its assigned files, and must reduce the prohibited generic phrases to zero
by reading actual implementations. The orchestrator retains the checker/tests
and task record. No context may weaken enforcement or add debt.

## Constraints

- Preserve behavior; do not refactor scripts while documenting them.
- Do not add empty or name-restating comments.
- Do not create a new branch or worktree.
- Do not publish, create a pull request, or change `master`.

## Implementation Evidence

- Test-first RED: the focused fixture proved that an undocumented exported
  script function was accepted before the checker change.
- Focused GREEN: ordinary functions, async function constants, plain constants,
  declaration-file interfaces and functions, and JSDoc typedefs now receive
  stable `missing-doc` diagnostics, while documented equivalents pass. Fixtures
  exercise every configured script extension, including `.d.mts` declarations.
- The checker includes all handwritten JavaScript and TypeScript source
  extensions under `scripts/` in addition to the former package/example scope;
  it adds no debt and preserves full callable summary, parameter, and result
  validation.
- Final inventory: 138 of 138 exported script declarations have TSDoc.
- The initial 97 `missing-doc` findings and all layout/tag findings are zero.
- A prohibited-boilerplate scan is clean after semantic rewrites across release,
  package, snapshot, Proto, generated-source, and repository-policy tooling.
- The complete checker regression file passes 60 tests. Tooling typecheck,
  changed-script ESLint, repository formatting, and `git diff --check` pass.
- The first focused ESLint shell command incorrectly supplied all filenames as
  one argument and did not inspect code. The null-delimited rerun inspected all
  changed scripts and passed.

The original implementer and bounded normalizer used explicit Terra/medium but
exhausted their turns before semantic normalization. Three non-overlapping
Terra/medium documentation batches completed the recovery without file
conflicts; all configured dispatch fields matched the task record. Independent
no-history TypeScript/API documentation and style/maintainability reviews ran at
explicit `gpt-5.6-terra` / `high`. Their first wave found the omitted `.d.mts`
scope, missing source-form and non-callable regression cases, a JSDoc typedef
bypass, one inaccurate command-runner contract, and this record's duplicate
evidence heading. Later review found an overbroad formatter exception and two
inaccurate or incomplete declaration comments. The accepted findings were
corrected, the formatter exception was constrained to the first member directly
after its container brace, and both review lanes finished with no findings.

`pnpm verify:release` completed with 290 of 290 test files and 4,726 of 4,726
tests passing. Its first run exposed one missing tarball in the local pnpm
offline store; the exact failed test passed after caching that dependency, and
the complete release profile then passed on a fresh rerun.
