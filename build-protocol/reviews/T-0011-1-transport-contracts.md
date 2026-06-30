# Review Log: T-0011.1 Transport Contracts, Topics, And Envelope Routing Keys

Status: Review Fixes Verified

## Required Review Lanes

Every implementation subtask and docs-only subtask must complete these review
lanes before integration:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Setup Review State

T-0011.1 setup started on `2026-06-30 20:45 WEST` from parent commit
`7b54d6c`. Durable setup logs were created before implementation handoff.
Setup baseline verification passed on `2026-06-30 20:48 WEST` with 21 test
files / 258 tests, coverage 96.45% statements / 90.55% branches / 99.24%
functions / 96.39% lines, TypeDoc/API counts 100 / 28 / 124 / 26, copied Spine
proto checksum verification, generated proto output clean, and generated files
clean.

## Current Review Gate

Setup verification passed. Implementation is complete; review lanes remain
required before integration.

## Reviewer Rounds

### Review Fix Round After Commit `28fcb8e`

Accepted findings for this patch:

1. `RequestTransportOperation` exposed `responseTopic` too early; this first
   contract slice must not define reply-route policy before a later
   request/reply adapter design.
2. `createTransportTopic()` and `createTransportSubscription()` needed runtime
   validation for `TransportSignalKind` and `TransportSubscriptionMode` so JS
   callers or `as any` casts cannot materialize frozen invalid values.
3. `messageTypeUrl` validation needed a small canonical format guard in
   addition to the existing non-blank check.
4. semantic-tag sorting used host-default `localeCompare()` semantics and
   needed deterministic locale-independent ordering for routing keys.
5. `docs/api/README.md` needed `TransportSemanticTag` added to the transport
   export summary.

Planned verification before commit:

- `corepack pnpm vitest run packages/transport/src/index.test.ts`
- `corepack pnpm typecheck`
- `corepack pnpm docs:check`
- `CI=true corepack pnpm verify`
- `git diff --check`

Verification passed on `2026-06-30 21:11 WEST`:

- `corepack pnpm vitest run packages/transport/src/index.test.ts`: passed with
  1 file / 5 tests.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm docs:check`: passed with the existing TypeDoc invalid-`origin`
  warning only.
- `CI=true corepack pnpm verify`: passed with 21 test files / 262 tests,
  coverage 96.49% statements / 90.72% branches / 99.26% functions / 96.44%
  lines, plus TypeDoc/API export checks, proto lint/generate,
  copied-proto checksum verification, and generated-clean checks.
- `git diff --check`: passed.
