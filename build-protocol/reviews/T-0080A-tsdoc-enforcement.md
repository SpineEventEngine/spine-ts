# T-0080A Review Log

## Review Scope

- Baseline: `c1bd1026`.
- Review endpoint: the committed T-0080A implementation checkpoint created
  after this assignment record.
- Changed behavior: deterministic authored-TypeScript TSDoc enforcement, exact
  temporary debt partitions, focused fixtures, and root lint integration.
- Human requirements: every T-0080A ledger item, especially complete authored
  export/member coverage, third-person callable summaries, parameter/result
  documentation, confined source discovery, and exact non-broadening debt.

## Pre-Review Evidence

- Focused fixture suite: 22/22 passed independently.
- Direct checker and `git diff --check`: passed independently.
- Tooling typecheck and scoped ESLint: passed independently.
- Pinned Prettier 3.9.0 check over both new untracked scripts, changed records,
  package metadata, and all debt JSON: passed independently.
- Exact current debt: 3,556 entries across T-0080D/E/F/G/H/K/L/M/N.
- Pre-review status/claim scan: clean; no production/example file changed and
  no future runtime behavior is claimed.

## Wave 1 Assignments

### Style And Maintainability

- Existing role: style/maintainability reviewer.
- Scope: checker depth/cohesion, deterministic identities and diagnostics,
  fixture maintainability, debt representation, root integration, and the
  human rule against shallow/mechanical documentation policy.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: high.
- Both fields must be explicit in dispatch.

### Documentation

- Existing role: documentation reviewer.
- Scope: whether the checker enforces the requested concise, useful,
  third-person TSDoc semantics; whether task/work evidence is accurate; and
  whether temporary debt is described without implying accepted final debt.
- Expected/configured model: `gpt-5.6-luna`.
- Expected/configured reasoning: medium.
- Both fields must be explicit in dispatch.

### TypeScript And API Documentation

- Existing role: TypeScript/API documentation reviewer.
- Scope: authored export reachability, declaration/member/callable coverage,
  TypeChecker return semantics, TSDoc tag handling, overload/object API
  identities, and TypeDoc/API compatibility.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: high.
- Both fields must be explicit in dispatch.

### Performance And Reliability

N/A. This slice changes repository-only tooling and JSON debt records, not
runtime, persistence, concurrency, lifecycle, resource ownership,
cancellation, retry, or performance behavior. Source traversal is bounded to
tracked authored paths, path-confined before TypeScript reads them, and covered
by focused and canonical lint verification.

## Runtime Metadata Policy

Each reviewer records actual runtime metadata when exposed. Otherwise the
immutable configured existing role/profile and the self-introspection
limitation are the accepted evidence unless a visible mismatch or fallback
appears.

## Wave 1 Results

### Documentation

CLEAN. The reviewer verified the checker policy, active task/work/review
claims, direct checker result, and exact 3,556-entry totals. Temporary debt is
accurately framed as migration state, not accepted final debt.

Actual runtime self-introspection was unavailable. The immutable configured
documentation-reviewer profile `gpt-5.6-luna` / medium is the accepted
evidence; no visible mismatch or fallback appeared.

### Style And Maintainability

- P1: unrestricted `@inheritDoc` skips every required documentation check.
- P1: default-expression exports, recursively nested object APIs, and public
  type-literal/function signatures escape traversal.
- P1: local overloads made public through an export list lose distinct
  identities.
- P2: `localeCompare` makes debt/diagnostic ordering host-locale-dependent.

Actual runtime self-introspection was unavailable. The explicitly dispatched
and configured profile `gpt-5.6-terra` / high is the accepted evidence; no
visible mismatch or fallback appeared.

### TypeScript And API Documentation

- P1: exported callable type aliases and nested type-literal members are not
  enforced as callables.
- P2: unrestricted `@inheritDoc` is a documentation bypass.
- P2: declaration merging or duplicate structural identities can let one debt
  entry suppress a second observed violation.

Actual runtime self-introspection was unavailable. The explicitly dispatched
and configured profile `gpt-5.6-terra` / high is the accepted evidence; no
visible mismatch or fallback appeared.

## Wave 1 Dispositions

All findings are accepted and deduplicated into one correction batch:

1. Verify `@inheritDoc` against a genuine inherited/implemented documented
   member before skipping local summary/parameter/result checks.
2. Traverse every exported API shape, including export assignments, callable
   type aliases, recursively nested type literals, and recursively nested
   object APIs.
3. Give every overload, declaration-merge occurrence, and indirectly exported
   declaration a unique stable source-order identity so one debt entry cannot
   suppress another occurrence.
4. Replace default-locale sorting with deterministic ordinal/code-point
   ordering and cover non-ASCII fixtures.

The documentation lane is unaffected by the implementation correction unless
active prose/evidence changes substantively. Style and TypeScript/API lanes
must re-review the corrected immutable endpoint.

## Wave 1 Correction Pass 1

Rejected before re-review. The pass added ordinal comparison and duplicate-key
signalling, but it did not add any required fixture or implement export
assignments, callable type aliases/type literals, recursively nested object
APIs, or indirect overload identities. It also retained unconditional
`@inheritDoc` returns, so an unverified tag still bypassed the contract.

The accepted findings remain open. A fresh existing implementer context owns
the same bounded correction batch with explicit `gpt-5.6-terra` / medium
configuration.

## Wave 1 Correction Pass 2

All accepted findings are implemented and mechanically evidenced pending the
required style and TypeScript/API re-review of this corrected endpoint.

1. `@inheritDoc` is no longer an unconditional bypass. The checker requires a
   documented, type-compatible directly inherited or implemented named member;
   otherwise it emits `invalid-inheritdoc` and continues normal summary,
   parameter, and result enforcement. New fixtures prove both invalid
   standalone use and a valid documented-interface implementation.
2. Export assignments, default callable/object expressions, recursively nested
   object APIs, callable/constructor aliases, and recursive type-literal
   members are traversed with stable identities. New exact fixtures cover each
   requested shape.
3. Direct and local-export-list overloads plus declaration-merge occurrences
   receive source-order suffixes. Derived duplicate-observation failures also
   include an occurrence suffix. The regression fixture proves a debt entry for
   `Contract#1` does not hide `Contract#2`.
4. The retained ordinal comparator is covered by a non-ASCII (`z`/`é`)
   ordering fixture.

Focused evidence: `npx vitest run scripts/check-tsdoc.test.mjs` passed 27/27.
The checker was directly run before regeneration (expected baseline drift),
then `--write-debt` regenerated exact partitions and the recheck passed.
Current exact debt is D 529, E 205, F 1,679, G 473, H 437, K 49, L 39, M 130,
N 79: 3,620 entries total.

The existing implementer was explicitly configured as `gpt-5.6-terra` /
medium. Runtime self-introspection was unavailable; no visible fallback or
mismatch appeared.

Final correction validation passed: pinned Prettier 3.9.0, scoped ESLint,
tooling TypeScript check, `git diff --check`, and canonical `pnpm lint`. No
Spine JVM build was invoked.

Pre-review fixture correction: the anonymous default arrow and object cases
now reside in separate tracked fixture modules. A new positive fixture proves
that a documented local callable exported through `export default binding`
needs no duplicate comment on the identifier export assignment. The fixture
failed against the prior checker and passes after identifier export assignments
resolve to their separately checked underlying binding; anonymous default
expressions remain directly enforced. The direct checker stayed green, so debt
totals are unchanged.
