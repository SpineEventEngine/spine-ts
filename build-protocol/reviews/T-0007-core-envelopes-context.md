# Review Log: T-0007 Core Envelopes And Context

Task log: `build-protocol/tasks/T-0007-core-envelopes-context/TASK.md`
Work log: `build-protocol/work-logs/T-0007.md`
Branch: `task/T-0007a-core-signal-proto-intake`
Setup baseline commit: `f380744`
Implementation baseline commit: `9d35f3e`
Reviewed commit/diff basis: Pending final implementation commit
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0007a-core-signal-proto-intake`
Reviewer sub-agents: Standards reviewer via standalone Codex; spec review completed locally after sandbox escalation was rejected.
Status: Round 1 complete; no findings

## Reviewer IDs

- Standards reviewer: standalone Codex CLI review of staged diff.
- Spec reviewer: local implementation-agent review of staged diff after
  escalated standalone spec review was rejected by sandbox policy.

## Round 1

## Standards

No findings. The standalone reviewer checked the staged diff against
`build-protocol/PROTOBUF_CONTRACT.md` and package export conventions. The proto
copies are manifest-pinned, generated output remains isolated, `@spine-ts/proto`
uses curated root aliases instead of broad generated re-exports, and package
`exports` stay root-only.

## Spec

No findings. Local review checked the staged diff against the T-0007a task/work
logs, D-0030/D-0031, and `PROTOBUF_CONTRACT.md`. The staged implementation
copies the requested minimal transitive proto closure, records provenance and
checksums, regenerates Protobuf-ES output, exposes curated proto exports,
registers the core signal schemas, updates API-doc checks/docs/logs, and keeps
high-level pack/factory APIs, buses, storage, gRPC, and ZeroMQ out of scope.

The attempted standalone external spec review was not run after sandbox
escalation was rejected because it would send private staged repository content
to an external Codex service. The safer local review above was used instead.

## Verification

- Focused red evidence: `corepack pnpm vitest run packages/proto/src/index.test.ts packages/core/src/index.test.ts`
  failed before implementation on the missing 16-file manifest, missing core
  signal exports/descriptors, and missing registry entries; `corepack pnpm
typecheck` failed on missing `@spine-ts/proto` exports.
- Focused green evidence: the same Vitest command passed 2 files / 25 tests, and
  `corepack pnpm typecheck` passed.
- Proto workflow evidence: `corepack pnpm proto:verify`, `corepack pnpm
proto:lint`, `corepack pnpm proto:generate`, and generated-output cleanliness
  passed as part of full verification.
- Full verification: `CI=true corepack pnpm verify` passed typecheck, lint,
  format, 9 Vitest files / 35 tests, coverage, docs/API check with 85
  `@spine-ts/proto` exports and 21 `@spine-ts/core` exports, proto lint/generate,
  and generated-output cleanliness.

## Closure

Round 1 closed with no findings. Remaining risk is limited to the recorded
D-0031 provenance decision for legacy `spine/net/*` and `spine/ui/language.proto`
support protos; no blocking risk remains for T-0007a.
