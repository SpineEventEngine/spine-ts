# T-0214 evidence

## Baseline

- Baseline: `origin/main@8c878f0428d1b9ea959b47bf4b2155f4993a092d`.
- Frozen installs passed in four worktrees.
- Generated build setup passed after fresh Proto generation.
- Focused unchanged baselines: auth subscriptions 56/56; To-Do 83/83; Message
  Board app/model/UI 131/131.

## Remaining before closure

- Integrated release verification and the final documented Message Board
  process left running for human testing.

## Framework subscription lifetime

- Pushed implementation commits: `ef71612d`, `c8912a19`, and `e0d2f03d`.
- RED proved an active stream crossed the finite-operation timeout; a second RED
  proved cancellation could occur synchronously before callback return.
- Final `verify:task` passed 58/58 focused tests with 90.19% branch coverage for
  `packages/auth/src/subscriptions/index.ts`.
- Final style and performance/reliability re-reviews passed. TypeScript/API-doc
  and prose-documentation concerns are N/A because no public declaration,
  export, TSDoc, or documentation contract changed.

## To-Do example

- Final branch: `codex/second-correction-todo@c9140386`, pushed and clean.
- Scoped verifier: 112 tests; 90.15% statements, 93.15% branches, 100% functions,
  and 99.12% lines.
- Both README launchers became ready, passed smoke, handled Ctrl-C, and left no
  owned process or container. The versioned Datastore image contract passed
  16/16 after the final documentation correction.

## Message Board example and Delivery observation

- Final branch: `codex/second-correction-message-board@7aa6a45d`, pushed and
  clean.
- Canonical scoped verifier: 118 tests; 96.83% statements, 92.35% branches,
  97.29% functions, and 97.86% lines. Node, Proto, generated build, tooling,
  cleanup, TSDoc, copyright, logging, formatting, documentation, API, Buf,
  generated-clean, and release-readiness gates passed.
- Local shared multi-process browser acceptance: two tabs, eight alternating
  posts, a wait beyond 36 seconds, and a final post all remained live; no 401,
  404, or console error. Direct Ctrl-C left no launcher-owned process,
  container, or listener.
- Single-process two-tab acceptance passed in 37.7 seconds. Combined and
  standalone Compose lifecycle passed 3/3 in 48.24 seconds. Distributed
  two-node Compose lifecycle passed 1/1 in 23.75 seconds. Every fixture removed
  its owned containers and network.
- Final documentation, style/maintainability, TypeScript/API-doc,
  performance/reliability, and security reviews passed after their accepted
  corrections. Runtime reviewer telemetry was unavailable; immutable configured
  roles/profiles are the recorded provenance.
