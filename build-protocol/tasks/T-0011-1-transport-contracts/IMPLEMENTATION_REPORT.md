# Implementation Report: T-0011.1 Transport Contracts, Topics, And Envelope Routing Keys

Status: Complete
Task log: `build-protocol/tasks/T-0011-1-transport-contracts/TASK.md`
Work log: `build-protocol/work-logs/T-0011-1.md`
Review log: `build-protocol/reviews/T-0011-1-transport-contracts.md`
Branch: `task/T-0011-1-transport-contracts`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0011-1-transport-contracts`

## Summary

T-0011.1 starts from parent T-0011 commit `7b54d6c`. It is the first
transport implementation slice and must remain adapter-agnostic. It should
replace the `@spine-ts/transport` skeleton export with focused transport
contracts, tests, docs, and API export checks, without adding ZeroMQ or runtime
behavior.

## Implemented Surface

Implemented in this branch:

- immutable `TransportTopic` values created by `createTransportTopic()` from
  `signalKind`, payload `messageTypeUrl`, and optional semantic tags;
- immutable `TransportSubscription` descriptors created by
  `createTransportSubscription()` from a topic, logical `subscriberId`, and a
  delivery mode;
- deterministic transport-owned routing keys derived from signal kind, type
  URL, and sorted unique semantic tags;
- publish/request operation contracts, handler callback types,
  `TransportSubscriptionHandle`, `SignalTransport`, and `AsyncCloseable`; and
- package/API/architecture docs plus TypeDoc export checks updated for the new
  public surface.

Still deferred:

- ZeroMQ installation and adapter wiring;
- socket types, broker endpoints, multipart frames, or worker registration;
- request routing policy beyond the contract seam;
- durable delivery, retries, storage coupling, or handler invocation/runtime
  execution.

## Expected Files

Likely changed files:

- `packages/transport/src/index.ts`
- `packages/transport/src/index.test.ts`
- `packages/transport/README.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `scripts/check-api-docs.mjs`
- this task/report/work/review log set
- parent T-0011 logs as needed

## Verification

Setup verification is complete. The fresh worktree required
`corepack pnpm install --frozen-lockfile`; the sandboxed install hit npm
registry `ENOTFOUND`, and the escalated frozen install passed with the lockfile
unchanged.

Setup baseline verification passed on `2026-06-30 20:48 WEST`:
`CI=true corepack pnpm verify` passed with 21 test files / 258 tests, coverage
96.45% statements / 90.55% branches / 99.24% functions / 96.39% lines,
TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage expected
exports, copied Spine proto checksum verification, generated proto output
clean, and generated files clean.

Implementation verification passed on `2026-06-30 20:58 WEST`:

- `corepack pnpm vitest run packages/transport/src/index.test.ts` passed with 1
  file / 4 tests.
- `corepack pnpm typecheck` passed.
- `corepack pnpm docs:check` passed. TypeDoc reported the existing warning that
  the local `origin` remote is not valid for source links; no doc/API errors
  occurred.
- `CI=true corepack pnpm verify` passed with 21 test files / 261 tests,
  coverage 96.37% statements / 90.39% branches / 99.26% functions / 96.31%
  lines, plus proto lint/generate/generated-clean checks.
- `git diff --check` passed.

## Open Items

- Parent T-0011 integration pending.

## Review Fix Round

Reviewer findings accepted for this round:

- `RequestTransportOperation` exposed `responseTopic` too early for this first
  contract slice and needed that reply-route policy removed.
- `createTransportTopic()` and `createTransportSubscription()` trusted compile-time
  union types and needed runtime rejection for unknown signal kinds or modes.
- `messageTypeUrl` validation needed a small canonical format guard beyond
  blank-string rejection.
- semantic-tag sorting used default-locale `localeCompare()` and needed
  deterministic locale-independent ordering for routing keys.
- `docs/api/README.md` needed `TransportSemanticTag` added to the transport
  export summary.

Fresh verification passed on `2026-06-30 21:11 WEST`:

- `corepack pnpm vitest run packages/transport/src/index.test.ts`: passed with
  1 file / 5 tests.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm docs:check`: passed with the existing TypeDoc warning that the
  local `origin` remote is not valid for source links.
- `CI=true corepack pnpm verify`: passed with 21 test files / 262 tests,
  coverage 96.49% statements / 90.72% branches / 99.26% functions / 96.44%
  lines, TypeDoc/API export checks, copied proto checksum verification, proto
  lint/generate, and generated-clean checks.
- `git diff --check`: passed.

## Security Sequencing Fix

Round 2 security review found that `createTransportSubscription()` still
normalized the topic before rejecting an invalid subscription mode. The fix
now validates the raw mode value first, before copying or normalizing the
topic input, and adds regression coverage for an invalid mode paired with a
malformed topic.

Focused verification passed on `2026-06-30 21:17 WEST`:

- `corepack pnpm vitest run packages/transport/src/index.test.ts`: passed with
  1 file / 5 tests.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm docs:check`: passed with the existing TypeDoc warning that
  the local `origin` remote is not valid for source links.
- `corepack pnpm prettier --check packages/transport/src/index.ts packages/transport/src/index.test.ts build-protocol/tasks/T-0011-1-transport-contracts/TASK.md build-protocol/tasks/T-0011-1-transport-contracts/IMPLEMENTATION_REPORT.md build-protocol/work-logs/T-0011-1.md build-protocol/reviews/T-0011-1-transport-contracts.md`:
  passed.
- `git diff --check`: passed.

Final security re-review passed on `2026-06-30 21:19 WEST`:

- Security reviewer `019f1a2f-3d51-79e2-967e-01dc736c4f74`: CLEAN.
- All required review lanes are clean.

## Final Verification

Final verification passed on `2026-06-30 21:25 WEST`:

- `CI=true corepack pnpm verify`: passed with 21 test files / 262 tests,
  coverage 96.35% statements / 90.43% branches / 99.26% functions / 96.29%
  lines, TypeDoc/API export checks, copied proto checksum verification, proto
  lint/generate, and generated-clean checks.
- TypeDoc emitted the existing invalid-`origin` warning only.
- `corepack pnpm prettier --check build-protocol/tasks/T-0011-1-transport-contracts/TASK.md build-protocol/tasks/T-0011-1-transport-contracts/IMPLEMENTATION_REPORT.md build-protocol/work-logs/T-0011-1.md build-protocol/reviews/T-0011-1-transport-contracts.md`:
  passed.
- `git diff --check`: passed.
