# T-0193: Wave 12 Documentation Convergence

Status: ACCEPTED

Baseline: `512ecd52998529d1c43f21c084bae56c0520769d`

Risk: standard documentation convergence after accepted high-risk runtime work.

## Objective

Make reader, package, specification, architecture, decision, and completion
records describe only the accepted Wave 12 browser-streaming, normalized-query,
and delivered-Inbox behavior.

## Functional Acceptance

- A healthy browser stream remains active across ordinary successive updates;
  reconnect and authoritative re-query remain recovery for real best-effort
  gaps or disconnects.
- Publish the exact normalized-plan capability matrix, parameterized MySQL
  pushdown, tenant/storage-group containment, normalized-offset exclusion,
  finite candidate bound, provider profile, and index expectations.
- Distinguish `keepUntil` deduplication protection from bounded shard-owned
  cleanup eligibility. Document no second retention setting, timer, scheduler,
  or configuration.
- Keep `catchUpReadSide()` described only as a process-local reset/replay helper,
  never Projection catch-up.
- Keep domestic/external event exchange and runtime enrichment unimplemented.
  Preserve first-field routing and non-event-sourced Aggregate latest-state
  truth.
- Remove stale Wave 12 future-tense framing from technical, runtime, completion,
  and decision records. Root `README.md` remains repository-entry documentation
  and is excluded.

## Human-Imposed Requirements Ledger

1. P-04 documentation describes implemented runtime behavior only.
2. `catchUpReadSide()` earns no Projection catch-up credit.
3. No domestic/external event exchange or runtime enrichment claim.
4. No Wave 13-19 provisional API or documentation leak.
5. Similar naming, local helpers, mocks, and coverage inclusion are not runtime
   or provider proof.
6. Live provider/runtime evidence remains separate from V8 coverage.
7. Root README remains repository-entry documentation only.
8. Documentation follows stabilized accepted behavior.
9. The protected human review folder is not read or mutated for this task.

## Ownership And Verification

- Owned files: affected `docs/` guides, package `README.md`/`REFERENCE.md`
  files, and Wave 12 build-protocol specification/architecture/completion/
  decision/task records. Root `README.md` is excluded.
- Deterministic gates: terminology/prohibited-claim scans, links, snippets,
  TypeDoc/API audience, TSDoc if touched, formatting, and diff check.
- Selected final profile: `pnpm verify:task -- --no-tests`; executable checker
  changes are not planned. If tooling changes, changed executable lines and
  branches require at least 90% coverage.
- Review lanes: documentation, TypeScript/API, and performance/reliability.
  Style is N/A unless tooling/structure changes. Security is N/A except truthful
  tenant/trust-boundary wording; final Wave security remains T-0194.

## Implementation Assignment

- Existing role: `implementer`.
- Explicit profile: `gpt-5.6-terra`, reasoning `medium`; no subagents.
- Bounded function: implement only the frozen T-0193 documentation inventory
  against accepted runtime endpoint `512ecd52`.
- Runtime telemetry is unavailable; the immutable configured role/profile is
  the durable acceptance record.

## Implementation Evidence

- Checkpoint `d81493d0` updates only the assigned documentation, decision,
  completion, and work-log inventory; root `README.md` and runtime files remain
  untouched.
- `pnpm docs:audience:check`, `pnpm docs:api:check`, `pnpm lint:tsdoc`,
  `pnpm format:check`, and `git diff --check` passed. The targeted
  stale-future/prohibited-claim scan returned no matches.
- `pnpm docs:snippets:check:generated` remains blocked by pre-existing
  unresolved Message Board model declaration imports after a successful
  `pnpm typecheck:build`; T-0193 changed no snippets or executable checker.
- Selected final profile `pnpm verify:task -- --no-tests` passed once after
  convergence. It completed Node policy, frozen Proto verification, TypeScript
  build, runtime-copy, and declaration normalization with exit code 0.
- Review correction: the reader and provider references distinguish accepted
  candidate ceilings from their one-row raw overflow lookahead (10,000/10,001
  default MySQL; 1,000/1,001 Datastore), and cleanup is documented as one page
  plus at most one continuation after a full protected no-progress page.
  Focused claim/table scans, audience/API, format, and diff checks passed; the
  final no-test task profile was rerun once after this convergence.
