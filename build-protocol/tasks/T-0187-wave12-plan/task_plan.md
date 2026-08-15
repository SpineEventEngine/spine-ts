# T-0187 Working Plan

## Goal

Freeze, review, verify, integrate, and publish the executable Wave 12 plan, then
continue into its first approved implementation task.

## Current Phase

Phase 1 — discovery and current-state tracing.

## Phases

### Phase 1: Governance, baseline, and discovery

- [x] Verify `origin/main` and isolate the worktree.
- [x] Read governing documents and relevant accepted decisions.
- [x] Record classification, scope, exclusions, ledger, skills, and child gate.
- [x] Trace current browser, MySQL, Inbox, provider, docs, and JVM paths.
- **Status:** completed

### Phase 2: Requirements split and contract freeze

- [x] Dispatch the one required Sol High requirements splitter.
- [x] Accept only after explicit-profile and telemetry checks.
- [x] Freeze public, persistence, serialized, lifecycle, and configuration
      decisions.
- [x] Produce the dependency-ordered Wave plan and implementation task briefs.
- **Status:** completed

### Phase 3: Planning review and corrections

- [ ] Run mechanical pre-review lint.
- [ ] Collect the complete relevant specialist review wave.
- [ ] Aggregate, correct, and converge accepted findings.
- **Status:** in_progress

### Phase 4: Verification, integration, and remote closure

- [ ] Run the cheap planning preflight.
- [ ] Run `pnpm verify:task -- --no-tests` once after convergence.
- [ ] Integrate, post-merge verify proportionately, push, reconcile remote refs,
      and prove exactly `origin/main` with no tags.
- **Status:** pending

### Phase 5: First Wave 12 implementation task

- [ ] Create its isolated branch/worktree from verified `origin/main`.
- [ ] Start the approved failing-before implementation packet unless blocked by
      a genuine unresolved contract choice.
- **Status:** pending

## Decisions Made

| Decision                                                                                                | Rationale                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Use T-0187 for Wave 12 planning                                                                         | It follows completed T-0186 and keeps the planning milestone review-sized.                                                                                                                 |
| Keep the plan milestone planning-only                                                                   | Human requires durable contract/dependency freeze before product changes.                                                                                                                  |
| Reuse `DECISION_LOG.md`                                                                                 | Repository decisions are canonical; a parallel ADR directory would fragment authority.                                                                                                     |
| Treat delivered rows as immediately cleanup-eligible after `keepUntil` no longer protects deduplication | This matches pinned JVM cleanup semantics without inventing a second retention concept; final freeze awaits splitter review.                                                               |
| Do not add offset to `NormalizedQueryPlan` in Wave 12                                                   | The current normalized contract has no offset. The matrix will record it as unsupported/rejected rather than silently broadening the public contract; final freeze awaits splitter review. |

## Errors Encountered

| Error                                                  | Attempt | Resolution                                                                             |
| ------------------------------------------------------ | ------- | -------------------------------------------------------------------------------------- |
| BSD `find` rejected GNU `-printf`                      | 1       | Replaced it with portable `find` plus `sed`; no repository state was changed.          |
| Combined adapter-source command exceeded output budget | 1       | Replaced it with narrow per-file/provider inspection; no repository state was changed. |
