# T-0195: Wave 13 Spine JVM-Aligned External Events Plan

Status: COMPLETE — planning gate accepted; product implementation remains gated by T-0196 RED evidence

## Objective

Freeze and review the exact behavior, contract, substitution, dependency,
ownership, RED, review, documentation, verification, integration, and remote
closure plan for Spine JVM-aligned cross-context external events. This task is
planning-only and must not change executable product behavior.

## Classification

High-risk. Wave 13 changes serialized contracts, generated application-facing
handler metadata, EventBus dispatch semantics, BoundedContext and
ServerEnvironment ownership/lifecycle, asynchronous transport, cross-process
delivery, tenant handling, and shutdown/error behavior.

## Baselines And Isolation

- Verified Spine TS baseline:
  `origin/main@d6287ae8f2219ea8b71811230289a64226b4a127`.
- Pinned Spine JVM source:
  `SpineEventEngine/core-jvm@0779b5fa42ca5cebd0d2935fc3a3489ab47846dc`.
- Branch: `wave-13-external-events`.
- Isolated worktree: `.worktrees/wave-13-external-events`.
- The primary checkout is coordination-only, dirty, and must not be mutated.
  Its protected `agentic-review-of-main-branch-14-Aug-2026` folder remains
  untouched.
- Startup remote evidence: exactly `refs/heads/main`, no tags.

## Scope

1. Preserve JVM IntegrationBroker ownership and lifecycle inside each bounded
   context.
2. Add environment-owned MessageChannel transport with exact status,
   configuration, and per-event-type exchanges.
3. Intake the pinned `ExternalMessage`, wanted-event, online, external-event
   type, and ChannelId contracts verbatim.
4. Extend generated handler metadata and ordinary EventBus dispatch with exact
   domestic/external selection and invalid-external-command rejection.
5. Export only requested domestic events; import full original Events under
   their original tenant with `EventContext.external = true`.
6. Prove no-loop behavior, one producer/many consumers, startup order,
   interest reference counting, lifecycle, failure semantics, in-memory
   transport, real Node cross-process transport, and ThirdPartyContext parity.
7. Reconcile documentation, run the complete relevant review wave, achieve at
   least 90% changed executable line and branch coverage, release-verify once
   after convergence, integrate, push, and restore an origin containing only
   `main` and no tags.

## Binding Requirements

The complete Human-Imposed Requirements Ledger is maintained in
[`HUMAN_REQUIREMENTS.md`](HUMAN_REQUIREMENTS.md). Every row is binding. The
current human directive supersedes older broker-specific retry/dedup/restart
wording: reliability remains owned by the transport implementation, and the
broker must not add Inbox, durable retry, deduplication, replay, cursor,
checkpoint, fencing, shard, or ownership-election concepts.

## Planning Gate

Product code is prohibited until all of the following are durable and accepted:

- complete JVM behavior/responsibility matrix with exact pinned paths;
- complete Node/TypeScript substitution ledger with behavioral proof;
- Human-Imposed Requirements Ledger;
- exact serialized-contract decision;
- current TypeScript execution trace and ContextTransport/SignalTransport
  dispositions;
- dependency-ordered tasks with one writer per hot file and explicit handoffs;
- executable RED designs for all 22 required behaviors;
- specialist-review, final-security, documentation, convergence, integration,
  push, and remote-cleanup ownership.

The sole requirements split uses the existing `requirements_splitter` role,
explicit `gpt-5.6-sol` with high reasoning, planning-only ownership, and an
explicit prohibition on child spawning. The execution surface exposes no child
self-reported runtime model/reasoning telemetry; acceptance uses immutable role
configuration plus the explicit dispatch, absent a visible mismatch.

## Planning Verification And Review

- Baseline setup: frozen install, Proto generation, generated build, then
  focused EventBus/handler/BoundedContext/ZeroMQ suites.
- Planning preflight: deterministic ledger/matrix/RED scans, forbidden-concept
  scans, formatting, links, `git diff --check`, and task verification with no
  runtime tests because T-0195 itself is record-only.
- Relevant planning reviewers: TypeScript/API contracts,
  performance/reliability, documentation completeness, and
  style/maintainability. Security implementation review is deferred to the
  final Wave convergence, while the planning security disposition is mandatory.
- No plan is accepted until all reviewer findings have one disposition and any
  accepted correction is applied as one consolidated batch.

## Evidence

- Persistent plan: [`task_plan.md`](task_plan.md).
- Research and execution trace: [`findings.md`](findings.md).
- Progress and setup failures/corrections: [`progress.md`](progress.md).
- Child dispatch gate: [`STREAM_DISPATCH.md`](STREAM_DISPATCH.md).
- Frozen Wave implementation plan:
  [`../../planning/WAVE_13_EXTERNAL_EVENTS_PLAN.md`](../../planning/WAVE_13_EXTERNAL_EVENTS_PLAN.md).
