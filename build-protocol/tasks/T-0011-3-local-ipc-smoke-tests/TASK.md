# T-0011.3: Local IPC Smoke Tests

Status: Implemented
Parent task: `T-0011 Transport Foundation`
Start: `2026-06-30 22:07 WEST`
Baseline commit: `08d7e82`
Task log path: `build-protocol/tasks/T-0011-3-local-ipc-smoke-tests/TASK.md`
Branch: `task/T-0011-3-local-ipc-smoke-tests`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0011-3-local-ipc-smoke-tests`
Authoring sub-agent: 019f1a60-020b-72e2-b9a4-661b1b25b57d
Reviewer sub-agents: round 1 complete; code style/maintainability `019f1a6b-a851-71d3-91d7-3899e5b86b05`, documentation `019f1a6b-a8df-77f2-80b1-a99036203f99`, TypeScript/API docs `019f1a6b-a96f-79e1-a847-2c2e49e66936`, security `019f1a6b-a9db-7d52-a7b9-4318a47d8b13`, and performance/reliability `019f1a6b-aa60-7901-a2d9-46255fecc2bf`; maintainability note logged and docs follow-up recorded

## Objective

Add focused local IPC smoke tests for the ZeroMQ transport adapter foundation.
This slice may open ZeroMQ sockets only inside tests and must prove basic
same-host publish/subscribe and request/reply behavior over local IPC endpoints
with deterministic setup and cleanup.

The task must keep ZeroMQ adapter-private and must not introduce broker
processes, worker supervision, runtime dispatch, delivery/retry semantics,
storage coupling, read-side execution, or public server/service APIs.

## Acceptance Criteria

- Local IPC smoke tests cover at least one publish/subscribe flow and one
  request/reply flow using `zeromq@6.5.0`.
- Tests use temporary same-host IPC resources and clean up sockets/endpoints
  reliably.
- Any helper code added for smoke tests stays adapter-private and does not
  export ZeroMQ sockets, endpoints, frames, or native binding types through the
  public `@spine-ts/transport` root.
- Tests are deterministic and do not require network ports, external services,
  long-lived processes, or manual machine setup beyond the pinned dependency.
- Documentation and durable logs record the local IPC smoke-test scope and
  explicitly defer broker/worker lifecycle, delivery/retry behavior, and server
  runtime wiring.
- TypeScript, lint, format, docs/API checks, proto workflow, and full
  verification remain green.

## Out Of Scope

- Production transport adapter API beyond what is needed to smoke-test local
  IPC behavior.
- Broker processes, worker registration, process supervision, readiness
  handshakes, retries, durable delivery, storage lifecycle, or runtime queues.
- Command/event/query/subscription services, repository invocation, read-side
  execution, or gRPC service wiring.
- Multi-host networking or TCP transport.

## Applicable Decisions

- D-0007: ZeroMQ is local IPC only and must remain behind an abstraction.
- D-0024: native ZeroMQ dependency installation was deferred to adapter work.
- D-0045: server-module work must inspect Spine JVM `core-jvm/server` and avoid
  over-engineering. This subtask is transport-only; if it touches
  `@spine-ts/server`, it must first inspect the corresponding JVM server code
  and record that evidence.
- D-0054: T-0011 starts adapter-agnostic, then pins `zeromq@6`; T-0011.3 owns
  local IPC smoke tests, not broker/runtime behavior.

## Skill Applicability

Canonical checklist: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Selected skills for this subtask:

- `subagent-driven-development`: required orchestrator/worker/reviewer
  workflow.
- `using-git-worktrees`: isolated subtask worktree created.
- `verification-before-completion`: required before task completion.
- `requesting-code-review` and `code-review-excellence`: required review loop.
- `nodejs-backend-patterns`: applicable to socket lifecycle and cleanup
  boundaries.
- `javascript-testing-patterns`: applicable for deterministic Vitest smoke
  tests and resource cleanup.
- `typescript-advanced-types`: applicable if adapter-private typed helpers are
  extended.

Skipped relevant-looking skills:

- `security-threat-model`: not explicitly requested; the required security
  reviewer will inspect IPC/supply-chain risks.
- `event-store-design`, `projection-patterns`, and `saga-orchestration`: later
  delivery/read-side/runtime concerns, out of scope here.

## Verification

- Setup dependency install passed on `2026-06-30 22:08 WEST`:
  `corepack pnpm install --frozen-lockfile` passed with the lockfile unchanged,
  reused cached packages, installed 197 workspace packages, and ran the
  approved `zeromq@6.5.0` install script.
- Setup baseline verification passed on `2026-06-30 22:10 WEST`:
  `CI=true corepack pnpm verify` passed with 22 test files / 266 tests,
  coverage 96.34% statements / 90.48% branches / 99.27% functions / 96.28%
  lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage
  expected exports, copied Spine proto checksum verification, proto
  lint/generate, generated proto output clean, and generated files clean.
  TypeDoc emitted the existing invalid-`origin` warning only.

- Implementation focused verification passed on `2026-06-30 22:17 WEST`:
  `corepack pnpm vitest run packages/transport/src/zeromq-local-ipc-smoke.test.ts`
  passed with 1 test file / 2 tests, covering same-host ZeroMQ
  publish/subscribe and request/reply IPC over temporary endpoints.

- Implementation type/API verification passed on `2026-06-30 22:18 WEST`:
  `corepack pnpm typecheck` passed, and `corepack pnpm docs:check` passed with
  the existing invalid-`origin` TypeDoc warning only.

- Implementation full verification passed on `2026-06-30 22:21 WEST`:
  `CI=true corepack pnpm verify` passed with 23 test files / 268 tests,
  coverage 96.34% statements / 90.48% branches / 99.27% functions / 96.28%
  lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage
  expected exports, copied Spine proto checksum verification, proto
  lint/generate, generated proto output clean, and generated files clean.
  TypeDoc emitted the existing invalid-`origin` warning only.

- Implementation whitespace verification passed on `2026-06-30 22:21 WEST`:
  `git diff --check` passed.

## Implementation Notes

- Added adapter-private `zeromq@6.5.0` smoke tests under
  `packages/transport/src` for one publish/subscribe flow and one request/reply
  flow. The tests open ZeroMQ sockets only inside test bodies, use `linger: 0`,
  set bounded send/receive timeouts, and close sockets plus remove temporary
  IPC directories in `finally` paths.
- Temporary IPC endpoints use short `mkdtemp(tmpdir(), "sz-")` directories and
  short socket file names to avoid Unix-domain socket path-length limits.
- The smoke tests import `zeromq` directly from package-private test code and do
  not change the public `@spine-ts/transport` root exports.
- No `@spine-ts/server` files were touched.
