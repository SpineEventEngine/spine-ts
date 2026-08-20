# Task Plan: Remove Message Board fake-session expiry and concurrent purge failures

## Goal
Make the public Message Board use an explicit non-session admission lifecycle,
keep authenticated-session expiry semantics intact, and guarantee that
overlapping subscription cleanup never produces HTTP 500.

## Current Phase
Phase 2

## Phases

### Phase 1: Requirements & Discovery
- [x] Trace the repeated browser Cancel sequence end to end
- [x] Reproduce the durable expiry-purge queue collision
- [x] Select the smallest coherent public-admission contract
- [x] Record compatibility and persistence consequences
- **Status:** completed

### Phase 2: RED tests
- [ ] Retain a failing Message Board test proving public admission has no fixed expiry
- [x] Retain a failing Gateway/durable-binding concurrency test proving overlapping purges settle
- [x] Retain native/Gateway behavior proving cleanup contention never becomes generic Internal/500
- **Status:** pending

### Phase 3: Implementation
- [ ] Add an explicit public admission path without manufacturing a session
- [ ] Define activation/process-owned public subscription retention and durable orphan cleanup
- [ ] Coalesce or serialize durable expiry purges without weakening per-ID operation bounds
- [ ] Preserve authenticated expiry and cancellation behavior
- **Status:** pending

### Phase 4: Testing & Verification
- [ ] Run focused auth/server/Message Board tests with changed-code coverage
- [ ] Run two-tab browser test beyond the former five-minute boundary
- [ ] Verify no repeated expiry reconnects, no Cancel 500, and clean shutdown
- [ ] Run relevant mechanical gates and release verification
- **Status:** pending

### Phase 5: Review, integration, and report
- [ ] Review public API/docs and performance/reliability concurrency behavior
- [ ] Apply one consolidated finding batch and affected re-review
- [ ] Push checkpoints, final branch, and verified main
- [ ] Deliver the requested detailed systematic report
- **Status:** pending

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Do not lengthen the five-minute value | That hides the defect and creates another arbitrary lifetime. |
| Keep normal Cancel semantics | Explicit close/replacement cleanup is necessary; periodic fake-session churn is not. |
| Preserve authenticated-session expiry | The defect is the public demo manufacturing a session, not authenticated expiry itself. |

## Errors Encountered
| Error | Resolution |
|-------|------------|
| Root-level inline reproduction could not resolve workspace dependencies | Re-ran from `packages/server`, whose package-local dependency graph resolved correctly. |
| First server import used the wrong generated path | Located and imported `packages/server/dist/server/durable-subscription-bindings.js`. |
