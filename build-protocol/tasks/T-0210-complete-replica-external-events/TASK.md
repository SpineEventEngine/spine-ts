# T-0210 — Complete-replica external-event acceptance

**Status:** Review-ready
**Baseline:** `origin/main@bc45eae2008589daf50c9b668360ed6ea65d1e2a`
**Branch/worktree:** `codex/t0210-external-replicas` / `/tmp/spine-ts-t0210`

## Classification, owner, and scope

This is a **high-risk acceptance** task: it proves the intersection of
complete-replica process lifecycle, IntegrationBroker ownership, Delivery, and
subscription fan-out. It changes fixtures and durable evidence only unless a
real product defect is demonstrated. A demonstrated Delivery defect extends
the bounded correction only to the internal process-level dispatcher described
below; it adds no public or wire contract.

- Existing role: `implementer`; explicitly configured profile:
  `gpt-5.6-terra` / `medium`.
- The execution surface exposes no runtime telemetry; the explicit dispatch
  profile is the available evidence. No subagents are permitted or used.
- Sole ownership: T-0210 test fixtures/tests and this task's `TASK.md`,
  `WORKLOG.md`, `EVIDENCE.md`, and review-preparation record. The implementer
  is not alone in the repository and does not revert other work.

## Human-Imposed Requirements Ledger

| ID             | Binding requirement                                                                                                                 | Proof in this task                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| H-002          | Each process defaults to one shared in-memory integration channel factory.                                                          | Two contexts in each managed child exchange through the ordinary context-owned brokers.                                    |
| H-003          | IntegrationBroker traffic never passes through Gateway or Node Coordinator.                                                         | Fixture has no broker proxy, adapter, or Coordinator integration dependency.                                               |
| H-005          | Every managed child is a complete application replica.                                                                              | Same managed application entry builds both producer and consumer Bounded Contexts in every child.                          |
| H-006          | Imported-event-caused entity work is distributed only through Delivery.                                                             | External receptor persists normal projection Inbox work and a real Delivery Server drains it.                              |
| H-007          | Client subscription updates arrive regardless of which replica observes or commits the change.                                      | One logical subscription is installed through the Coordinator and receives the external-state update.                      |
| H-018          | Preserve Wave 13 context-owned broker, external-origin, identity, tenant, loop-prevention, corrupt-frame, and ThirdParty semantics. | Existing Wave 13 suites remain focused regressions; this fixture uses generated external metadata and `ThirdPartyContext`. |
| H-NO-ZMQ       | No ZeroMQ, SignalTransport, ContextTransport, RuntimeTransportBinding, direct transport publication, or test forwarder is used.     | Source guard and black-box real-process test.                                                                              |
| H-NO-INVENTION | Do not add delivery strategy identity/attestation, new public/wire concepts, or private application-payload IPC.                    | Fixture uses configured two-shard strategy and normal gRPC / ThirdParty APIs only.                                         |

## Acceptance

Retain RED evidence then prove in real managed processes:

1. A normal Todo command emits a domestic event; the same child’s second,
   complete-replica Bounded Context receives it as external and its normal
   Delivery-backed state change reaches the client subscription.
2. A `ThirdPartyContext` import of that generated event reaches the same
   external receptor and Delivery-backed state subscription.
3. The fixture uses the shared process-local in-memory IntegrationBroker
   factory, not cross-process broker transport; each child contains both
   contexts.
4. Existing same-process Wave 13 broker acceptance remains green (RED 29).

## Method and verification

- TDD: add the real-process test first, observe its expected RED, then add the
  smallest fixture support. No product behavior is changed unless an observed
  failure proves a product defect.
- Use the production Delivery RPC assembly, managed application processes,
  normal CommandService, SubscriptionService, context-generated handler
  metadata, and public `ThirdPartyContext` behavior.
- Run focused test, generated build/typecheck, lint/format/diff, changed
  executable line and branch coverage (each at least 90%), cheap preflight,
  then one `pnpm verify:task` after convergence.
- Update the work log/evidence with RED and GREEN command output before review.

## Proven Delivery correction invariants

The remote Delivery server owns global shards, not one shard namespace per
Bounded Context. Therefore an application process must have one pickup owner
per global shard. That owner dispatches a picked row to the registered endpoint
whose label, target type, and shard match. Context runtimes may join and leave
while the process is alive; their tenant scopes remain part of the registered
endpoint dispatch. An unknown endpoint is not acknowledged and remains
observable for a later valid runtime. Close drains and releases the same owner
without changing Delivery failure policy.

## Final convergence addition

The reservation-to-retirement boundary is covered by a deterministic, gated
race. It reserves the exact route, invokes `stopOwners()` and `retireOwners()`
before callback dispatch, holds that callback, and retains a sibling route.
The selected owner cannot retire and the Inbox row remains `TO_DELIVER` until
the callback is released; it then replays once and settles. This proof covers
the actual private admission/dispatch boundary without widening a public API.

## Final consolidated review correction

The review found one remaining terminal path: a controlled Delivery run can
lose its lease, stop, or abort after it reserves an owner route but before it
invokes that route's callback. The private run-settlement hook releases only
such undelivered reservations for that settling shard. It never acknowledges the Inbox row. The
deterministic lease-loss proof requires retirement to complete, leaves the row
`TO_DELIVER`, and proves a later worker delivers it exactly once. The hook is
installed through the existing internal supervisor-access seam and is absent
from generated public declarations.

## Skill applicability

- Fully read for this task: `test-driven-development`,
  `using-git-worktrees`, `executing-plans`, and
  `verification-before-completion`.
- The existing isolated worktree was supplied by the orchestrator. The task
  has no advanced type algorithm, new backend framework, public API design, or
  external dependency selection, so the corresponding available skills are
  not selected.
- Inventory evidence: current session catalog, `EXPECTED_SKILLS.md`, bounded
  `/Users/armiol/.agents/skills/*/SKILL.md` enumeration, and
  `/Users/armiol/.agents/.skill-lock.json`; no task-provided skill was omitted.
