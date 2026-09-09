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
| Reader documentation           | `documentation_reviewer`           | `gpt-5.6-luna` / medium | `/root/t0226_docs_review` complete        |
| Security and tenant boundary   | `security_reviewer`                | `gpt-5.6-terra` / high  | `/root/t0226_security_review` complete    |

Every reviewer is read-only, may not spawn subagents, and must inspect the
human-imposed requirements ledger. The Desktop surface does not expose separate
live self-introspection; the immutable role profile and explicit dispatch are
the available runtime metadata.

## Canonical dispositions

- Code style/maintainability: findings; two P1 and one P2.
- Documentation completeness: findings; two P1 and two P2.
- TypeScript/API docs: findings; one P1 and two P2, with documentation overlap.
- Performance/reliability: findings; three P1.
- Security: findings; one P1 duplicated with reliability. Tenant,
  external-event, deserialization, logging, dependency, and secret checks are
  otherwise clean.

## Findings and author response

The complete five-lane wave is accepted as one deduplicated correction batch:

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
- P1: add beginner async-handler and Process Manager query workflows to the
  main user guide and server README, including transaction duration/rejection,
  eventual consistency, Aggregate exclusion, and the 1,000-result bound.
- P1: add the BlackBox external-event and produced-snapshot workflow to the
  testing README, including included/excluded signals and call-time timing.
- P2: add the typed query example, result ceiling, and `all()` cost warning to
  the server reference; update the core entrypoint inventory and compatibility
  forwarding explanation after the generator-only export is corrected.

All findings are task-scope and accepted. No P0 was reported. The duplicated
typed-query and shadowed-Promise findings are fixed once each. The existing
implementation owner receives this whole batch; re-review is limited to
substantively affected concerns after focused mechanical evidence is clean.

The first correction checkpoint `45b57685f` closes the BlackBox lifecycle-test
P1 with a testing-only no-op observation handle and 3/3 focused tests. The
owner's execution window then ended cleanly. A fresh existing `implementer`
continues the remaining frozen batch with explicit `gpt-5.6-terra` / medium
profile, no subagents, and no overlapping production writer.

## Author correction response

- Promise provenance: resolved by checking the TypeScript type symbol's
  standard-library declaration, preserving aliases while rejecting local and
  imported lookalikes; focused analyzer regression passed.
- Query bounds and facade types: resolved by making `buildPlan()` validate via
  the existing iterative traversal and forwarding builder argument constraints
  without `as never`; focused query regression and affected builds passed.
- Produced-event capture: rejection dispatch now has an explicit publisher
  path that bypasses produced-event observers; focused publisher regression
  passed. A BlackBox end-to-end rejection fixture remains for re-review.
- Generator containment, canonical test relocation, and reference/prose
  corrections are implemented where applicable; focused package builds passed.
