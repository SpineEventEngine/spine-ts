# T-0112: Wave 6 Documentation And Closure

Status: Complete

## Objective

Reconciles every affected human README, agent reference, user guide,
architecture diagram, API guide, example, and deployment template with the
completed distributed delivery, Stand registry, and one-Gateway runtime. Then
closes Wave 6 durably.

## Classification

Standard. Runtime and public contracts are already frozen and release-verified;
this task changes documentation, diagrams, deterministic documentation tests,
and protocol records only. Accuracy spans several packages and examples, so one
bounded implementation owner and all relevant documentation/API/style review
concerns remain required.

## Baseline And Isolation

- Baseline: `origin/main@79900f53`.
- Branch: `task/T-0112-wave6-docs-closure`.
- Worktree: `.worktrees/T-0112-wave6-docs-closure`.
- The dirty primary checkout remains coordination-only and untouched.

## Acceptance Criteria

1. Beginner-facing documentation explains command routing to durable Entity
   Inboxes, shard notification, single-owner drain, and Aggregate/Process
   Manager dispatch in plain language.
2. Stand documentation explains event/entity observation, the configurable
   durable subscription registry, one record per definition, physical cancel
   deletion, 30-second pending cleanup, ten-second cross-node reconciliation,
   custom builder registry, storage-factory default, and production warning for
   an in-memory registry.
3. Gateway documentation explains one fixed Gateway connected to all configured
   application nodes: round-robin command/query selection without retry,
   all-node subscription activation, possible duplicate/gap/loss notices, and
   authoritative re-query behavior.
4. Human docs contain no internal wave/task terminology and introduce concepts
   progressively. Agent `REFERENCE.md` files contain precise extension,
   lifecycle, persistence, topology, and limitation details and are linked from
   their human README.
5. All affected examples and deployment diagrams use the corrected topology;
   the simple and Distributed Message Board examples remain distinct and
   independently runnable with documented one-command process startup.
6. Deterministic docs/API/path/command checks, the complete relevant review
   wave, the final release gate, merge, post-merge verification, pushes, and
   branch/worktree cleanup complete before Wave 6 is marked closed.

## Exclusions

- No runtime, Protobuf, public API, package publication, JVM source/build,
  Redis/Hazelcast, durable delivery-server, or Wave 7 behavior.
- No cluster-complete, exactly-once, gap-free, or ordered subscription claim.
- No dynamic backend discovery or application redeployment/update design.

## Verification Profile

- Deterministic stale-claim/path/command scans and documentation tests first.
- Documentation, style/maintainability, and TypeScript/API review; reliability
  reviews topology/lifecycle claims. Security is N/A without a trust-boundary
  change.
- `verify:release` is required by the approved Wave 6 closure plan, followed by
  tree equality, focused post-merge documentation checks, and remote cleanup.
