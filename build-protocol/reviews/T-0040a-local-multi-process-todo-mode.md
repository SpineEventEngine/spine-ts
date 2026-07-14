# T-0040a Review Log

Status: Awaiting reviewer wave

Baseline: `24d1ef37`

Branch: `task/T-0040a-local-multi-process-todo-mode`

## Review Contract

Every review prompt must reference the complete Human-Imposed Requirements
Ledger in the task brief, the final design disposition, the focused mechanical
evidence, and the review package from `24d1ef37` to the current implementation
head. Reviewers must ignore historical superseded text unless the current task
brief, current status records, or changed documentation claims it as active.

Before reviewer dispatch, the coordinator must run the lightweight docs/status
lint and check stale status, duplicated constants, public API leakage, package-
internal imports, generated-file tracking, and documentation claims that
overstate future production policy.

## Planned Concern Dispositions

- Code style/maintainability: relevant. The child-process fixture, ownership,
  test structure, diagnostics, and cleanup code require an independent Terra
  High review.
- Documentation completeness: relevant. Even if no public guide changes, code
  comments, package metadata, and limitation wording must not overclaim the
  local demonstration; use Luna Medium.
- TypeScript/API docs: relevant. Public-package-only composition, exports,
  declarations, package subpaths, and runtime/type agreement require Terra High.
- Performance/reliability: relevant. Readiness races, timeouts, child/socket
  lifecycle, cleanup, bounded work, and failure diagnostics require Terra High.
- Security: deferred by protocol to the final project-wide T-0041 security
  gate; no T-0040a security reviewer is assigned.

## Assignment State

- Requirements splitter: accepted and closed. Agent
  `019f6102-4708-72b0-97a3-7adf27c5e187` was explicitly dispatched as the
  existing immutable `requirements_splitter` role with `gpt-5.6-sol` / high;
  Desktop role metadata confirmed that actual profile.
- Design disposition: no T-0038 child. The child uses public `Server` and
  caller-owned environment/transport composition; the parent sends a generated
  command through public transport request/reply and proves handling through a
  public query against the child's projection.
- Implementation owner: accepted and closed. Agent
  `019f610b-c8d9-7282-a3ec-9a2d2cc3d84b` was explicitly dispatched and
  coordinator-confirmed as the existing immutable `implementer` role with
  `gpt-5.6-terra` / medium; no subagents.
- Reviewer wave: not yet dispatched.

## Coordinator Pre-Review Audit - 2026-07-14T14:45:31Z

The coordinator independently ran the new native IPC test (3/3 passing) and
audited the complete assigned diff before creating a review package.

Accepted implementation profile:

- Agent `019f610b-c8d9-7282-a3ec-9a2d2cc3d84b` used the existing immutable
  `implementer` role.
- Explicit dispatch and Desktop role metadata agree on
  `gpt-5.6-terra` / medium. The agent spawned no subagents and was closed after
  handback.

Pre-review findings returned as one batch:

1. Replace the child worker's relative `../dist/src/index.js` import with the
   package's public `@spine-ts/example-todo` self-reference.
2. Make child shutdown attempt and aggregate running-server, environment, and
   transport close failures instead of stopping after the first failure.
3. Bound listener closure, child control send, and the final post-`SIGKILL`
   exit wait with useful phase diagnostics.
4. Preserve partial-setup primary and cleanup failures together; do not ignore
   transport-close failure or let directory removal replace the setup error.
5. Reconcile implementation records with the coordinator-confirmed actual
   immutable Terra Medium profile rather than treating absent shell variables
   as unavailable runtime metadata.

At this historical checkpoint, review dispatch remained blocked until the same
implementation context fixed the batch and the coordinator reran focused
evidence. The resolution is recorded below.

## Pre-Review Findings Resolved - 2026-07-14T14:57:52Z

- The same Terra Medium implementer fixed all five recorded items and was
  closed after handback.
- Coordinator source inspection confirmed public self-reference, independent
  ordered child closes, bounded control/listener/forced-exit waits, compound
  setup cleanup, and corrected immutable runtime metadata.
- Fresh native focused/regression evidence passed: 7 files and 103 tests.
- Example typecheck, focused ESLint, repository format, generated cleanliness,
  diff whitespace, tracked-generated scan, and lightweight docs/status/API
  leakage/policy-claim lint all passed.
- No unresolved coordinator pre-review finding remains. The four specialist
  concerns may now review one committed package.
