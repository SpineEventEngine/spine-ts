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
- [ ] Trace current browser, MySQL, Inbox, provider, docs, and JVM paths.
- **Status:** in_progress

### Phase 2: Requirements split and contract freeze

- [ ] Dispatch the one required Sol High requirements splitter.
- [ ] Accept only after explicit-profile and telemetry checks.
- [ ] Freeze public, persistence, serialized, lifecycle, and configuration
  decisions.
- [ ] Produce the dependency-ordered Wave plan and implementation task briefs.
- **Status:** pending

### Phase 3: Planning review and corrections

- [ ] Run mechanical pre-review lint.
- [ ] Collect the complete relevant specialist review wave.
- [ ] Aggregate, correct, and converge accepted findings.
- **Status:** pending

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

| Decision | Rationale |
| --- | --- |
| Use T-0187 for Wave 12 planning | It follows completed T-0186 and keeps the planning milestone review-sized. |
| Keep the plan milestone planning-only | Human requires durable contract/dependency freeze before product changes. |
| Reuse `DECISION_LOG.md` | Repository decisions are canonical; a parallel ADR directory would fragment authority. |

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| BSD `find` rejected GNU `-printf` | 1 | Replaced it with portable `find` plus `sed`; no repository state was changed. |

