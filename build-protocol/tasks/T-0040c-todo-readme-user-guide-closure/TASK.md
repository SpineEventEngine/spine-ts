# T-0040c: To-Do README And User Guide Closure

Status: In progress - Wave 8 docs correction coordinator-verified; fresh re-review pending

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

## 2026-07-14 - Specialist Wave 4 Fix Evidence

- `inspectTaskListRows()` now inspects and retains at most 16 rows, enough for
  the existing three-row corrupt prefix before the exact target. Diagnostic IDs
  remain independently capped at four. Finite counters distinguish unavailable
  inspected rows, omitted diagnostic rows, and omitted response rows.
- `sanitizeSmokeValue()` slices string input to 256 characters before its
  character loop and still caps emitted diagnostics at 64 characters.
- Focused TDD RED failed 2/3: the old decoder retained 100 rows instead of 16,
  and the old sanitizer traversed 1,000 controls to reveal a hidden suffix.
  GREEN passed 3/3 with the oversized response and long-control-ID regressions,
  while retaining absent, mismatched, malformed matching-type, and valid-later
  row coverage.
- The query guide now seeds via package smoke, requires the printed task ID in
  `SPINE_TODO_TASK_ID`, validates the variable before creating a session, and
  uses the ID in the exact filter. UUID-scoped query IDs avoid reuse, and the
  module requires that all-row, exact-ID, and `open_task_count = 1` results each
  contain the seeded task.
- Query decoding now catches malformed matching-type wire bytes and skips them
  alongside absent, mismatched, and undefined rows. App-owned `../dist/**`
  imports remain unchanged and no export subpath was added.
- Exact native reader workflow passed. Package smoke produced
  `smoke-289ab6f7-2e60-4bde-bae2-b144b62ba764`; the saved query module returned
  that same row from all three query shapes, and the saved subscription module
  delivered its exact UUID-backed row. Running the extracted query block
  without `SPINE_TODO_TASK_ID` exited 1 with its documented validation error.
- A temporary check containing the guide decoder verbatim returned only the
  valid row after absent, mismatched, and malformed matching-type rows. The
  temporary saved modules/check were removed with no repository residue.
- `typecheck:build`, `typecheck:tooling`, focused ESLint/Prettier, `docs:check`
  with 372 expected exports, and generated-clean passed. Server `SIGINT` left
  no `127.0.0.1:8080` listener. Final diff checks are recorded in the work log;
  full `pnpm verify` remains the coordinator gate.

## 2026-07-14 - Coordinator Wave 4 Fix Verification

- Native focused verification passed 2 files / 29 tests, including oversized
  response retention/omission and bounded long-control sanitizer input.
- The exact documented native workflow passed: package smoke seeded one UUID
  task; the saved query module returned that task in all, exact-ID, and
  `open_task_count = 1` results; the saved subscription received its own row.
  Missing `SPINE_TODO_TASK_ID` failed with the documented validation error.
- Server shutdown and copied-module cleanup left no temporary file or IPv4
  listener. Fresh tooling/build types, docs/API, focused ESLint, format,
  generated-clean, and diff checks passed.

## 2026-07-14 - Specialist Wave 5 Finding

- Style/maintainability, documentation completeness, and TypeScript/API docs are
  clean.
- Performance/reliability found one accepted guide-query bound: all-row and
  column-filter requests need a finite ordered `ResponseFormat.limit`, and
  decode/log handling needs an independent cap plus omitted-row reporting.
  Keep exact-ID as the deterministic seeded-row proof and add oversized-response
  evidence for the verbatim guide decoder.

## 2026-07-14 - Specialist Wave 5 Fix Evidence

- The verbatim guide query module now creates a public generated
  `ResponseFormat` for every query. Broad and column-filter reads request at
  most 16 rows; exact-ID requests one. All limited requests order ascending by
  `open_task_count`, the only declared `TaskList` projection column, while the
  exact-ID criterion remains the deterministic seeded proof.
- Decoder handling independently inspects at most 16 response rows and returns
  bounded `taskLists`, `unavailableRows`, and `omittedRows`. Logging emits at
  most 16 task IDs, each capped at 64 characters, plus the two finite counters;
  it no longer prints complete decoded rows. Absent, mismatched, undefined, and
  malformed matching-type rows remain skipped and counted unavailable.
- Temporary verbatim-decoder TDD RED retained all 100 valid rows after an
  absent, mismatched, and malformed prefix. GREEN retained the 13 valid rows
  within the first 16 response rows, reported three unavailable and 87 omitted
  rows, and exited 0. No redundant checked-in application script remains.
- Exact native workflow passed. Package smoke seeded
  `smoke-9c1add31-a818-44f8-9a23-431934a13d3f`; the saved query module returned
  that ID from all-row, exact-ID, and `open_task_count = 1` summaries with zero
  unavailable/omitted rows. The saved subscription module delivered its exact
  UUID-backed task.
- `typecheck:build`, `typecheck:tooling`, focused ESLint/Prettier, `docs:check`
  with 372 expected exports, and generated-clean passed. Server `SIGINT` left
  no `127.0.0.1:8080` listener, and all temporary extracted/check modules were
  removed. Final diff/format checks are recorded in the work log; full
  `pnpm verify` remains the coordinator gate.

## 2026-07-14 - Coordinator Wave 5 Fix Verification

- The verbatim bounded query module passed against a fresh native server: all,
  exact-ID, and column summaries each contained the smoke-seeded task with zero
  unavailable or omitted rows; the exact subscription module also passed.
- Focused smoke tests passed 3/3. Fresh tooling/build types, docs/API, format,
  generated-clean, and diff checks passed.
- Server shutdown and saved-module cleanup left no temporary repository file or
  IPv4 listener. The single Wave 5 fix is ready for final all-lane re-review.

## 2026-07-14 - Specialist Wave 6 Findings

- TypeScript/API docs is clean.
- Require the smoke-seeded task only from exact-ID results; broad and column
  results are bounded pages that may legitimately omit it when more than 16
  equal-column rows exist. Add >16-row evidence and update prose.
- Rename/in-line smoke timeout diagnostics so unavailable/omitted counters are
  not mislabeled as row IDs.
- Correct the review log's historical `Reviewers: not assigned` line so it
  cannot contradict active/final reviewer assignments.

## 2026-07-14 - Specialist Wave 6 Fix Evidence

- The guide now requires the smoke seed only from the exact-ID result. All-row
  and `open_task_count` results remain finite demonstrations and may omit the
  seed under equal-column ordering ties without failing the module.
- Broad result summaries make that behavior visible with `requestedLimit`,
  `containsSeededTask`, capped returned IDs, unavailable rows, and distinctly
  named `decoderOmittedRows`. Prose no longer promises the seed appears in a
  bounded broad or column page.
- Temporary extracted-module TDD RED found calls requiring `all`, `exact`, and
  `oneOpenTask`. GREEN found only the exact call. A 17-row equal-column fake
  response placed the seed seventeenth: both broad decodes retained 16 rows,
  omitted the seed, and reported one decoder omission without failure; exact-ID
  returned the seed and remained required, while an empty exact result failed.
- Smoke timeout text now inlines the one-use inspection and labels its mixed
  IDs/unavailable/omission entries `last diagnostics`. `lastRowIds` and `last
rows` are absent.
- Exact native workflow passed. Smoke seeded
  `smoke-612a1f83-e4f9-4d6b-a4fb-3b7babc5008d`; the query module reported
  limits 16/1/16 and `containsSeededTask: true` for this fresh one-row server,
  and the subscription module delivered its exact UUID-backed row.
- Focused smoke tests passed 3/3. `typecheck:build`, `typecheck:tooling`,
  focused ESLint/Prettier, `docs:check` with 372 expected exports, and
  generated-clean passed. Server `SIGINT` left no `127.0.0.1:8080` listener;
  temporary extracted/check modules were removed. Final diff checks are in the
  work log; full `pnpm verify` remains the coordinator gate.

## 2026-07-14 - Coordinator Wave 6 Fix Verification

- Focused smoke tests passed 3/3; fresh tooling/build types, docs/API, format,
  generated-clean, and diff checks passed.
- The latest verbatim query module passed against a fresh native server. Its
  bounded all/exact/column summaries reported requested limits, seed presence,
  capped IDs, and zero unavailable/omitted rows for the fresh seed; exact-ID
  remained the only enforced seed proof.
- Smoke timeout wording now reports mixed entries as diagnostics. Server
  shutdown and saved-module cleanup left no temporary file or IPv4 listener.

## 2026-07-14 - Specialist Wave 7 Finding

- Style/maintainability, documentation completeness, and TypeScript/API docs
  are clean.
- Performance/reliability found one accepted lifecycle defect. The guide and
  causal black-box proof start an async-iterator read, then await command work
  before attaching a rejection handler. An immediate read rejection can
  therefore surface as unhandled before cancellation, iterator return, and
  session cleanup run.
- Attach an immediate rejection observer without replacing the original
  pending-read promise, and add focused failure-path evidence that an early
  read rejection remains handled while cleanup completes. The bounded command
  and post-command delivery deadlines remain unchanged.
- Return this one-file behavior/test plus matching guide correction and durable
  evidence to the existing `implementer`, explicit `gpt-5.6-terra` /
  medium, with no subagents or Git mutation.

## 2026-07-14 - Wave 7 Reliability Fix Evidence

- Existing immutable implementer retained explicit `gpt-5.6-terra` / medium;
  no subagent or Git mutation was used. Changes are limited to the guide,
  causal black-box proof/regression, and these two owned records.
- TDD RED ran `pnpm exec vitest run examples/todo/test/black-box.test.ts -t
"handles an early subscription read rejection while lifecycle cleanup
completes"` against the old pending-read pattern. It exited 1: the focused
  observer received `early subscription read failure` as an
  `unhandledRejection` after the deliberate pre-command event-loop turn.
- GREEN attaches `void pendingRead.catch(() => undefined)` immediately while
  retaining the original promise for bounded delivery and cleanup. The guide
  and causal native proof use the same pattern. The focused regression proves
  stream abort, subscription cancel, pending-read settlement, iterator return,
  and session abort all complete; its isolated rerun passed 1/1.
- The combined native Wave 7 selection passed 2/2, including the unchanged
  unrelated-update-before-target causal proof. Its first sandbox run failed
  only with `listen EPERM: operation not permitted 127.0.0.1`; the approved
  native rerun passed. Command and post-command delivery deadlines remain
  bounded and unchanged.
- `typecheck:build`, `typecheck:tooling`, focused ESLint, focused Prettier, and
  `docs:check` passed; TypeDoc confirmed all 372 curated exports.
  `proto:check-generated` confirmed ignored, untracked, freshly regenerated
  output. `git diff --check` passed, and final status contains exactly the four
  owned changed paths.
- The guide's second JavaScript block was extracted verbatim by a read-only
  Markdown pipeline and executed from `examples/todo/scripts` against the
  native server. It exited 0 with exact task
  `subscription-task-0232239e-254e-40a5-be98-a59e5e1d0dca`. Server `SIGINT`
  closed the managed process, and `lsof` found no retained
  `127.0.0.1:8080` listener. The sandbox denied the supplementary `ps` scan;
  listener cleanup is directly verified.
- Remaining uncertainty: the regression fault-injects the async iterator at
  the application-test boundary rather than changing framework runtime. Full
  `pnpm verify` and a fresh immutable specialist wave remain coordinator gates.

## 2026-07-14 - Coordinator Wave 7 Fix Verification

- Independently inspected the four-path diff and confirmed the immediate
  observer does not replace or recover the original pending-read promise.
- The native focused selection passed 2/2: early rejection remained handled
  through cleanup, and the real unrelated-update/exact-target subscription
  proof retained its causal ordering.
- Fresh build/tooling typechecks, focused ESLint and Prettier, `docs:check`
  with all 372 expected curated exports, generated-clean verification, and
  `git diff --check` passed. A fresh baseline-to-endpoint review package and
  all four specialist lanes remain required before the full task gate.

## 2026-07-14 - Specialist Wave 8 Finding And Adjudication

- Style/maintainability and TypeScript/API docs are clean. Documentation and
  performance/reliability independently found the same ambiguous
  subscription-creation timeout.
- If `Subscribe` persists its record but its response does not reach the
  client before the guide's one-second bound, the client has no returned
  subscription ID to cancel. Immediate HTTP/2 session abort cannot prove that
  server record was removed.
- This does not require a new public seam. The preserved Spine Protobuf contract
  intentionally makes `SubscriptionId` server-generated and says clients
  generally do not construct `Subscription` directly. The accepted service
  owns never-activated records with a configurable inactive TTL, default 30
  seconds, and existing service tests prove abandoned and durable recovered
  records expire without attaching delivery.
- Correct the guide to distinguish immediate client-side cleanup and explicit
  cancellation after successful creation from bounded server TTL cleanup when
  creation times out before returning the opaque handle. Do not promise
  cancellation of an unknown ID, add a client-owned ID contract, or change
  runtime/Protobuf behavior in this documentation slice.
- Return this bounded correction and focused existing-expiry verification to
  the existing `implementer`, explicit `gpt-5.6-terra` / medium, no
  subagents or Git mutation.

## 2026-07-14 - Wave 8 Subscription-Timeout Documentation Fix Evidence

- Existing immutable implementer retained actual explicit `gpt-5.6-terra` /
  medium. No subagent or Git mutation was used; changes are limited to
  `examples/todo/USER_GUIDE.md` and these two owned records.
- The guide keeps the one-second creation bound and executable lifecycle code
  unchanged. It now distinguishes a returned opaque server-generated handle,
  which the module explicitly cancels before aborting/returning client
  resources, from a timeout before handle receipt, which gives the client no
  subscription ID to cancel. The latter closes the HTTP/2 client session and
  relies on configurable `SpineServicesOptions.inactiveTtlMs`, default 30
  seconds, to expire any server record created but never activated.
- Existing service verification passed 2/2 with 96 tests skipped:
  `pnpm exec vitest run packages/server/test/services/spine-services.test.ts
-t "removes expired durable inactive subscriptions before recovered
activation|expires abandoned inactive subscriptions before activation"`.
  The process-local regression confirms expiry before activation attaches no
  Stand delivery; the durable regression confirms a second service instance
  cannot activate the expired recovered record.
- `typecheck:tooling`, `docs:check` with all 372 curated exports, and focused
  Prettier passed. An initially parallel `typecheck:build` and `docs:check`
  invocation raced their shared Protobuf generation staging directory;
  `docs:check` completed, and the sequential `typecheck:build` rerun passed.
  The two exact untracked `.generated-*` staging directories left by that
  failed invocation were removed. A fresh `proto:check-generated` confirmed
  ignored, untracked, freshly regenerated canonical output; final focused
  Prettier and `git diff --check` passed, and status lists exactly the three
  owned paths.
- Remaining uncertainty: the to-do guide does not fault-inject the transport
  race itself; accepted server cleanup is established by the existing
  process-local and durable service regressions. Full `pnpm verify` and a fresh
  immutable specialist wave remain coordinator gates.

## 2026-07-14 - Coordinator Wave 8 Fix Verification

- Independently inspected the guide diff against the copied Spine
  `Subscription` contract and current `SpineServices` implementation. The
  text accurately separates returned-handle cancellation from inactive-TTL
  cleanup after an ambiguous creation timeout.
- The two existing expiry regressions passed 2/2. Sequential
  `typecheck:build`, `typecheck:tooling`, `docs:check` with all 372
  curated exports, generated-clean, focused Prettier, and `git diff --check`
  passed. No generation staging directory remains.
- A committed immutable endpoint, fresh baseline package, and all four
  specialist lanes remain required before the full task gate.
