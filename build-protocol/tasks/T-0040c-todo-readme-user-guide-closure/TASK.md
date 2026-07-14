# T-0040c: To-Do README And User Guide Closure

Status: In progress - Wave 4 findings adjudicated; fix wave pending

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

## 2026-07-14 - Specialist Wave 1 Fix Evidence

- Moved the smoke program's three Node built-in imports into its header import
  group; behavior and public/package surfaces are unchanged.
- Replaced fragmentary query guidance with one complete factored ESM client for
  all-row, exact-ID, and `open_task_count` column-filter reads. Its decoder
  skips absent row state and accepts only a defined `unpackAny()` result.
- Added one complete ESM subscription client using public/generated imports and
  compiled example schemas. It builds the `Topic`, starts a bounded iterator
  read before posting `CreateTask`, decodes the delivered `TaskList`, awaits
  cancellation and iterator return, aborts the stream, and aborts its explicit
  HTTP/2 session in outer `finally` cleanup.
- Fresh `typecheck:build` and `docs:check` passed. Both guide JS modules parsed
  and then executed against the native local server: the query module completed
  all three reads and the subscription module printed its generated task ID.
  The exact package smoke printed `to-do smoke ok`; native
  `examples/todo/test/black-box.test.ts` passed 26/26 tests.
- The server was stopped with `SIGINT`; a subsequent exact IPv4 listener check
  returned no `127.0.0.1:8080` listener. Focused final format, generated-clean,
  and diff checks are recorded in the work log. Full `pnpm verify` remains the
  coordinator gate.

## 2026-07-14 - Coordinator Wave 1 Fix Verification

- Extracted both JavaScript modules directly from the changed guide and ran
  them against a freshly started native server. The query module completed
  all/ID/column reads, the subscription module received a real projected task,
  and the package smoke still observed its own projected row.
- Stopped the server, removed both extracted verification modules, and confirmed
  no IPv4 listener remained on `127.0.0.1:8080`.
- Fresh `typecheck:build`, `docs:check`, focused smoke ESLint, `format:check`,
  `proto:check-generated`, and `git diff --check` passed. The corrected batch
  is ready for a fresh immutable endpoint and all four specialist lanes.

## 2026-07-14 - Specialist Wave 2 Findings

- Documentation completeness is clean.
- Three lanes independently identified one deduplicated smoke defect:
  `unpackAny` can return `undefined`, but target matching dereferences
  `candidate.id`; malformed/mismatched rows should be skipped while preserving
  the bounded diagnostic path.
- Performance/reliability identified one subscription-example race: the
  `includeAll` topic accepts any decodable update, so another writer's update
  can produce false success. Precompute the task ID, use an exact-ID topic, and
  validate the delivered list ID with behavior evidence.

## 2026-07-14 - Specialist Wave 2 Fix Evidence

- Added one private-script behavior test and the smallest import-safe smoke
  factoring. Meaningful RED returned `[undefined, valid TaskList]` for an absent
  row, mismatched `Any`, then valid target. GREEN now returns only the valid
  target and bounded sanitized diagnostics `target row, <2 unavailable rows>`.
- `inspectTaskListRows()` is used by both eventual target matching and timeout
  diagnostics. It skips absent state, undefined/mismatched unpack results, and
  malformed unpack failures; diagnostic IDs remain capped and sanitized, with
  finite unavailable/omitted counts. The five-second overall query deadline and
  per-attempt remaining-time bound are unchanged.
- Updated the existing causal remote subscription behavior test. RED consumed
  `task-subscription-unrelated` through the old `includeAll` topic; GREEN uses a
  public exact-ID `TargetFilters` topic, starts `next()` before both commands,
  proves the unrelated row was projected, and receives only
  `task-standalone`. A missed activation still fails at the existing 500 ms
  bound; no readiness acknowledgement was introduced.
- The complete guide subscription module now precomputes one task ID, uses the
  same public `StringValue`/`TargetFilters` exact-ID criterion, posts that ID,
  and rejects a delivered `TaskList` whose ID differs. Its bounded cleanup order
  is unchanged.
- Focused regression passed 2 files / 27 tests. `typecheck:tooling`,
  `typecheck:build`, and `docs:check` passed. The exact package smoke and
  extracted guide subscription module passed against the native server, which
  was then stopped with `SIGINT`. Full `pnpm verify` remains the coordinator
  gate.
- Focused ESLint, Prettier on all owned files, `proto:check-generated`, and
  `git diff --check` passed; generated output remains fresh, ignored, and
  untracked, and no IPv4 listener remained after shutdown.

## 2026-07-14 - Coordinator Wave 2 Fix Verification

- Independently ran the smoke decoder and real loopback black-box suites:
  2 files / 27 tests passed, including absent/mismatched rows followed by the
  valid target and an unrelated projected update before exact-ID delivery.
- Extracted both guide modules verbatim and ran them against a fresh native
  server. All query modes exited 0, the exact-ID subscription delivered its
  matching task, and package smoke observed its own matching projection.
- Server shutdown, extracted-file cleanup, and listener inspection left no
  temporary repository file or `127.0.0.1:8080` listener.
- Fresh tooling/build typechecks, docs/API checks, focused ESLint, full format,
  generated-clean, and diff checks passed. The fixes are ready for another
  immutable all-lane re-review.

## 2026-07-14 - Specialist Wave 3 Findings

- TypeScript/API docs is clean.
- Move smoke row inspection to a typed import-light module instead of testing an
  executable MJS through `@ts-expect-error`, and cover a matching type URL with
  malformed bytes.
- Ensure subscription cancellation covers activation/iterator setup failure;
  give the two guide modules exact save/run commands and prerequisites.
- Use a collision-resistant per-run identity in the guide module.
- Keep the subscription read pending before unrelated/target posts, but start
  its delivery timeout only after posting the target so unrelated projection
  latency cannot consume the target's budget.

## 2026-07-14 - Specialist Wave 3 Fix Evidence

- Replaced the test-only executable-MJS import and erased cast with the typed,
  package-private `src/smoke-task-lists.ts` seam. It is compiled by the existing
  example build and imported by the smoke from `dist/src`; it is not exported
  from the package root.
- Focused RED failed because the new typed seam did not yet exist. GREEN passed
  after extraction and now proves absent state, a mismatched `Any`, matching
  `TaskList` type URL with invalid wire bytes, and a valid later target produce
  only the valid list plus `<3 unavailable rows>` diagnostics.
- Smoke task and command IDs now share a `randomUUID()` suffix. The guide's
  task, exact-ID topic, and command IDs likewise share one collision-resistant
  per-run suffix.
- The guide query and subscription modules now name exact suggested files and
  commands, require `pnpm typecheck:build`, and require the example server in a
  second terminal. The subscription cleanup scope begins immediately after a
  successful subscribe, so activation or iterator setup failure still aborts
  the stream when present and performs bounded cancellation and iterator/read
  cleanup before the outer session abort.
- The causal black-box test starts raw `iterator.next()` before both posts and
  applies its 500 ms delivery timeout only after the target post. Failure
  cleanup aborts and cancels before boundedly awaiting a pending raw read; the
  unrelated row is still proven projected before the target command.
- Verification passed: smoke unit regression 1/1; native black-box 26/26;
  `typecheck:build`; `typecheck:tooling`; focused ESLint and Prettier; and
  `docs:check` with all 372 curated package exports. `proto:check-generated`
  reports ignored, untracked, freshly generated output.
- Exact native server/package smoke and both verbatim guide modules passed. The
  smoke printed its UUID-backed task, all/ID/column queries exited 0, and the
  exact-ID subscription printed its matching UUID-backed task. Server `SIGINT`
  left no `127.0.0.1:8080` listener. The initial sandbox black-box run failed
  only with `listen EPERM`; its approved native rerun passed.
- No activation-failure fault-injection script was added: the lifecycle branch
  is documentation-only, and adding a redundant executable fixture would
  exceed this batch. Native success exercises the same cancellation/session
  path; a missed attachment remains a bounded failure with no invented
  readiness acknowledgement. Full `pnpm verify` remains the coordinator gate.

## 2026-07-14 - Coordinator Wave 3 Fix Verification

- Native focused suites passed 2 files / 27 tests, including matching-type
  malformed bytes and the corrected unrelated-update timing.
- Copied both guide blocks to their exact documented filenames and ran the exact
  documented pnpm-filtered Node commands against a fresh native server. Query,
  exact-ID subscription, and package smoke all exited 0.
- Confirmed the subscription cleanup structurally enters its inner `finally`
  for activation or iterator setup failure after a subscription exists; cancel,
  stream abort, pending-read bound, iterator return, and session abort remain
  owned.
- Server shutdown and copied-module cleanup left no temporary repository file or
  IPv4 listener. Fresh tooling/build types, docs/API, focused ESLint, format,
  generated-clean, and diff checks passed.

## 2026-07-14 - Specialist Wave 4 Findings And Adjudication

- Style/maintainability is clean.
- Make the query module require a real task ID produced by the smoke workflow so
  its exact-ID and one-open-task reads demonstrate matching results.
- Cap smoke response rows inspected/retained, report omitted rows, and bound
  sanitization work before iterating; add oversized-response/ID regressions.
- Catch malformed matching-type `Any` rows in the guide query decoder and
  extend executable-module evidence.
- Rejected one API finding that app-owned relative `dist` imports are
  unsupported package subpaths. The guide modules and smoke execute inside the
  private `@spine-ts/example-todo` package and own their generated/compiled
  artifacts; framework dependencies use public package exports. Adding an
  exported example subpath would create the public contract this task forbids.
