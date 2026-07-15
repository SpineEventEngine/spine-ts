# T-0042: Release Readiness And Project Closure

Status: In progress - release preflight pending

Started: `2026-07-15`

Baseline commit: `7678d36c`

Branch: `task/T-0042-release-readiness-project-closure`

Worktree: `.worktrees/T-0042-release-readiness-project-closure`

Dependency: T-0041 is complete, integrated, post-merge verified, remotely
synchronized, and cleaned up.

## Objective

Produce final evidence that the framework runtime, packages, public API,
documentation, user guides, to-do example, security gate, generated artifacts,
and repository are ready together for the accepted initial release.

## Human Requirements

- Continue autonomously until the project is complete or a real protocol
  blocker occurs.
- Preserve every accepted DDD, Spine Protobuf/type-URL, public API, generated-
  output, testing, review, logging, worktree, remote-push, and cleanup rule.
- Never read, edit, stage, move, delete, or use root
  `human-review-1-jul.md`.
- Use focused checks for any inner correction and one full native `pnpm verify`
  as the final task gate; repeat it post-merge.
- Run only the four canonical final reviewer concerns: style/maintainability,
  documentation, TypeScript/API docs, and performance/reliability. Reopen final
  security only if a release correction changes a security boundary.
- Push the completed task branch and updated `main` after closure, preserve the
  remote task branch, and remove the clean merged local worktree/branch.
- After project completion, research public ZeroMQ/libzmq/zeromq.js issues and
  workarounds for accepted SF-013 and report whether the behavior is known or
  appears previously undocumented. This research follows release closure and
  is not an initial-release blocker.

## Acceptance Criteria

1. All prior tasks are integrated and current task/work/review/status mirrors
   agree; no active reviewer/fixer or stale product frontier remains.
2. Ignored generated outputs regenerate cleanly and no generated Protobuf or
   registry output is tracked.
3. The complete native repository `verify` gate passes with at least 90%
   branch coverage and exact test/API/Proto evidence is recorded.
4. A real to-do server/client smoke posts commands, queries state, subscribes,
   cancels, and closes on ephemeral resources.
5. The local multi-process example acceptance passes.
6. Forbidden end-user API scans, stale docs/status scans, all public-package
   build/import smoke checks, relative Markdown links, and documented commands
   pass or receive a recorded bounded correction.
7. A compact final release package receives clean style, documentation,
   TypeScript/API, and performance/reliability reviews with every agent closed.
8. Completion plan, release matrix, bootstrap status mirrors, task/work/review
   records, final main SHA, evidence, and initial-release exclusions are
   reconciled.
9. The closure commit itself is verified on `main`, task/main refs are pushed,
   clean completed worktrees are removed, and the protected user file remains
   untouched.

## Execution Plan

1. Run local preflight/status/generated/public-import scans and inventory exact
   release commands. Use orchestrator mechanical verification; no new role.
2. Run the explicit to-do and package/import smoke matrix plus link/command
   verification. Record any failure before assigning one bounded Terra Medium
   implementer correction.
3. Run the complete native final gate and freeze the release package after all
   local checks are green.
4. Dispatch the four existing reviewers with their explicit immutable profiles,
   aggregate the complete wave, fix one accepted batch if needed, and repeat
   until clean.
5. Reconcile closure records, verify/merge/push/clean, then perform the required
   post-completion ZeroMQ Internet research and user report.

Deep planning is N/A: the detailed completion plan already fixes the release
scope and this task must not redesign public/domain/serialized behavior. Invoke
the existing requirements splitter only if a demonstrated architectural blocker
appears.

## Initial Review Dispositions

- Style/maintainability: relevant to final scripts, examples, and repository
  closure; Terra High.
- Documentation: relevant to README/user-guide/command/link consistency; Luna
  Medium.
- TypeScript/API docs: relevant to public package exports, declarations, and
  generated API reference; Terra High.
- Performance/reliability: relevant to real server/client, IPC, lifecycle,
  generated, and release-gate behavior; Terra High.
- Security: N/A unless a correction changes a trust boundary; T-0041 is clean
  with human-accepted SF-013.
