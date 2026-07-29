# T-0066a — Supervisor Empty-Run Coalescing

Status: Complete; committed, pushed, and represented on canonical `main`.

Baseline: `93ebf880`

Classification: high-risk production correctness correction. The change affects
distributed delivery scheduling, stale recovery, concurrency, and externally
observable shard ownership transitions.

## Confirmed RED Behavior

The T-0066 two-process topology deterministically observes, after killed-owner
stale recovery and before the next real message, an unnecessary empty-shard cycle:

```text
PICKED/0 -> NOT_PICKED/0
```

The complete Admin stream therefore emits 22 updates instead of the accepted 20.
The server publisher is correct: both frames represent successful shard pickup and
release. Diagnosis traces the redundant run to a queued/rescan
`DeliverySupervisor` path that starts after the previous recovery drain already
emptied the shard.

## Acceptance

- Coalesce or suppress only the proven redundant supervisor run so an already
  satisfied empty shard is not reacquired from stale queued/rescan work.
- Preserve at-least-once discovery: messages arriving during or after an in-flight
  run must still trigger a subsequent drain.
- Preserve per-shard single-flight, global concurrency bounds, stale-session
  recovery, remote watch restart, periodic recovery, cancellation, and close.
- Do not weaken Admin semantics or hide successful state transitions.
- Add deterministic focused RED/GREEN coverage for the exact notification/rescan
  ordering and relevant races.
- Make no public API, Protobuf, storage, threshold, exclusion, UI, Redis/Hazelcast,
  or JVM-compatibility change.
- After this correction is reviewed, verified, committed, pushed, merged, and
  post-merge verified, back-merge it into T-0066 and require the original exact
  20-frame topology assertion to pass twice.

## Human-Imposed Requirements Ledger

- Continue Wave 1 autonomously and report every agent, verification, review,
  merge, push, or blocker result immediately in feature terms.
- Preserve the in-memory simple-server-only Wave 1 scope; Redis/Hazelcast are
  excluded, JVM live compatibility is Wave 3, and UI/TUI is Wave 4.
- Use one bounded production implementation owner and one complete relevant
  review wave with one consolidated correction batch.
- Preserve unrelated dirty worktrees and never access or modify
  `human-review-1-jul.md`.
- Commit/push only after review and verification; push immediately after each
  commit and at task/main integration boundaries.

## Assignment Metadata

- Requirements analysis: existing requirements-splitter role, explicitly
  dispatched `gpt-5.6-sol` / `high`. Record actual runtime metadata or the
  immutable-profile limitation before acceptance.
- Requirements-analysis actual metadata: runtime self-introspection unavailable;
  immutable configured role/profile `gpt-5.6-sol` / `high`, both fields explicit
  in dispatch, with no visible fallback or mismatch. Result accepted.
- Implementation: existing implementer role, explicitly dispatched
  `gpt-5.6-terra` / `medium` after requirements acceptance.

## Review Concerns

- Performance/reliability: required.
- Style/maintainability: required.
- Documentation: N/A unless runtime documentation or claims change.
- TypeScript/API: N/A unless the public contract changes (not expected).
- Final security: deferred to Wave 1 closure unless a critical issue appears.

## Implementation Evidence

- Controlled runs now complete an empty immutable epoch after the existing stop
  check, producing one zero-valued `IDLE` page and `COMPLETED` without shard
  pickup, release, or `onStarted`.
- Public `Delivery.run()` retains its existing empty-shard pickup/release path.
- Focused supervisor/run-control/fencing/loop/environment coverage passed:
  5 files, 112 tests. Generated build and tooling typechecks, touched ESLint,
  Prettier, and `git diff --check` passed.
- Required review lanes: performance/reliability and style/maintainability.
  Documentation and TypeScript/API remain N/A: no public claims, exports,
  declarations, Proto, or serialized contracts changed.
- The complete review wave accepted two P1 performance/reliability findings and
  one P2 style/maintainability finding. All three are implemented in one batch;
  the two affected lanes require focused re-review.
- Correction verification passed 6 focused files / 154 tests, generated build
  and tooling typechecks, touched ESLint and Prettier, cleanup enforcement, and
  `git diff --check`.
