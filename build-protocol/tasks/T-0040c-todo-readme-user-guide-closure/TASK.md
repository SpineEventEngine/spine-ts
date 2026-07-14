# T-0040c: To-Do README And User Guide Closure

Status: In progress - specialist findings accepted; fix wave pending

Started: `2026-07-14`

Baseline commit: `526b7b4d`

Branch: `task/T-0040c-todo-readme-user-guide-closure`

Worktree: `.worktrees/T-0040c-todo-readme-user-guide-closure`

Dependency: T-0040b is complete, integrated, post-merge verified, remotely
synchronized, and cleaned up.

## Objective

Make the to-do example independently runnable and accurately document its
supported single-process server workflow, public generated-client usage, and
bounded local multi-process demonstration.

## Human-Imposed Requirements Ledger

- Continue autonomously until project completion or a real protocol blocker.
- Keep this slice to the example README, example user guide, and the smallest
  documentation-owned command or smoke fixture needed to make documented
  workflows executable. T-0041 owns the final project-wide security review.
- Preserve accepted DDD, Spine Protobuf/type-URL, public API, generated-output,
  testing, review, logging, worktree, remote-push, and cleanup requirements.
- The README must concisely cover prerequisites, generation/build, server start,
  a real generated-client smoke workflow, focused tests, demonstrated features,
  and explicit non-production limitations.
- The user guide must accurately cover command variants, queries,
  subscriptions, validation/refusal, generated registry behavior,
  lifecycle/shutdown, local multi-process test/mode, and framework-guide links.
- Run every documented command from a clean generated state. Execute the client
  smoke against a real loopback server and verify documented paths/imports.
- Use only supported public package imports in user-facing code. Do not expose
  package source internals or framework-owned envelopes/transactions/lifecycle
  internals to make documentation work.
- Do not claim production supervision, persistence, authentication, remote-host
  topology, retry backoff, monitor/scheduler actions, catch-up worker support,
  or adapter policy beyond the accepted initial release.
- Keep generated Protobuf and handler-registry output ignored and untracked.
- Use focused verification during edits and reserve full `pnpm verify` for the
  final task and post-merge gates.
- Dispatch every child with its existing role and explicit model/reasoning,
  record immutable runtime metadata, prohibit child subagents, and close each
  child promptly.
- Record a clean or concrete N/A disposition for style/maintainability,
  documentation, TypeScript/API docs, and performance/reliability. Security is
  deferred to T-0041.
- Push the completed task branch and verified `main` to `origin`, record remote
  refs, and remove only the clean merged worktree.
- Never read, edit, stage, delete, move, or use `human-review-1-jul.md`.

## Acceptance Criteria

- A reader can install prerequisites, generate/build the example, start it, run
  the documented generated-client smoke, and stop it using exact commands.
- README commands and paths match repository scripts and the moved
  `examples/todo/test/black-box.test.ts` location.
- User-guide command, query, subscription, validation/refusal, registry,
  lifecycle, and local multi-process examples match the real public API.
- The smoke runs against a real ephemeral or documented loopback server and
  demonstrates successful command acknowledgement plus eventual query state.
- Every documented command is executed from a clean generated state; links and
  imports are checked; generated output remains ignored/untracked.
- Non-production limitations are explicit without promising future policy.
- Relevant reviewer concerns are clean, full task `verify` passes with at least
  90% branch coverage, post-merge `verify` passes, and remote closure succeeds.

## Scope

- Expected writes: `examples/todo/README.md`, `examples/todo/USER_GUIDE.md`,
  minimal example documentation/smoke support only when an executable command
  cannot otherwise be documented, and T-0040c durable records.
- Prefer existing scripts, generated clients, and acceptance fixtures over new
  infrastructure.

## Out Of Scope

- Framework runtime/public API changes, new transports/storage, deployment,
  production supervision, authentication, observability, or security review.
- Repeating T-0040b behavior tests or changing accepted example domain behavior.

## Risks And Guardrails

- Code snippets that compile visually but cannot run are defects; execute the
  documented commands and smoke exactly as written.
- Do not make a temporary generated path or private import part of the public
  workflow.
- Keep startup/shutdown instructions deterministic and bounded; no orphaned
  listener, HTTP/2 session, child, or ZeroMQ endpoint may remain after smoke.
- No requirements splitter is assigned: this task documents stable behavior and
  changes no architecture, domain semantics, public/serialized contract,
  transaction, concurrency, or idempotency rule. A proven missing mandatory
  public seam is a separate escalation, not a documentation workaround.

## Skill Applicability

- Use the session inventory, `build-protocol/skills/EXPECTED_SKILLS.md`, readable
  installed entrypoints/lock metadata, `subagent-driven-development`,
  `requesting-code-review`, `verification-before-completion`, and
  `using-git-worktrees`.
- `doc-coauthoring` is applicable for reader-centered documentation structure;
  `nodejs-backend-patterns` and `javascript-testing-patterns` apply to executable
  smoke/lifecycle verification. Architecture and API-design skills are N/A
  unless investigation proves a real contract gap.

## Investigation Findings

- `examples/todo/README.md`, `examples/todo/USER_GUIDE.md`, and root `README.md`
  still document deleted `examples/todo/src/index.test.ts`. Because the command
  uses `--passWithNoTests`, it can return success while exercising nothing.
- The example README embeds a long inline smoke program. It does not explicitly
  own an `Http2SessionManager`, making exact command completion less reliable
  and harder to keep synchronized with tested code.
- No package `smoke` script exists. Add one small checked-in public-client
  program under `examples/todo/scripts/` and expose it through the private
  example package. It should post one generated `CreateTask`, check the OK Ack,
  poll `QueryService` with bounded per-call/overall deadlines, print the
  observed row, and abort its explicit HTTP/2 session in `finally`.
- The user guide covers basic build/server/command/query/subscription flow but
  lacks column-query detail, deterministic subscription cleanup, generated
  registry failure/recovery guidance, lifecycle boundaries, local
  multi-process proof, framework links, and a consolidated limitations section.
- The accepted local multi-process mode is a focused test fixture, not a public
  process-supervision CLI. Document the exact native Vitest command and its
  child/ZeroMQ/listener/IPC cleanup guarantees without presenting it as
  production topology.

## Implementation Assignment

- Existing `implementer`, expected explicit `gpt-5.6-terra` / medium, one write
  owner, no subagents or Git mutation.
- Ownership: `examples/todo/README.md`, `examples/todo/USER_GUIDE.md`,
  `examples/todo/package.json`, a minimal `examples/todo/scripts/smoke.mjs`, the
  stale root README command/link context, and T-0040c task/work evidence.
- RED evidence before edits: the package `smoke` script is absent and every
  documented `examples/todo/src/index.test.ts` path is stale. GREEN requires the
  exact documented build/start/smoke/test commands to execute.
- Keep README concise. Put detailed command variants, exact all/ID/column query
  shapes, subscription cancellation/session ownership, registry behavior,
  lifecycle, local multi-process proof, links, and limitations in the guide.
- The smoke must use public dependencies only, sanitize/bound diagnostics, own
  every timer/session, and avoid subscriptions so command/query smoke remains
  deterministic; T-0040b provides the real subscription acceptance proof.
- Do not change framework/example domain runtime, dependencies, build config, or
  review log. Return a blocker before broadening this scope.

## 2026-07-14 - Implementer RED Evidence

- Before documentation or smoke edits,
  `pnpm --config.verify-deps-before-run=false --filter @spine-ts/example-todo smoke`
  exited 1 with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`: the package had no `smoke`
  script.
- The public-doc path scan found stale
  `examples/todo/src/index.test.ts` references in root `README.md`, example
  `README.md`, and example `USER_GUIDE.md`. The latter two were runnable-facing
  instructions; the task/work records retain historical evidence only.

## 2026-07-14 - Implementer GREEN Evidence

- Added the private example `smoke` script and checked-in public-client program.
  It imports public packages and compiled example schemas only, owns an explicit
  `Http2SessionManager`, posts one generated `CreateTask`, requires an OK Ack,
  polls the exact `TaskList` row to a five-second deadline with finite
  diagnostics, and calls `session.abort()` in `finally`. It intentionally has
  no subscription.
- From a clean generated state, `pnpm --config.verify-deps-before-run=false
typecheck:build` passed. The final native terminal-one/terminal-two workflow
  passed exactly with `pnpm --config.verify-deps-before-run=false --filter
@spine-ts/example-todo start` and `pnpm --config.verify-deps-before-run=false
--filter @spine-ts/example-todo smoke`; smoke printed `to-do smoke ok` with
  its generated task ID and title. The server was stopped with `SIGINT`.
- The sandboxed start and black-box runs reproduced the expected
  `listen EPERM` on `127.0.0.1`; the sandboxed local-multi-process test
  reproduced local IPC `Operation not permitted`. Approved native reruns passed
  `black-box.test.ts` (26/26) and `local-multi-process.test.ts` (19/19).
- A final IPv4 listener check for `127.0.0.1:8080` returned no listener after
  shutdown. Existing unrelated IPv6 port-8080 processes were separately
  identified outside this worktree and were not changed.
- Focused ESLint, Prettier on every owned file, `docs:check`, generated-clean,
  Markdown-link/path/import scans, and `git diff --check` passed. Generated
  artifacts were freshly regenerated, ignored, and untracked. Full `pnpm
verify` remains the coordinator gate.

## 2026-07-14 - Coordinator Pre-Review Verification

- Re-ran every documented reader command from the task worktree. `pnpm
  install` reported all eight workspace projects already up to date;
  `pnpm typecheck:build` passed; the exact terminal-one server and terminal-two
  smoke workflow passed against `127.0.0.1:8080`; and the server left no IPv4
  listener after `SIGINT`.
- The exact focused commands passed independently:
  `examples/todo/test/black-box.test.ts` ran 26/26 tests and
  `examples/todo/test/local-multi-process.test.ts` ran 19/19 tests.
- `typecheck:tooling`, `lint`, `format:check`, `docs:check`,
  `proto:check-generated`, `git diff --check`, Markdown-link resolution, stale
  public-path/policy scans, and tracked-generated-output scans passed. TypeDoc
  reported the expected 372 curated package exports.
- The pre-review diff remains inside the documented scope: root/example
  documentation, the private example package script, one bounded smoke program,
  and durable T-0040c records. No dependency, lockfile, framework runtime,
  generated artifact, or public package export changed.

## 2026-07-14 - Specialist Wave 1 Findings

- Performance/reliability is clean.
- Move the smoke's three trailing Node built-in imports into its header import
  block.
- Replace the guide's unsafe direct `unpackAny(row.state, TaskListSchema)`
  instruction with a defined-state and matching-type guard.
- Make all/ID/column query guidance explicitly executable rather than leaving
  reader-owned setup implicit.
- Add a complete bounded subscription example with generated request/client
  setup, iterator consumption, cancellation, abort, and session cleanup.
