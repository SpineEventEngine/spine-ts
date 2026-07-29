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

## Final Object-Cycle Correction Result

The accepted cycle-safety P1 is implemented and mechanically evidenced pending
the affected style lane's acceptance. Object-member traversal shares a
declaration-visited set through each reference branch and copies it for
siblings, so mutually recursive object-literal bindings terminate without
hiding independently exposed callable aliases.

The new `a`/`b` cyclic-binding fixture failed with a stack overflow before the
correction. It now completes with ordinary `api.a` documentation diagnostics;
the focused suite passes 34/34 and the direct checker stays green. Exact debt
remains D 537, E 205, F 1,694, G 558, H 440, K 58, L 39, M 130, and N 79:
3,740 total.

The existing implementer profile was explicitly configured as `gpt-5.6-terra`
/ medium. Runtime self-introspection was unavailable; no visible fallback or
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

## Wave 1 Re-review Results

### Style And Maintainability

- P1: `@inheritDoc` accepts an inherited member with only a summary, even when
  required parameter or non-void result documentation is incomplete and
  temporarily debt-exempt.
- P1: named object APIs created with shorthand properties or references to
  callable declarations are not inspected as public callables.
- P1: overload occurrences for class, interface, and type-literal members do
  not receive distinct identities; debt writing can also serialize duplicate
  observations that the next read rejects.

The reviewer confirmed closure of the prior default-expression, direct
type-literal, and locale-dependent-ordering findings.

Actual runtime self-introspection was unavailable. The immutable configured
style/maintainability-reviewer profile `gpt-5.6-terra` / high is accepted; no
visible mismatch or fallback appeared.

### TypeScript And API Documentation

- P1: public inline APIs inside union, intersection, parenthesized, or generic
  wrapper types are not traversed. Current examples include `Readonly<{...}>`
  and union-contained callable properties.

The reviewer confirmed closure of the prior direct callable/constructor alias,
direct nested type-literal, default-binding, indirect top-level overload, and
declaration-merge findings.

Actual runtime self-introspection was unavailable. The immutable configured
TypeScript/API-documentation-reviewer profile `gpt-5.6-terra` / high is
accepted; no visible mismatch or fallback appeared.

## Wave 1 Re-review Dispositions

All four P1 findings are accepted as one final targeted correction batch:

1. Validate inherited documentation with the same callable parameter and
   result completeness rules before accepting `@inheritDoc`.
2. Resolve shorthand and referenced callable object properties and inspect the
   exposed callable contract.
3. Assign stable occurrence identities to member overloads and ensure
   `--write-debt` never serializes duplicate observations.
4. Recursively traverse inline APIs through union, intersection, parenthesized,
   and relevant generic-wrapper type nodes while preserving stable owner
   identities.

The existing correction implementer retains ownership of the checker, focused
fixtures, exact debt partitions, and evidence. The explicit configured profile
is `gpt-5.6-terra` / medium; runtime metadata will be recorded when exposed,
otherwise the immutable profile and limitation are retained.

## Wave 1 Final Targeted Correction Result

All four accepted P1 corrections are implemented and mechanically evidenced
pending the reviewers' endpoint acceptance:

1. A base or implemented callable used by `@inheritDoc` must itself have a
   valid callable summary plus complete parameter and non-void result tags.
   The new incomplete-base fixture failed before the correction and now emits
   `invalid-inheritdoc` for the derived member.
2. Shorthand and identifier-referenced callable properties in named object
   APIs, including nested properties, resolve through the TypeChecker and are
   inspected under their exposed public identity.
3. Class, interface, and type-literal member overloads receive source-order
   suffixes. The debt-writer regression proves persisted entries are unique and
   never include derived duplicate-observation diagnostics.
4. Type traversal now descends through parenthesized, union, intersection, and
   generic-wrapper nodes. Repeated structural members in those wrappers receive
   stable occurrence identities.

Focused `scripts/check-tsdoc.test.mjs` passes 31/31. Debt was regenerated only
after the passing suite, and the direct checker recheck passes with D 537, E
205, F 1,694, G 558, H 440, K 58, L 39, M 130, and N 79: 3,740 entries total.

The existing implementer profile was explicitly configured as `gpt-5.6-terra`
/ medium. Runtime self-introspection was unavailable; no visible fallback or
mismatch appeared.

Independent endpoint acceptance reran 33/33 focused tests, the direct checker,
tooling typecheck, scoped ESLint, pinned Prettier, the release-inventory
reproducibility check, and `git diff --check`; all passed.

The affected style/maintainability concern is redispatched to the existing
reviewer with explicit configured profile `gpt-5.6-terra` / high. Its scope is
only property/element callable resolution, recursively referenced object
bindings, cycle safety, and the two new regressions. Runtime metadata is
recorded when exposed; otherwise the immutable profile and limitation apply.

## Final Cycle-safety Re-review

Property access, literal element access, and non-cyclic referenced-object
coverage are accepted. One P1 remains: the active declaration-cycle guard is
not threaded through recursion into a referenced object literal, so mutually
recursive same-source bindings can restart with a fresh visited set and
overflow the stack.

The finding is accepted. The existing implementer, explicitly configured
`gpt-5.6-terra` / medium, owns the exact propagation fix and one bounded
mutually-recursive-binding regression. Only this style concern reopens after
mechanical verification. Runtime reviewer introspection was unavailable; the
immutable configured style profile `gpt-5.6-terra` / high is accepted with no
visible mismatch or fallback.

## Cycle-safety Correction Result

The active visited-declaration set is now propagated through referenced object
members and object-literal recursion. A mutually recursive `a`/`b` binding
fixture reproduced a stack overflow before the correction and now terminates
with bounded public-identity diagnostics.

Focused tests pass 34/34 and the direct checker stays green, so exact debt
remains 3,740. The implementer also passed pinned Prettier, scoped ESLint,
tooling typecheck, `git diff --check`, and canonical lint. Independent
acceptance reran 34/34 focused tests, the direct checker, tooling typecheck,
scoped ESLint, pinned Prettier, and `git diff --check`; all passed.

The affected style concern is redispatched to the existing reviewer under the
explicit configured profile `gpt-5.6-terra` / high. Review scope is only visited
set propagation and the mutually recursive regression. Runtime metadata is
recorded when exposed; otherwise the immutable profile and limitation apply.

## Final Acceptance

Style/maintainability: CLEAN. The reviewer confirmed propagation of the active
visited set through referenced object members and object literals, independent
sibling inspection, and regression coverage of the prior cyclic stack-overflow
path.

TypeScript/API documentation: CLEAN.

Documentation: CLEAN.

Performance/reliability: N/A. The checker is a repository-only deterministic
tool bounded to tracked authored files; no runtime, concurrency, persistence,
resource-lifecycle, or production reliability behavior changed.

Runtime self-introspection was unavailable for the final style review. The
immutable configured profile `gpt-5.6-terra` / high is accepted with no visible
mismatch or fallback. No review finding remains open.

Independent acceptance reran the focused suite (31/31), direct checker,
tooling typecheck, scoped ESLint, pinned Prettier, and `git diff --check`.
Canonical lint initially exposed a pre-existing `no-undef` failure in the
tracked completed-task inventory generator because it used `process` without a
Node import. Adding the explicit `node:process` import is a deterministic
mechanical correction; scoped ESLint and canonical `pnpm lint` then passed.
No Spine JVM build was invoked.

## Final Targeted Re-review Dispatch

- Style/maintainability reviewer: existing role, explicitly configured
  `gpt-5.6-terra` / high. Scope is closure of the three accepted style P1
  findings and regression adequacy.
- TypeScript/API documentation reviewer: existing role, explicitly configured
  `gpt-5.6-terra` / high. Scope is closure of the wrapped-inline-API P1 finding
  and public-contract traversal adequacy.
- Runtime metadata must be recorded when exposed; otherwise each immutable
  configured profile and the introspection limitation are accepted unless a
  visible mismatch or fallback appears.

## Final Targeted Re-review Results

### TypeScript And API Documentation

CLEAN. Recursive traversal through parenthesized, union, intersection, and
generic type-argument paths is accepted, including stable owner and occurrence
identities. The combined `Readonly<(A & B) | C>` regression covers callable and
constructor members.

The reviewer independently confirmed 31/31 focused tests, the direct checker,
and `git diff --check`. Runtime self-introspection was unavailable; the
immutable configured profile `gpt-5.6-terra` / high is accepted with no visible
mismatch or fallback.

### Style And Maintainability

Two accepted P1s are closed: inherited callable completeness, and stable member
overload identities with duplicate-safe debt writing.

One P1 remains: referenced named-object APIs resolve bare identifiers but not
property/element access such as `helpers.run`, nor an identifier whose value is
a nested object literal. Those shapes can still expose undocumented callables
through a public object API.

The finding is accepted. The existing implementer owns one final narrow
correction: resolve property/element references and recursively referenced
object-literal bindings (or reject an unresolved callable public shape), with
focused fixtures for both examples. The explicit profile remains
`gpt-5.6-terra` / medium. After mechanical verification, only the affected
style concern reopens.

Runtime self-introspection was unavailable for the reviewer; the immutable
configured profile `gpt-5.6-terra` / high is accepted with no visible mismatch
or fallback.

## Final Object-Reference Correction Result

The remaining accepted style P1 is implemented and mechanically evidenced
pending the affected style lane's acceptance. Named public object APIs now
inspect same-source authored callable declarations reached through dot access,
literal element access, and recursively referenced object-literal bindings.
Resolved diagnostics use the public property identity and resolution is cycle
guarded without following external runtime values.

Two new fixtures were red before the correction: `helpers.run` /
`helpers["run"]`, and `const nested = { run }; export const api = { nested }`.
Focused `scripts/check-tsdoc.test.mjs` now passes 33/33 and the direct checker
stays green, so exact debt remains D 537, E 205, F 1,694, G 558, H 440, K 58,
L 39, M 130, and N 79: 3,740 total.

The existing implementer profile was explicitly configured as `gpt-5.6-terra`
/ medium. Runtime self-introspection was unavailable; no visible fallback or
mismatch appeared.
