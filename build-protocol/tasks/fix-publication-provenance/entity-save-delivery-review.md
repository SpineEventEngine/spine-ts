# Entity save and delivery plan review

## Scope and assignments

Plan only, baseline `74c6b5615`, current branch `fix-publication-provenance`.
The plan's full Human-Imposed Requirements Ledger is the review contract.
No runtime changes, builds, tests, publication or Git mutations by children.
Historical design records are not authority for the rejected Entity conflict
feature. Unchanged historical text is not a finding unless actively relied on.

Native fresh architecture dispatch failed at the agent limit. The completed
alternative used the existing requirements-splitter function through Desktop
CLI, explicitly `gpt-6-astra` / `high`, standard tier, ephemeral read-only
session with memories and child agents disabled. Output:
`/tmp/entity-save-delivery-architecture.md`. The source check confirmed the
official JVM revision. Actual runtime metadata was not independently exposed;
explicit dispatch and configured role match, with no model fallback reported.

Architecture session: `01a0f712-b8a7-79b2-b310-39b0495ae825`.

## Architecture findings and dispositions

1. Scan-wide identities beyond the recent cache: **proposal rejected**. The
   reviewer correctly identified a bounded-cache limitation in both current TS
   and JVM, but proposed an unbounded scan-wide identity set. That is not required
   by the user's request to follow JVM and avoid new concepts. The plan now
   explicitly preserves page-local and recent-cache behavior, tests its boundary,
   and requires evidence for any regression introduced by forward scanning. It
   makes no arbitrary-distance duplicate guarantee. Independent review must
   check this decision; a demonstrated regression remains blocking.
2. Separate current-state rejection, database retries and immutable collisions:
   **accepted**. SQL/Datastore must finish associated records even when current
   already equals next. Memory's existing event-ID collision behavior remains.
3. Affected-record atomic application: **accepted**. Complete preparation first;
   validate input/live collisions; avoid recursive queue acquisition; restore
   full affected entries only if a supported mutation can fail.
4. MyISAM/Aria partial writes: **accepted**. Preserve the existing write order,
   failure-injection tests and identical storage retry. Do not claim rollback
   or automatic handler replay for these engines.
5. Provider export exposure: **accepted**, independently corrected during the
   architecture pass. Published `storage/provider` declarations change, ordinary
   application APIs and persisted formats do not.
6. Scan end, clock and performance claims: **accepted**. Empty/partial final
   pages end scans; only deliveries justify another scan. Keep TS's exact expiry
   boundary and consistent injected time. Removing page-prefix rereads does not
   eliminate internal provider traversal. Benchmark target remains unchanged.

## Independent review assignment

Existing performance/reliability reviewer, senior persistence and delivery
engineer, explicit `gpt-6-sol` / `medium`, standard tier, fresh ephemeral session,
memories disabled, no inherited chat or earlier reviewer context. Review the
complete revised plan and ledger against current TS source and pinned official
JVM code. Check for lost writes, accidental new conflict checks, partial-write
retry errors, altered duplicate guarantees, paging/cancellation regressions,
clock inconsistencies, missing acceptance cases and unclear product choices.
No children, edits, builds, tests or Git actions. Completed in fresh Desktop CLI
session `01a0f717-da3c-78c2-bcb4-e42cb0762317`; output:
`/tmp/entity-save-delivery-independent-review.md`. Both model and reasoning were
explicit and matched the configured concern profile. Actual runtime metadata
was not independently exposed; no model fallback was reported. No prior
reviewer report or inherited conversation was supplied to this reviewer.

## Independent result and correction

One accepted important plan finding: the early cleanup check alone would leave
retained-row duplicate recognition reading `Date.now()` while storage uses an
injected clock. The mismatch predates the plan, but the planned clock correction
must cover both decisions. Section 5 now explicitly shares the applicable clock
for cleanup and page-local retained identities, preserves the existing exact
expiry boundary, and tests ahead/behind/equal times using a fresh delivery
instance to isolate the retained-row behavior from the recent cache.

The reviewer found the remaining persistence and paging approach consistent with
current code and JVM. No demonstrated deduplication regression justifies an
unbounded set or persistent index. No unresolved product decisions were found.
All accepted plan findings are addressed. The clock clarification changes only
the written acceptance criteria; no runtime correctness is claimed or tested.

## Review concern coverage for this planning turn

- Performance/reliability: completed; one accepted plan finding incorporated.
- TypeScript/API: exported provider contract explicitly covered by this bounded
  plan review; implementation will require its specialist review and typechecks.
- Documentation: internal planning text only; main wording/link checks. Public
  documentation changes and the documentation specialist follow implementation.
- Style/maintainability: no code changed; future implementation review specified.
- Security: no auth, trust or release security change in this plan. No repeat
  of the completed publishing security review for a planning-only extension.
