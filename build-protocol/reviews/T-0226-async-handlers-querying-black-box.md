# T-0226 Async Handlers, Process Manager Queries, And BlackBox Signals Review

Task: `build-protocol/tasks/T-0226-async-handlers-querying-black-box/TASK.md`
Branch: `feature/async-handlers-querying-black-box`
Baseline: `437cafcf380da33222d852f86a802200ef5ddc41`
Implementation checkpoint: `b3f56720e`
Diff basis: `git diff origin/master...b3f56720e`
Worktree: `.worktrees/t-0226`

## Pre-review state

- Worktree is clean after restoring baseline-only generated IDs.
- `git diff --check origin/master...HEAD` passes.
- Focused implementation evidence is recorded in the task work log.
- The human-imposed requirements ledger is frozen in the task brief.
- The complete affected-scope preflight passed: generated builds, strict
  TypeScript, repository policy, TSDoc, copyright, formatting, docs/TypeDoc,
  Proto, dependency/readiness checks, and 490 focused tests.

## Review assignments

| Concern                        | Existing role                      | Explicit profile        | Status                                    |
| ------------------------------ | ---------------------------------- | ----------------------- | ----------------------------------------- |
| Code style and maintainability | `style_maintainability_reviewer`   | `gpt-5.6-terra` / high  | `/root/t0226_style_review` complete       |
| TypeScript/API documentation   | `typescript_api_docs_reviewer`     | `gpt-5.6-terra` / high  | `/root/t0226_api_review` complete         |
| Performance and reliability    | `performance_reliability_reviewer` | `gpt-5.6-terra` / high  | `/root/t0226_reliability_review` complete |
| Reader documentation           | `documentation_reviewer`           | `gpt-5.6-luna` / medium | `/root/t0226_docs_review` active          |
| Security and tenant boundary   | `security_reviewer`                | `gpt-5.6-terra` / high  | `/root/t0226_security_review` active      |

Every reviewer is read-only, may not spawn subagents, and must inspect the
human-imposed requirements ledger. The Desktop surface does not expose separate
live self-introspection; the immutable role profile and explicit dispatch are
the available runtime metadata.

## Canonical dispositions

- Code style/maintainability: pending.
- Documentation completeness: pending.
- TypeScript/API docs: pending.
- Performance/reliability: pending.
- Security: pending because tenant-bound reads and external-event intake cross
  authorization/trust semantics.

## Findings and author response

The first three lanes are complete. Preliminary findings are held without fixes
until documentation and security complete:

- P1: restore BlackBox lifecycle-test construction after observation became
  mandatory.
- P1: verify Promise symbol provenance so shadowed/imported arbitrary types are
  not treated as the built-in Promise.
- P1: exclude rollback-path rejection Events from committed BlackBox history.
- P1: preserve core query predicate, mask, ordering, and registered-column type
  constraints through the Process Manager facade.
- P1: share cycle, depth, and node-count guards with query plan compilation.
- P2: keep the generator-only columns helper out of the core root API.
- P2: add beginner package documentation for the new APIs.
- P2: move canonical query behavior tests to the core package, leaving
  client-node compatibility tests in client-node.

Documentation and security findings remain pending. No fixes begin from this
partial wave.
