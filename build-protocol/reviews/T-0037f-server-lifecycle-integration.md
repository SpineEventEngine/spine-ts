# T-0037f Review Log

Status: Slice 1 re-review assigned

Derived status mirror: the canonical current state is the `Status` header in
`build-protocol/tasks/T-0037f-server-lifecycle-integration/TASK.md`.

- Security review remains deferred to T-0041 unless explicitly requested.
- Canonical concerns are style/maintainability, documentation, TypeScript/API
  docs, and performance/reliability. Every implementation slice requires a
  clean or concretely justified N/A disposition after focused verification.
- One existing requirements splitter is assigned this architecture-significant
  server lifecycle integration at explicit expected `gpt-5.6-sol` / `high`, no
  subagents. It owns only TASK/architecture/work/review records.
- Architecture acceptance requires current-code and Spine JVM evidence, exact
  startup/close ordering, caller-owned versus server-owned failure/retry
  ownership, truthful once-only cause handling, no teardown beneath unsafe
  delivery, bounded TDD slices, and no new public export/signature/option.
- Reviewer prompts must ignore historical superseded text unless current TASK,
  architecture resolution, or changed active docs claim it as current.

## Requirements Splitter Handback

- Canonical skill applicability is durably recorded in
  `build-protocol/work-logs/T-0037f.md`. Selected skills were fully read before
  governed work; skipped relevant-looking skills and trust/conflict precedence
  are explicit. No subagents were used.
- Dispatch required the existing requirements splitter at explicit expected
  `gpt-5.6-sol` / `high`. Actual runtime metadata was not exposed to the
  splitter, so orchestrator confirmation of both actual fields is a mandatory
  acceptance gate before implementation dispatch.
- Architecture evidence includes integrated server/environment/access source,
  current tests, accepted D-0085/D-0086, current architecture/API docs, local
  JVM research notes, and the corresponding clean local core-jvm source.
- The accepted ledger is preserved. One actual integration block is recorded:
  current detach rejection alone cannot distinguish unsafe pre-barrier failure
  from safe post-barrier reporting/inert-cleanup failure. The resolution adds
  only read-only package-internal failed-start-pending and handle-qualified
  endpoint-safety observations.
- The existing public methods remain the whole lifecycle interface.
  `RunningServer.close()` retries retained running shutdown. A later call to
  the same `Server.start()` retries retained failed-start cleanup only, opens no
  listener, returns no fake running server, and does not re-surface the original
  or already reported cause.
- Six ordered review-sized TDD slices own recovery/listener order, caller-owned
  failed start, server-owned/listener failed start, shared non-last close, last/
  owned close, and observable docs/compatibility closure. Exact files,
  RED/GREEN expectations, gates, risks, and exclusions are in
  `architecture-resolution.md` and mirrored in TASK.

## Implementation Review Boundary

No canonical implementation review concern is disposed by this architecture
handback. Each implemented slice must receive one complete relevant review wave
after focused mechanical verification and lightweight docs/status/public-leak
lint:

- code style/maintainability: always relevant because `server.ts` gains retained
  lifecycle state and retry checkpoints;
- documentation completeness: relevant in Slice 6 and in any earlier slice that
  changes an active task claim; otherwise a concrete N/A reason must state that
  no observable docs changed yet;
- TypeScript/API docs: relevant to the no-new-public-surface gate in every
  production slice and to TSDoc/README in Slice 6; and
- performance/reliability: always relevant because startup/listener ordering,
  quiescence, race safety, aggregation, exact-once cleanup, and shared sibling
  isolation are the task's core behavior.

Security remains deferred to T-0041. Historical or superseded text remains
non-actionable unless a current T-0037f record or changed active doc claims it.

## Architecture Acceptance Checklist

- [x] Accepted ledger reconciled with actual integrated behavior.
- [x] Relevant Spine JVM notes and clean local source inspected and impacts
      bounded.
- [x] Existing environment owner/handles reused; no duplicate lifecycle state
      machine assigned to server.
- [x] Demonstrated endpoint-safety visibility block resolved package-internally.
- [x] Caller-owned and server-owned failed-start continuations remain distinct.
- [x] Non-last and last detach retry ownership remain distinct.
- [x] Public/root surface fixed with explicit leak gates.
- [x] Ordered RED/GREEN slices, exact ownership, gates, risks, and exclusions
      recorded.
- [x] Orchestrator confirms actual splitter model/reasoning runtime metadata.
- [x] Orchestrator accepts architecture and dispatches Slice 1 only.

## Architecture Acceptance And Slice 1 Review Boundary

- `2026-07-13T17:26:43Z`: splitter actual Sol High matches explicit dispatch;
  it used no subagents and is closed. Coordinator planning checks and the fresh
  generated typecheck plus 5-file / 160-test baseline pass.
- Slice 1 implementer is assigned at explicit expected Terra Medium, no
  subagents. Style/maintainability, TypeScript/API docs, and performance/
  reliability are relevant after focused checks. Documentation is N/A unless
  Slice 1 changes an observable active claim; Slice 6 owns final public docs.

## Slice 1 Implementer Checkpoint

- `2026-07-13T17:34:00Z`: implementation is in strict RED/GREEN TDD. The
  canonical skill applicability record is in the work log. No review finding
  or disposition exists yet; reviewer dispatch remains outside implementer
  authority. Documentation is provisionally N/A because Slice 1 changes no
  active observable documentation; style, TypeScript/API-surface, and
  performance/reliability remain pending focused verification and review.
  Security remains deferred to T-0041.

## Slice 1 Implementation Handback

- `2026-07-13T17:37:37Z`: strict RED/GREEN and focused mechanical checks are
  recorded in the work log. The implementation has no review disposition yet;
  its required review wave remains style/maintainability, TypeScript/API
  surface, and performance/reliability. Documentation is N/A for Slice 1
  because no active observable documentation changed; Slice 6 owns that work.
- Review attention: verify attachment occurs and finite recovery settles before
  listener creation; the exact handle reaches running close; normal shutdown
  is network/sessions, detach, contexts/resources, then owned facilities;
  caller-owned environments stay open; no public/root surface leaks; and no
  Slice 2+ retry/safety behavior was introduced.

## Slice 1 Review Assignment

- `2026-07-13T17:38:37Z`: implementer actual Terra Medium matches explicit
  dispatch; it used no subagents and is closed. Coordinator 5-file / 114-test,
  typecheck, lint, cleanup, format, exact scope/status/public-leak, and diff
  checks pass.
- Style/maintainability: assigned at explicit `gpt-5.6-terra` / `high`.
  TypeScript/API docs: assigned at explicit `gpt-5.6-terra` / `high`.
  Performance/reliability: assigned at explicit `gpt-5.6-terra` / `high`.
  No reviewer may spawn subagents.
- Documentation: N/A for this slice because no README/TSDoc or observable active
  documentation changed; Slice 6 owns the final lifecycle contract. Security
  remains deferred to T-0041. Historical superseded text is non-actionable
  unless current Slice 1 records claim it as active.

## Slice 1 Review Results

- `2026-07-13T17:44:01Z`: style
  `019f5c90-4653-7e13-b1c7-4760c6446ca0`, API
  `019f5c90-6aee-7393-9d83-e79d34851f12`, and reliability
  `019f5c90-914b-7bc1-bf48-b3681947aa07` all match explicit Terra High runtime
  metadata, used no subagents, and are closed. API is CLEAN.
- High: do not run endpoint-dependent close hooks after listener-failure detach
  rejection. High: coalesce concurrent `Server.start()` calls. Medium: narrow
  and guard the package-internal test worker installer.
- Required test fixes: observe listener construction/open directly; trace real
  context/resource/owned-facility order and caller-owned reuse; cover concurrent
  close exact-once detach; and cover listener-bind-failure detach/cleanup gating.
- One existing Terra Medium implementer receives the complete batch. Fresh
  style/API/reliability re-review follows focused verification; documentation
  remains N/A and security deferred.

## Slice 1 Review-Fix Checkpoint

- `2026-07-13T17:48:00Z`: the existing implementer accepted the complete batch
  after source verification and is applying it with strict RED/GREEN tests.
  No partial review disposition is claimed; all three accepted code findings
  and all five direct coverage requirements remain open until fresh focused
  evidence is recorded.

## Slice 1 Review-Fix Handback

- `2026-07-13T17:51:28Z`: all three accepted code findings and all direct
  coverage requirements are addressed with RED/GREEN evidence in the work log.
  The implementation returns for fresh style/maintainability, TypeScript/API,
  and performance/reliability review; this handback does not self-dispose those
  concerns.
- Review focus: confirm detach rejection prevents every endpoint-dependent
  listener-start cleanup hook; start coalescing is in-flight only; close still
  detaches once; the test installer accepts only a worker factory and cannot
  replace lifecycle state; direct tests use real listener contention, context,
  resources, and facilities; and no public or later-slice lifecycle seam leaks.
- Documentation remains N/A because no README/TSDoc claim changed. Security
  remains deferred to T-0041. No retained failed-start cleanup retry or
  endpoint-safety observation is present.

## Slice 1 Re-review Assignment

- `2026-07-13T17:53:59Z`: the resumed implementer is accepted and closed at
  actual Terra Medium with no subagents. Fresh 5-file / 120-test and all scoped
  type/lint/cleanup/format/scope/status/leak/diff checks pass.
- Resume style, API, and reliability reviewers at their explicit Terra High
  profiles against a fresh package covering all Slice 1 commits. Documentation
  remains N/A; security remains deferred.
