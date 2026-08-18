# T-0205 — Provider-neutral backend membership kernel

**Status:** Review corrections required

## Classification and baseline

- Risk: **high** because this extracts concurrent membership, fan-out,
  cancellation, backpressure, and cleanup behavior used by Gateway
  subscriptions and future Node Coordinators.
- Baseline: `e41e92d86bb34fa7a43579c2457baa5c1a213ad6`.
- Branch/worktree: `codex/t0205-membership-kernel` at
  `/tmp/spine-ts-t0205`.
- Owner: existing `implementer` role, senior TypeScript/distributed-runtime
  engineer; explicitly configured `gpt-5.6-terra`, reasoning `medium`.
- The owner must not spawn subagents. Runtime self-telemetry is unavailable
  unless the execution surface reports it; the explicit dispatch fields are
  the profile evidence.

## Objective and ownership

Extract the proven Gateway backend membership and subscription fan-out behavior
into one provider-neutral, internal deep module under the deployment boundary.
Auth keeps a narrow adapter. Current Gateway behavior must remain unchanged,
while T-0207/T-0208 can later compose the same member-selection, definition
retention, child activation, recursive ID rewriting, update relay,
generation/replacement, backpressure, and cleanup responsibilities without an
auth/server dependency cycle.

Owned paths:

- a new internal membership/fan-out module below `packages/deployment/src/**`;
- `packages/auth/src/gateway/dynamic-unary-forwarder.ts`;
- `packages/auth/src/gateway/dynamic-subscription-creator.ts` and only directly
  required auth Gateway adapters/exports;
- focused deployment/auth tests and this task's records.

Do not edit ServerEnvironment, BoundedContext, IntegrationBroker, Delivery,
process spawning, service Protobufs, provider packages, or examples.

## Human-Imposed Requirements Ledger

| ID       | Binding requirement                                                                                                                                           | Behavioral proof                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| H-013    | Gateway remains the sole durable logical subscription owner; the neutral kernel holds only ephemeral live child state.                                        | Restart/storage inventory and current durable-binding tests remain unchanged. |
| H-014    | Later members receive retained definitions and activation before becoming eligible.                                                                           | Generation/replacement and late-member tests.                                 |
| H-015    | Unary selection chooses exactly one ready member; domain routing remains inside the selected application's services and Buses.                                | Existing unary round-robin/failure tests through the adapter.                 |
| H-016    | Preserve existing public Spine Protobuf contracts; introduce no membership or subscription wire service.                                                      | Proto/public API diff scan.                                                   |
| H-KERNEL | One neutral kernel is shared by Gateway and future Coordinator composition; do not duplicate Gateway algorithms.                                              | Dependency and implementation review.                                         |
| H-IDS    | Each level rewrites only its immediate child subscription ID; payload, actor, tenant, Event/EventId, state, and logical public ID semantics remain unchanged. | Recursive two-level ID/update tests.                                          |
| H-BOUNDS | Fan-out, stream merging, backpressure, cancellation, generations, and close behavior are explicit and bounded.                                                | Slow-consumer, rejection, replacement, cancel, and close tests.               |

## Required implementation method

1. Follow test-driven development and retain RED evidence before product
   changes.
2. Characterize current `DynamicUnaryForwarder` and dynamic subscription
   behavior first; the extraction must not change Gateway results.
3. Add RED tests for recursive child-ID rewriting, late-member synchronization,
   replacement generations, slow-consumer backpressure, rejection containment,
   cancellation, and idempotent close.
4. Expose the smallest internal composition interface. Do not create a public
   framework concept, public Proto, process manager, or generic signal router.
5. Migrate auth through a thin adapter; do not retain a second algorithm.

## Verification and review gate

- Existing Gateway dynamic unary, subscription, restart/scale, and native
  Gateway suites plus new kernel behavior tests.
- Affected package/generated builds, tooling typecheck, ESLint, Prettier,
  cleanup, copyright, and `git diff --check`.
- At least 90% changed executable line and branch coverage.
- Run the task-scoped verification profile unless dependency/build impact
  requires release escalation.
- Required review concerns: style/maintainability and
  performance/reliability. TypeScript/API docs is required if an export or
  declaration changes; documentation is N/A if no public prose changes.
- Commit and push every checkpoint to
  `origin/codex/t0205-membership-kernel`.

## Coverage-convergence acceptance

- Direct kernel behavior coverage is at least 90% for both executable lines
  and branches. The converged result is **214/220 lines (97.27%)** and
  **141/156 branches (90.38%)** for
  `packages/deployment/src/internal/backend-membership-kernel.ts`.
- The direct test suite now proves constructor bounds; subscribe, rehydrate,
  activation, forwarding, duplicate/replacement, stale child, cleanup/retry,
  close, and abort behavior through the kernel's actual composition seam.
- No production source changed during convergence. The defensive no-await
  `#definitions.get()`-after-`set()` condition remains an intentionally
  unforced defensive branch.

## Skill applicability

- Selected and fully read by the orchestrator: `executing-plans`,
  `subagent-driven-development`, `using-git-worktrees`, and
  `test-driven-development`.
- The implementer must fully read `test-driven-development` before product
  work. `nodejs-backend-patterns` is not selected because this task creates no
  HTTP server; `typescript-advanced-types` is not selected unless actual
  implementation proves an advanced public type problem.
- Inventory sources checked: session skill catalog,
  `build-protocol/skills/EXPECTED_SKILLS.md`, bounded
  `~/.agents/skills/*/SKILL.md` enumeration, and
  `~/.agents/.skill-lock.json`.
- No external library search is needed: this is an extraction of established
  repository behavior and adds no common infrastructure dependency.
