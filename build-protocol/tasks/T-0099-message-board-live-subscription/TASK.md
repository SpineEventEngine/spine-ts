# T-0099: Message Board live subscription

Status: Complete; merged, post-merge verified, and pushed to `main`
Start: `2026-08-03`
Completed: `2026-08-03`
Baseline: `49b6b358`
Branch: `task/T-0099-live-subscription`
Worktree: `.worktrees/T-0099-live-subscription`

Classification: High-risk until root-cause isolation proves otherwise. The
reported defect concerns long-lived browser subscription lifecycle,
cancellation, repeated activation, and reconnect behavior. A framework client
correction would affect public runtime reliability even if the visible symptom
appears in one example.

## Objective

Keeps Message Board live updates active for the lifetime of the page, explains
and eliminates unjustified repeated activation/cancellation traffic, and adds
concise educational browser logging for subscription, command, update, and
lifecycle activity.

## Human-Imposed Requirements Ledger

1. A healthy Message Board page must not cancel its own subscription merely
   because time passes.
2. Live updates must continue without requiring a forced page reload.
3. Multiple `Activate` requests must be traced and retained only when a
   lifecycle reason requires them.
4. The example console must explain significant activity in beginner-friendly
   terms, including subscription activation details, command sending, and
   received server updates.
5. Logs must also make reconnect, failure, and deliberate cancellation clear
   enough to diagnose the lifecycle without framework-internal jargon.
6. Preserve server-derived validation, post-success authoritative refresh,
   oldest-first display, relative times, keyboard posting, accessibility, and
   the exact live-status badge semantics.
7. Add deterministic regression coverage and real Chromium acceptance over a
   duration that crosses the former cancellation boundary.
8. Do not broaden Wave 6 notification guarantees, publish packages, build or
   modify Spine JVM, or touch protected human-review files.
9. Push every feature-branch commit immediately; merge and push only after
   review and verification.

## Planning And Implementation Dispatch

- Requirements splitter: existing role, bounded to subscription lifecycle
  ownership and task slicing after root-cause evidence. Expected model:
  `gpt-5.6-sol`; expected reasoning: high.
- Implementation owner: existing `implementer`, sole writer for affected
  client/example runtime, focused tests, logging, and directly affected docs.
  Expected model: `gpt-5.6-terra`; expected reasoning: medium.
- Both dispatch fields must be explicit. Neither child may spawn children,
  commit, push, build JVM, touch protected files, or expand into Wave 6.

## Skill Applicability

- Inventory sources: current session inventory; bounded enumeration of
  `/Users/armiol/.agents/skills`; repository expected-skill manifest; readable
  `/Users/armiol/.agents/.skill-lock.json`.
- Selected and fully read by the orchestrator: `systematic-debugging`,
  `test-driven-development`, `using-git-worktrees`, and `webapp-testing`.
  They govern evidence-first diagnosis, RED/GREEN implementation, dirty-root
  isolation, and real browser/network/console acceptance.
- `accessibility` is not selected because this task does not currently change
  controls, keyboard semantics, focus, or visual structure; existing
  accessibility regressions remain mandatory.
- `debugging-strategies` and `tdd` overlap the selected systematic-debugging
  and test-driven-development instructions; duplicating their workflows would
  add no task-specific guidance.
- In-app browser control is not selected because the supplied screenshot is
  evidence, not an explicit request to control the ambient browser. Repeatable
  local Playwright acceptance is preferred.
- No library search is needed unless diagnosis proves a missing common
  facility. The current task begins with existing React, Connect/gRPC-Web,
  client-web, client-react, and browser-test dependencies.

## Acceptance Criteria

1. Root-cause evidence maps every observed `Read`, `Subscribe`, `Activate`, and
   `Cancel` request to an owning client action and explains why posting remains
   available when updates stop.
2. One mounted Message Board subscription remains connected and receives later
   updates beyond the reproduced failure boundary; elapsed time alone never
   causes client cancellation.
3. Activation count is deterministic and minimal for initial connection and
   any explicitly supported reconnect path; no render/effect churn creates a
   second logical subscription.
4. Unmount or explicit cancellation performs one bounded cleanup and leaves no
   stream, timer, listener, or retry activity behind.
5. Browser console output clearly records subscription activation, command
   sending, server updates, lifecycle changes, and deliberate cancellation
   with useful structured details.
6. Focused unit/component/integration tests and real-browser acceptance pass;
   affected runtime branch coverage remains at least 90%.
7. Every canonical review concern has a clean, accepted, or concrete N/A
   disposition. The selected change-sensitive verification profile passes.
8. The reviewed task is merged into `main`, post-merge verified, and both task
   and `main` refs are pushed.

## Verification Strategy

Reproduce from a clean generated build and capture browser network plus console
events across the observed timeout. Establish RED tests at the actual owner
before changing runtime code. Use `verify:release` if shared client runtime
changes; use source-scoped `verify:task` only if evidence proves the correction
is confined to the example. Real Chromium acceptance must exercise sustained
updates, posting, console logging, and cleanup.

## Completion Evidence

- Root cause, implementation, review findings, corrections, and re-reviews are
  recorded in `build-protocol/work-logs/T-0099.md` and
  `build-protocol/reviews/T-0099-message-board-live-subscription.md`.
- Final `pnpm verify:release` passed: 178 test files passed, 3 skipped; 3,504
  tests passed, 25 skipped; 90.01% branch coverage and at least 94% statements,
  functions, and lines.
- Merge commit `f34febcd` passed post-merge `pnpm verify:release` and was pushed
  to `origin/main`. The final remote-ref confirmation is recorded in the work
  log.
