# Review Log: T-0011.4 Broker And Worker Lifecycle Seam

Status: Round 2 Fixes Verified; Re-review Pending

## Required Review Lanes

Every implementation subtask and docs-only subtask must complete these review
lanes before integration:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Setup Review State

T-0011.4 setup started on `2026-06-30 22:52 WEST` from verified parent commit
`4ed7db6`. Durable setup logs were created before implementation handoff.
Parent baseline verification passed on `2026-06-30 22:51 WEST` with 23 test
files / 268 tests, coverage 96.34% statements / 90.48% branches / 99.27%
functions / 96.28% lines, TypeDoc/API counts 100 / 28 / 124 / 26,
copied-proto checksum verification, proto lint/generate, generated proto
output clean, and generated files clean. TypeDoc emitted the existing
invalid-`origin` warning only. Setup baseline verification passed again in the
T-0011.4 worktree on `2026-06-30 22:55 WEST` with the same test count,
coverage, TypeDoc/API counts, proto checks, and generated-clean result.

## Current Review Gate

Round 1 review found maintainability, security, documentation, TypeScript/API
docs, and reliability issues in the transport lifecycle seam. The follow-up fix
landed and verification reran successfully, but round 2 re-review found two
remaining items: canonical-only participant inputs and dotted logical IDs. The
round 2 fix has landed and verification reran successfully; re-review remains
pending before parent integration.

## Reviewer Rounds

Verification evidence was first recorded on `2026-06-30 23:05 WEST`. Round 1
review then recorded these findings against implementation sub-agent
`019f1a89-60ac-78f2-90cc-2b0bc7e6c316`:

- Maintainability reviewer `019f1a94-75f4-7143-8bbc-1eb563411539`: collapse
  the overlapping participant input helpers onto one canonical public
  participant identity shape for lifecycle helpers.
- Documentation reviewer `019f1a94-9fed-7b22-8b62-aff40e8c9fb1`: narrow
  deferrals to supervision/topology/readiness probe/retry/dispatch/storage/
  server-wiring concerns and stop describing broker/worker lifecycle itself as
  deferred.
- TypeScript/API docs reviewer `019f1a94-c76f-7443-8237-80d78fdb4694`: add the
  new lifecycle exports to the TypeDoc/API guard and include the transport
  export count in the success summary.
- Security reviewer `019f1a94-f248-7411-bdae-704a9a3c02e9`: reject endpoint-,
  path-, host-, and PID-shaped logical IDs for `subscriberId` and
  `participantId`.
- Performance/reliability reviewer `019f1a95-1a9d-7b70-9833-3380ac9840be`:
  rebuild exported lifecycle value objects from semantic fields, sort worker
  registrations by `descriptorKey`, and require registration evidence before a
  worker snapshot can be `ready`.

Round 1 fix verification reran on `2026-06-30 23:21 WEST`:

- focused transport tests passed with 2 files / 16 tests;
- `corepack pnpm typecheck` passed;
- `corepack pnpm docs:check` passed with the existing invalid-`origin` warning
  only and now reported 31 expected `@spine-ts/transport` exports;
- `git diff --check` passed;
- sandboxed `CI=true corepack pnpm verify` failed as expected when ZeroMQ local
  IPC smoke tests hit `Operation not permitted` on `ipc://` binds; and
- native-IPC `CI=true corepack pnpm verify` passed with 23 files / 275 tests,
  coverage 96.60% statements / 91.20% branches / 99.30% functions / 96.55%
  lines, TypeDoc/API checks, proto lint/generate, and generated-clean checks.

Round 2 re-review then found two remaining issues on `2026-06-30 23:30 WEST`:

- maintainability: `TransportWorkerRegistrationInput.worker` and
  `TransportLifecycleSnapshotInput.participant` still accepted prebuilt
  participant identity shapes alongside canonical inputs; and
- security: `normalizeLogicalTransportId()` still allowed dotted
  hostname/IP-shaped logical IDs such as `broker.local`,
  `worker-01.prod`, and `127.0.0.1`.

Round 2 fixes landed in the transport package and the review evidence now
shows the canonical-only builder inputs, the tighter logical-ID format, and
the corresponding positive/negative tests. Verification reran on
`2026-06-30 23:30 WEST`:

- `corepack pnpm test packages/transport/src/index.test.ts packages/transport/src/zeromq-adapter-config.test.ts`
  passed with 2 files / 17 tests;
- `corepack pnpm typecheck` passed;
- `corepack pnpm docs:check` passed with the existing invalid-`origin`
  warning only and 31 expected `@spine-ts/transport` exports in TypeDoc JSON;
- `git diff --check` passed.
