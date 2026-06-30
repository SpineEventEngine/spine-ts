# T-0011.2: ZeroMQ Adapter Package Wiring And Dependency Pin

Status: Implemented - Verification Passed
Parent task: `T-0011 Transport Foundation`
Start: `2026-06-30 21:32 WEST`
Baseline commit: `54d7ba0`
Task log path: `build-protocol/tasks/T-0011-2-zmq-adapter-package-wiring/TASK.md`
Branch: `task/T-0011-2-zmq-adapter-package-wiring`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0011-2-zmq-adapter-package-wiring`
Authoring sub-agent: Codex implementation sub-agent
Reviewer sub-agents: pending

## Objective

Install and pin the maintained ZeroMQ Node binding line for the transport
adapter work, and add the smallest adapter-private package wiring needed for
later IPC smoke tests. This slice must keep ZeroMQ hidden behind
`@spine-ts/transport` internals and must not expose sockets, endpoints,
multipart frames, or native binding types through the public transport
contracts introduced by T-0011.1.

## Acceptance Criteria

- The workspace pins the maintained official `zeromq` package line chosen by
  D-0054, using the current package manager and lockfile.
- ZeroMQ appears only as transport-package implementation wiring or
  adapter-private configuration; public transport contracts remain
  adapter-agnostic.
- Native/runtime constraints for local IPC ZeroMQ usage are documented in the
  transport package docs and relevant architecture/API docs.
- Tests cover any new adapter-private configuration/type helpers without
  opening sockets or requiring live IPC.
- TypeScript, lint, format, docs/API checks, proto workflow, and full
  verification remain green.

## Out Of Scope

- Opening ZeroMQ sockets or binding/connecting IPC endpoints.
- Publish/subscribe or request/reply smoke tests.
- Multipart frame formats, broker processes, worker registration, process
  supervision, readiness handshakes, retries, or durable delivery.
- Server/runtime dispatch, repository invocation, read-side execution, or gRPC
  service wiring.

## Applicable Decisions

- D-0007: ZeroMQ is local IPC only and must remain behind an abstraction.
- D-0024: native ZeroMQ installation is owned by a transport-adapter task.
- D-0045: server-module work must inspect Spine JVM `core-jvm/server` and avoid
  over-engineering. This subtask is transport-only; if it touches
  `@spine-ts/server`, it must first inspect the corresponding JVM server code
  and record that evidence.
- D-0054: T-0011 starts adapter-agnostic, then pins the official `zeromq@6`
  package line in this adapter wiring subtask.

## Skill Applicability

Canonical checklist: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Selected skills for this subtask:

- `subagent-driven-development`: required orchestrator/worker/reviewer
  workflow.
- `using-git-worktrees`: isolated subtask worktree created.
- `verification-before-completion`: required before task completion.
- `requesting-code-review` and `code-review-excellence`: required review loop.
- `nodejs-backend-patterns`: applicable to native dependency/runtime
  constraints and adapter lifecycle boundaries.
- `typescript-advanced-types`: applicable if adapter-private configuration
  types are introduced.
- `javascript-testing-patterns`: applicable for dependency/configuration tests
  without live IPC.

Skipped relevant-looking skills:

- `security-threat-model`: not explicitly requested; the required security
  reviewer will inspect dependency and native-binding risk.
- `event-store-design`, `projection-patterns`, and `saga-orchestration`: later
  delivery/read-side/runtime concerns, out of scope here.

## Verification

- Implementation dependency pin on `2026-06-30 21:39 WEST`:
  `corepack pnpm --filter @spine-ts/transport add zeromq@6.5.0 --save-exact`
  updated `packages/transport/package.json` and `pnpm-lock.yaml` with exact
  `zeromq@6.5.0`, plus transitive `cmake-ts@1.0.2` and
  `node-addon-api@8.9.0`. The first install attempt stopped at pnpm's
  build-script approval gate for `zeromq@6.5.0`; the implementation recorded
  explicit `zeromq` approval in `pnpm-workspace.yaml`.
- Dependency install verification on `2026-06-30 21:39 WEST`:
  `corepack pnpm install --frozen-lockfile` passed after approval, confirmed
  the lockfile was up to date, and ran the `zeromq@6.5.0` install script.
- Focused transport tests on `2026-06-30 21:39 WEST`:
  `corepack pnpm vitest run packages/transport/src/index.test.ts
packages/transport/src/zeromq-adapter-config.test.ts` passed with 2 test
  files and 9 tests.
- TypeScript verification on `2026-06-30 21:40 WEST`:
  `corepack pnpm typecheck` passed (`tsc -b` and tooling typecheck).
- API docs verification on `2026-06-30 21:40 WEST`:
  `corepack pnpm docs:check` passed. TypeDoc emitted only the existing
  invalid-`origin` warning and the API checker preserved the expected public
  export counts.
- Full verification attempts on `2026-06-30 21:42-21:43 WEST`:
  `CI=true corepack pnpm verify` first failed at lint for a deprecated
  `expectTypeOf(...).toMatchTypeOf()` matcher and a rejected control-character
  regular expression, then failed at lint for string spreading in the
  replacement control-character scanner, then failed at format check for the
  new helper and durable log markdown. The implementation replaced the matcher
  with `toExtend()`, replaced the scanner with an indexed `charCodeAt()` loop,
  and formatted the flagged files with Prettier.
- Final focused verification on `2026-06-30 21:44 WEST`:
  `corepack pnpm vitest run packages/transport/src/index.test.ts
packages/transport/src/zeromq-adapter-config.test.ts` passed with 2 test
  files and 9 tests after the lint/format fixes.
- Final TypeScript verification on `2026-06-30 21:44 WEST`:
  `corepack pnpm typecheck` passed after the lint/format fixes.
- Final API docs verification on `2026-06-30 21:44 WEST`:
  `corepack pnpm docs:check` passed with only the existing invalid-`origin`
  TypeDoc warning.
- Full verification on `2026-06-30 21:47 WEST`:
  `CI=true corepack pnpm verify` passed with 22 test files / 266 tests,
  coverage 96.34% statements / 90.48% branches / 99.27% functions / 96.28%
  lines, TypeDoc/API checks, copied Spine proto checksum verification, proto
  lint/generate, generated proto output clean, and generated files clean.
  TypeDoc emitted the existing invalid-`origin` warning only.
- Whitespace verification on `2026-06-30 21:47 WEST`:
  `git diff --check` passed.

- Setup dependency install passed on `2026-06-30 21:33 WEST`:
  `corepack pnpm install --frozen-lockfile` passed with the lockfile unchanged,
  reused cached packages, and installed 194 workspace packages.
- Setup baseline verification passed on `2026-06-30 21:34 WEST`:
  `CI=true corepack pnpm verify` passed with 21 test files / 262 tests,
  coverage 96.35% statements / 90.43% branches / 99.26% functions / 96.29%
  lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage
  expected exports, copied Spine proto checksum verification, proto
  lint/generate, generated proto output clean, and generated files clean.
  TypeDoc emitted the existing invalid-`origin` warning only.

## Implementation Notes

- Pinned the maintained official ZeroMQ package line selected by D-0054 as an
  exact `@spine-ts/transport` dependency: `zeromq@6.5.0`.
- Added explicit pnpm native build approval for `zeromq`, matching the existing
  workspace policy pattern for approved native/postinstall dependencies.
- Added adapter-private ZeroMQ local IPC configuration helpers in
  `packages/transport/src/zeromq-adapter-config.ts`. The helper validates an
  absolute local IPC directory, normalizes a logical adapter identity, records
  local-IPC scope, and type-checks the native module via a type-only import.
- Kept the public transport root unchanged. `packages/transport/src/index.ts`,
  `SignalTransport`, topic/subscription contracts, and public API docs do not
  expose ZeroMQ sockets, endpoints, multipart frames, or native binding types.
- Documented local IPC/native runtime constraints in the transport README,
  architecture notes, and API notes without promoting ZeroMQ to a public
  contract.
- Did not touch `@spine-ts/server`.
