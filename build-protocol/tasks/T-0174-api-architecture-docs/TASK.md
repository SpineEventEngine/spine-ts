# T-0174: Canonical API And Architecture References

Status: Implementation authorized and starting

## Objective

Reconcile `docs/api/README.md` and `docs/architecture/README.md` after the
package and example journeys have converged. Keep exhaustive public/runtime
facts, remove duplicate tutorial prose, and make these the canonical detailed
targets used by the beginner guide.

## Classification

High-risk documentation: these documents define public API navigation,
architecture boundaries, routing, persistence, delivery, deployment, logging,
and supported-topology contracts across the framework.

## Human-Imposed Requirements Ledger

- Scope is exactly `docs/api/README.md`, `docs/architecture/README.md`, and
  T-0174 records. Shared snippet checker/tests may change only if convergence
  requires an exact policy or path expectation.
- Current reader-facing documentation only; historical records stay historical.
- Preserve beginner-oriented navigation while keeping dense API/runtime facts
  in these canonical references. Avoid mechanical prose and needless “own”.
- Remove duplicated tutorials; provide one intentional canonical target for
  each onward link required by the ten-section beginner guide.
- Do not claim TypeScript routing consumes `(is).java_type` or
  `(every_is).java_type`; frozen Proto definitions are wire-preservation only.
- Do not present `@Route` or `routeSemantic()` as TypeScript APIs. Current
  routing is exact `route()` plus `replaceDefault()` for Command, Event, and
  state-update routing.
- Preserve all corrected logging, `@Where`, implicit ID, rejection, storage,
  query, tenancy, delivery, deployment, and single-Gateway facts.
- Multiple-Gateway behavior remains deferred; Cloud Run remains outside the
  initial offering.
- Every TypeScript fence passes the strict checker; all links resolve. T-0169
  copyright and T-0170 snippet gates remain intact.

## Assignment

Single implementation owner: existing `implementer`, explicitly configured as
`gpt-5.6-terra` / medium. The owner uses no subagents, preserves unrelated
changes, and records runtime metadata if exposed.

## Verification And Review

Run strict snippets, API/audience, canonical-target and retired-routing scans,
links, format/copyright/diff, and `verify:task -- --no-tests` unless shared
snippet policy changes require `verify:release`. Review documentation,
TypeScript/API documentation, and performance/reliability. Style is required
only if shared checker code changes. Security is N/A unless a trust-boundary
claim or implementation changes.
