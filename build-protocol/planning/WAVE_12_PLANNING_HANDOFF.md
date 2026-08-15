# Wave 12 Planning Handoff

Status: Ready for a new Codex chat to begin high-risk Wave planning

This file is a self-contained prompt. Copy the text below into the new chat.

---

You are `/root`, the primary orchestrator continuing autonomous Spine TS
development. Start the planning milestone for **Wave 12 — Runtime correctness
and bounded delivery**. Do not begin Wave 13 or any older deferred work.

## Repository and protected human state

- Repository: `/Users/armiol/development/experiments/spine-ts`
- Canonical remote: `origin`
- Begin from the current `origin/main`; verify its SHA instead of assuming one
  from this handoff.
- The primary checkout is coordination-only and contains the human-owned,
  untracked folder `agentic-review-of-main-branch-14-Aug-2026`. Do not edit,
  rename, delete, format, stage, commit, or otherwise mutate that folder. Treat
  it as read-only evidence if direct consultation is necessary.
- Inspect primary-checkout status before work. Create a dedicated task branch
  and isolated worktree from `origin/main` for Wave 12 planning; do not perform
  implementation in the primary checkout.
- During active work, push every feature-branch checkpoint. After a task is
  reviewed, merged, and post-merge verified, inspect every remote ref, preserve
  any unmerged work in `main`, then delete completed branches and every tag.
  Task and Wave closure require `origin` to expose exactly one branch, `main`,
  and no tags.

## Read first

Read these files completely before planning:

- `AGENTS.md`
- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/PROJECT_COMPLETION_PLAN.md`
- `build-protocol/planning/AGENTIC_REVIEW_REMEDIATION_PLAN.md`
- `build-protocol/TECHNICAL_SPEC.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- the relevant accepted decisions in `build-protocol/DECISION_LOG.md`

Preserve all human decisions and the strict review standard recorded in the
remediation plan: similar naming is not capability, local/test-only behavior is
not durable/distributed behavior, source inclusion is not provider-backed
execution, and intentional divergence remains a compatibility divergence.

## Required agent profile and planning boundary

Wave 12 is high-risk: it spans browser streaming, SQL query semantics, durable
Inbox lifecycle, concurrency/fencing, provider behavior, public configuration,
and release evidence. Use the existing `requirements_splitter` once for the
architecture/dependency split, explicitly configured as `gpt-5.6-sol` with
high reasoning. Record the assignment, scope, configured profile, and runtime-
telemetry limitation before accepting it. Subagents must not spawn subagents.

This first milestone is planning and contract freezing. Inspect and trace real
code, tests, provider profiles, and documentation. Do not guess root causes and
do not implement product changes before the dependency plan and human-imposed
requirements ledger are durable. Ask the human only about a genuine contract
choice that cannot be derived from repository/JVM evidence and would materially
change behavior.

## Binding Wave order

The execution order is:

1. Wave 12 — Runtime correctness and bounded delivery.
2. Wave 13 — JVM-equivalent cross-context event exchange.
3. Wave 14 — Publishable package and SPI boundaries.
4. Wave 15 — Registry integrity and tenant admission.
5. Wave 16 — JVM-equivalent Projection catch-up.
6. Wave 17 — Secure distributed defaults and dependency hygiene.
7. Wave 18 — Release evidence and coverage truth.
8. Wave 19 — Multiple-Gateway behavior, starting with future human Q&A.

All older deferred work moves behind this sequence. Wave 12 must not add a
provisional cross-context, catch-up, multiple-Gateway, or Cloud Run API.

## Validated review findings owned by Wave 12

The complete review ledger remains in
`build-protocol/planning/AGENTIC_REVIEW_REMEDIATION_PLAN.md`: 16 findings are
true/open and only `S-04` is false. Wave 12 owns these findings:

### `C-01` — True, user-visible runtime bug

The review reproduced browser subscription termination after successive
Message Board updates. Existing acceptance proves one late update, not a
passive viewer surviving three consecutive updates. Reproduce on current
`main`; do not assume the fault is in the web client, Gateway, native Stand, or
test harness until native and Gateway paths are isolated.

Planning acceptance must require:

- a real-browser test through the supported Gateway/gRPC-Web topology;
- one passive viewer receiving at least three sequential updates caused by a
  different actor/tab;
- a two-tab regression in which the viewing tab does not issue the writes;
- native-versus-Gateway fault isolation;
- preservation of best-effort notification semantics: reconnect/re-query may
  recover actual disconnects, but a healthy stream must not terminate after
  ordinary successive updates;
- bounded lifecycle, cancellation, and resource cleanup.

Start discovery around:

- `examples/message-board/web/test/interop/browser/browser.spec.mjs`
- `examples/message-board/web/test/interop/browser/entry.ts`
- `examples/message-board/web/test/interop/harness.mjs`
- `examples/message-board/web/test/interop/topology.test.mjs`
- `packages/client-web/src/client/client.ts`
- `packages/server/src/services/spine-services.ts`
- `packages/server/src/stand/subscription-runtime.ts`
- `packages/server/src/stand/subscription-observer.ts`
- `packages/server/src/server/browser-server.ts`

### `X-01` — True, runtime/performance bug

MySQL does not provide the required query-plan capability/execution path.
Feature/comparison plans can be rejected, while admitted equality behavior can
fall back to fetching a full storage group and filtering in Node. Nearby tests
have stubbed the exact method that needs production proof.

Planning acceptance must require:

- failing-before reproduction without stubbing the production plan method;
- an explicit capability matrix for equality, comparison, composite filters,
  ordering, offset, and limit;
- parameterized SQL pushdown for every admitted plan;
- tenant and storage-group containment in every generated query;
- explicit rejection of unsupported plans rather than silent full-group scans;
- shared conformance cases and live MySQL execution, with Datastore included
  where capabilities overlap;
- bounded query cost and explainable index expectations.

Start discovery around:

- `packages/storage/src/query/query-execution.ts`
- `packages/storage/src/query/query-policy.ts`
- `packages/storage/test/query/query-provider-conformance.ts`
- `packages/storage-rdbms/src/mysql/entity-history.ts`
- `packages/storage-rdbms/src/mysql/record-storage.ts`
- `packages/storage-rdbms/test/mysql-entity-commit-contract.test.ts`
- `packages/storage-rdbms/test/mysql-record-storage.test.ts`
- `packages/storage-rdbms/test/mysql-integration.test.ts`
- `packages/storage-rdbms/package.json` (`test:mysql`)

### `D-01` — True, bounded-resource bug

Successfully delivered Inbox rows are never removed. `keepUntil` controls
deduplication and is not retention. Storage therefore grows without bound.

Planning acceptance must require:

- a finite default retention contract and a deliberate public configuration
  decision if operators can override it;
- a separate definition for deduplication protection and retention eligibility;
- bounded/page-limited cleanup of eligible delivered rows only;
- preservation of pending, claimed, retryable, and still-deduplicated rows;
- cleanup under current shard ownership and fencing, with stale owners unable
  to delete another owner's records;
- crash/restart, retry, duplicate, expiry-boundary, multi-node, and provider
  conformance tests;
- evidence that sustained successful delivery reaches bounded storage rather
  than monotonically growing forever.

Start discovery around:

- `packages/server/src/delivery/delivery-ports.ts`
- `packages/server/src/delivery/inbox-storage.ts`
- `packages/server/src/delivery/inbox-records.ts`
- `packages/server/src/delivery/inbox.ts`
- `packages/server/src/delivery/delivery.ts`
- `packages/server/src/delivery/delivery-worker.ts`
- `packages/server/test/delivery/direct-record-provider-conformance.test.ts`
- `packages/server/test/delivery/delivery-fencing.test.ts`
- `packages/server/test/delivery/inbox*.test.ts`
- the MySQL and Datastore `RecordStorage` implementations used by Inbox

### `P-04` — True, documentation defect, Wave 12 portion

Any framework documentation changed by Wave 12 must state only current runtime
behavior. Do not call `catchUpReadSide()` Projection catch-up. Do not claim
domestic/external event exchange or runtime event enrichment exists. The
remaining JVM-comparative evidence work stays in Wave 18.

## Required planning deliverables

Produce and durably record:

1. A Wave 12 planning task with risk classification, exact baseline SHA, scope,
   and a complete Human-Imposed Requirements Ledger.
2. A current-state execution trace for each finding, naming production entry
   points, lifecycle/persistence boundaries, provider paths, and existing test
   gaps.
3. Failing-before reproduction designs that use the real browser, production
   MySQL plan path, and real Inbox persistence contracts.
4. Public/serialized/configuration decisions. Compare relevant Spine JVM
   behavior before introducing a TypeScript-specific concept. Record genuine
   unresolved contract choices; do not ask routine questions.
5. A dependency-ordered set of review-sized implementation tasks with one
   production-code writer per overlapping file family. Keep browser delivery,
   SQL query execution, Inbox retention, documentation convergence, and final
   release closure separate unless evidence proves they must share a boundary.
6. Per-task behavior acceptance, focused test paths, changed-source coverage
   expectations, provider requirements, documentation ownership, applicable
   specialist lanes, security disposition, and selected verification profile.
7. One Wave convergence task covering combined cheap preflight, relevant
   specialist reviews, final security review, exactly one converged
   `pnpm verify:release`, integration, post-merge checks, and remote cleanup.
8. Updated `PROJECT_COMPLETION_PLAN.md` and any affected decision/specification
   records. Framework documentation belongs in framework docs, not the root
   README unless it is genuinely repository-entry information.

## Planning quality gates

- Confirm every accepted Wave 12 finding maps to at least one implementation
  task and one executable acceptance test.
- Confirm no task claims a mock/stub/local helper proves the real capability.
- Confirm provider-bearing suites run sequentially when they share generation,
  emulator, database, port, or coverage resources.
- Confirm changed executable lines and branches require at least 90% coverage,
  while live provider evidence is recorded separately from V8 accounting.
- Confirm public docs and TSDoc are updated alongside stabilized behavior, not
  used to advertise future work.
- Confirm no Wave 13–19 feature leaks into Wave 12.
- Confirm the plan ends with `origin` containing only `main` and no tags.

When the plan is complete, reviewed, verified, merged, post-merge verified, and
pushed, continue autonomously into its first approved implementation task unless
a build-protocol blocker or unresolved human contract choice prevents safe
execution.

---
