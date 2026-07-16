# T-0044: First-Class Domain Rejections

Status: In progress - Final documentation rereview

Started: `2026-07-16`

Baseline commit: `1aa345ae`

Branch: `task/T-0044-first-class-domain-rejections`

Worktree: `.worktrees/T-0044-first-class-domain-rejections`

Dependency: The accepted initial release and T-0043 are complete. This new
release-blocking requirement reopens framework readiness until first-class
domain rejection mechanics are implemented, documented, exemplified, reviewed,
and verified.

## Objective

Make domain rejections first-class Spine signals with mechanics equivalent in
intent to Spine JVM: application rejection messages are declared in Protobuf,
receive generated throwable TypeScript companions, may be thrown by command
handlers, are caught by the framework, become typed rejection `Event` envelopes
with the rejected `Command` in `RejectionEventContext`, roll back rejected
entity work, and remain available to the framework's event and client-facing
paths.

Replace the current string-coded `CommandRefusalError` shortcut rather than
presenting it as JVM-equivalent rejection behavior.

## Human-Imposed Requirements Ledger

- Domain rejections are first-class citizens and must follow the mechanics the
  human described for Spine JVM: Proto declarations become throwable generated
  types; handler code throws them; the framework catches and interprets them as
  domain signals.
- Analyze the current TypeScript implementation and the actual Spine JVM
  `core-jvm` source before deciding architecture or implementation.
- This work is required before Spine TS can safely be called ready.
- Keep `pnpm` as the package manager for this Spine TS version. Do not add npm
  support or spend task scope on package-manager migration.
- Preserve Spine Protobuf contracts, type URLs, options, and modelling
  conventions.
- Keep end-user handler code free of framework `Event` envelopes, manual
  transactions, `@Apply`, schema-bearing decorators, and app-owned handler
  materialization.
- Prefer the smallest JVM-familiar concept and avoid TypeScript-specific
  abstraction layers without corresponding framework value.
- Use behavior-focused TDD and small task slices with compact review packages.
- Historical or superseded text is non-actionable unless this task, its work
  log, completion plan, or changed current docs claim it as active state.
- Never read, edit, stage, move, delete, or use root
  `human-review-1-jul.md`.

## Current Gap

Slice 1 implements the validated, nominal core throwable contract and generates
same-named companions for eligible rejection Proto messages through the Buf
workflow. Outputs are generated in staging, every matching plugin output points
to that stage, caught synchronous publication failures roll back roots already
published, and generated outputs remain ignored. This does not claim atomicity
across concurrent generation or process interruption.

Slice 2 converts recognized handler-thrown rejections into typed rejection
events after rollback and publishes them independently through EventBus.

Slice 3B removes the string-coded `CommandRefusalError` path, aligns command
acknowledgements with asynchronous rejection timing, migrates the to-do example
to generated `TaskAlreadyDone` and `TaskNotDone` throwables, proves a real typed
rejection subscription, and aligns current user, architecture, API, and package
documentation. Focused implementation gates and canonical Slice 3B review are
clean; the final client-boundary redaction follow-up is active.

Slices 1 through 3B are implementation-verified and clean in every canonical
per-slice reviewer lane. Remaining gap: canonical follow-up documentation
review, final whole-task security rereview, full verification, merge/post-merge
verification, remote synchronization, and restoration of release-ready status.

## Resolved Architecture Decision Trace

The following questions drove the verified JVM comparison, provisional TS
contract, and implementation slices below. They are retained as historical
decision trace, not as open work.

1. What exact source convention identifies a rejection Proto in current Spine
   JVM and what TypeScript convention can preserve compatibility without a
   JVM-only source option?
2. What generated TypeScript API should allow a rejection message to be built
   and thrown while retaining its schema and payload safely?
3. How should generated handler metadata declare throwable rejection schemas,
   given TypeScript has no checked `throws` clause?
4. Which TS runtime boundary owns rejection-event construction, transaction
   rollback, event publication, and command-service acknowledgement?
5. Which rejection paths are immediate `Ack.status.rejection` outcomes and
   which are later domain events, matching actual JVM timing rather than the
   current synchronous shortcut?
6. How do subscribers/reactors and client-facing APIs consume rejection events
   without exposing framework envelopes to application handler code?
7. What compatibility/deprecation path removes or narrows
   `CommandRefusalError` without leaving two competing domain-rejection models?

## Verified JVM Contract

- Rejection declarations are top-level messages in files whose names end in
  `rejections.proto`; the convention is implemented by the Spine model
  compiler rather than by a rejection-specific source option.
- The JVM compiler emits one throwable companion per top-level rejection
  message. Its builder constructs and validates the Proto payload before the
  throwable is raised.
- A command receptor catches `RejectionThrowable` separately from technical
  exceptions. The framework binds the original `Command`, producer, timestamp,
  and stack trace into a rejection `Event`.
- A handler-produced rejection is a later EventBus signal. It is not the same
  mechanism as an immediate command-bus filter rejection returned in an
  acknowledgement.
- Rejected entity work does not advance aggregate state/version or enter the
  aggregate event journal. The rejection event is published independently.

## Provisional TypeScript Contract

The deep-planning result may refine names and slices, but the implementation
must preserve these boundaries:

- The existing `rejections.proto` suffix and top-level-message convention is
  the source of truth.
- The supported Buf workflow generates a schema-aware throwable value for each
  rejection message. The generated value uses the Proto message name so a
  handler can write the JVM-familiar `throw RejectionName.create({...})`
  without constructing an envelope.
- A public core rejection throwable owns an immutable Proto payload and its
  schema. Runtime recognition is nominal; arbitrary objects or ordinary
  `Error` instances cannot impersonate domain rejections.
- Repository command execution catches a recognized rejection only after its
  transaction has rolled back, constructs the rejection event, and posts it
  through EventBus without writing it to aggregate history.
- Generated handler discovery treats `rejections.proto` messages as
  event-consumable signals. TypeScript has no checked `throws`, so handler
  registration must not invent Java-style throw declarations.
- `CommandService.Post` continues to acknowledge accepted handler-dispatched
  commands as accepted. It must not turn a later handler rejection into a
  synchronous `Status.error` or duplicate the rejection as an acknowledgement.

## Provisional Acceptance Criteria

The architecture split may refine these criteria, but it may not weaken the
human requirements.

1. Rejection Proto declarations used by a consumer produce generated,
   schema-aware throwable TypeScript companions through the supported build
   workflow.
2. A command handler can throw such a generated rejection without constructing
   a framework `Event` envelope or opening a transaction.
3. The framework catches only recognized rejection throwables as domain
   rejections; unknown exceptions remain technical failures.
4. The rejection becomes a valid `spine.core.Event` whose message is the typed
   rejection payload and whose `EventContext.rejection.command` contains the
   rejected command.
5. Rejected aggregate/process-manager work cannot persist draft state, version
   changes, produced events, snapshots, or other successful command output.
6. The rejection is published through the appropriate event path and is
   available to declared rejection subscribers/reactors with the rejected
   command context supported by the public handler model.
7. Command acknowledgement behavior distinguishes immediate intake/filter
   rejection from handler-produced rejection according to verified JVM
   semantics.
8. Public APIs, generated metadata, TypeDoc, architecture docs, user guide, and
   the to-do example all describe and prove the same behavior.
9. The current `CommandRefusalError` path is removed, deprecated, or narrowed
   by an explicit compatibility decision; it is not left as a second claimed
   domain-rejection mechanism.
10. Focused slice gates, all relevant canonical reviewer concerns, the final
    full `pnpm verify`, post-merge verification, and remote synchronization
    pass.

## Deep-Planning Assignment

- Existing role: `requirements_splitter`.
- Bounded scope: compare current TS rejection/codegen/runtime mechanics with
  official Spine JVM `core-jvm`, `core-jvm-compiler`, and base rejection
  contracts; propose small sequential implementation slices, exact acceptance
  boundaries, and blocking questions only.
- Explicit expected profile: `gpt-5.6-sol` / high.
- Dispatch must pass both fields explicitly, prohibit child agents and file/Git
  mutation, and report actual runtime profile metadata if exposed.
- Dispatch: `019f6a9d-ad2d-7ec3-9909-0a4e981ad373` (Lorentz). The spawn call
  explicitly supplied existing role `requirements_splitter`, model
  `gpt-5.6-sol`, and reasoning `high`. The agent remained running after bounded
  waits and two finalize requests, returned no result/actual metadata, and was
  closed unaccepted. Primary-source research and the coordinator-owned split
  below therefore remain authoritative.

## Implementation Slices

1. **Generated throwable contract.** Add the nominal core throwable/factory,
   generate same-named throwable values for top-level messages in
   `rejections.proto`, prove the generated typing and suffix convention, and
   keep all matching plugin outputs staged, restore published roots after caught
   synchronous publication failures, and keep generated output ignored.
2. **Rejection event runtime.** Build valid rejection event metadata, recognize
   only nominal rejection throwables after transaction rollback, publish them
   independently through EventBus, and preserve technical-error behavior.
3. **Handler and service integration.** Treat rejection messages as
   event-consumable handler parameters, prove subscriber/reactor access to
   `EventContext.rejection`, and remove the synchronous
   `CommandRefusalError`/`Status.error` shortcut.
4. **Consumer proof and docs.** Migrate the to-do example to generated
   rejections, add black-box behavior tests, and align public API, architecture,
   user-guide, and package documentation.
5. **Final integration.** Run applicable canonical reviews, focused security
   review, full verification, merge/post-merge gates, remote push, and restore
   release-ready completion status.

## Review Scope

Every implementation slice must record concrete dispositions for:

- style/maintainability;
- documentation completeness;
- TypeScript/API docs;
- performance/reliability.

Security is not a routine per-slice lane. Because first-class rejections alter
serialized public behavior and error disclosure, the final T-0044 integration
must run a focused security review before release readiness is re-accepted.
