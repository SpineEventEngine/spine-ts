# T-0018a Review Log

Status: clean, complete, and integrated on main

Scope: runtime signal metadata factories and narrow integration into supported
local runtime paths.

## Participants

- Implementation agent:
  `019f4737-29d9-7551-8041-25cb9b1c8a69`; closed by root after focused
  implementation and verification report.
- Round 1 review-fix agent:
  `019f4756-5113-7591-9bd5-376b22a6d44c`; closed by root after applying the
  review fixes and reporting verification.
- Round 1 code style/maintainability reviewer:
  `019f4751-b501-7032-bb93-c702776acdf9`; closed by root after findings were
  captured.
- Round 1 documentation reviewer:
  `019f4751-e55d-77c1-953b-a7dad7863eeb`; closed by root after findings were
  captured.
- Round 1 TypeScript/API reviewer:
  `019f4752-0516-75c0-8d9a-5f04e4bc6229`; closed by root after findings were
  captured.
- Round 1 security reviewer:
  `019f4752-2269-7361-8edd-d39dadc2fd6b`; closed by root after findings were
  captured.
- Round 1 performance/reliability reviewer:
  `019f4752-4099-7602-a623-7a2ac691ccca`; closed by root after findings were
  captured.
- Round 2 fix agent:
  `019f4766-224d-7630-bf95-37d07973c529`; closed by root after applying this
  focused fix pass.
- Round 2 documentation reviewer:
  `019f4762-410b-7143-b145-a6e147d73285`; findings captured by root and the
  reviewer was closed.
- Round 2 TypeScript/API reviewer:
  `019f4762-5cd4-7e62-82ff-9f6ecd42a27a`; findings captured by root and the
  reviewer was closed.
- Round 2 reliability reviewer:
  `019f4762-91f2-7491-b607-1ffa0c39f8ec`; findings captured by root and the
  reviewer was closed.
- Round 3 fix agent:
  `019f4775-fa54-72c2-9f0b-acb28878dffa`; closed by root after applying this
  focused fix pass.
- Round 3 code style/maintainability reviewer:
  `019f4772-00e5-7d82-8b5f-04cf7c734bd6`; clean result captured by root and
  the reviewer was closed.
- Round 3 documentation reviewer:
  `019f4772-1912-7951-8406-e9527e449196`; findings captured by root and the
  reviewer was closed.
- Round 3 TypeScript/API reviewer:
  `019f4772-38fc-73d2-a992-6e14261f17c7`; clean result captured by root and
  the reviewer was closed.
- Round 3 security reviewer:
  `019f4772-55d7-7f32-9bb2-11249eaef1cc`; clean result captured by root and
  the reviewer was closed.
- Round 3 performance/reliability reviewer:
  `019f4772-7450-7883-9bcd-41e844ad18e7`; findings captured by root and the
  reviewer was closed.
- Round 4 code style/maintainability reviewer:
  `019f477e-7aea-72c3-b0e2-f092861ae0ed`; clean result captured by root and
  the reviewer was closed.
- Round 4 documentation reviewer:
  `019f477e-9280-7340-ae73-196ff9178594`; findings captured by root and the
  reviewer was closed.
- Round 4 TypeScript/API reviewer:
  `019f477e-ab76-76c1-8508-fbbebc735829`; clean result captured by root and
  the reviewer was closed.
- Round 4 security reviewer:
  `019f477e-c6b3-7df2-9f44-3109e003aebb`; clean result captured by root and
  the reviewer was closed.
- Round 4 performance/reliability reviewer:
  `019f477e-f10c-7090-8b19-b0f61f9581db`; clean result captured by root and
  the reviewer was closed.

## Required Lanes

| Lane                       | Reviewer ID                            | Status                    | Result                                      |
| -------------------------- | -------------------------------------- | ------------------------- | ------------------------------------------- |
| Code style/maintainability | `019f4751-b501-7032-bb93-c702776acdf9` | Findings captured; closed | Move metadata ownership into runtime seam.  |
| Documentation completeness | `019f4751-e55d-77c1-953b-a7dad7863eeb` | Findings captured; closed | Review log/doc scope wording needs updates. |
| TypeScript/API docs        | `019f4752-0516-75c0-8d9a-5f04e4bc6229` | Findings captured; closed | Narrow producer input; validate versions.   |
| Security                   | `019f4752-2269-7361-8edd-d39dadc2fd6b` | Findings captured; closed | Gate producer IDs; clone actor input.       |
| Performance/reliability    | `019f4752-4099-7602-a623-7a2ac691ccca` | Findings captured; closed | Restore invariants for IDs/timestamps.      |

## Round 1 Findings

- Code style/maintainability:
  - `packages/server/src/repository/repository.ts` keeps a module-level
    `const signalMetadata = new SignalMetadata()`. The runtime metadata policy
    should be owned by the existing repository runtime assembly seam instead of
    hidden module-global state.
  - `packages/server/src/runtime/signal-metadata.ts` currently depends on
    `PrimitiveIds` from `repository/primitive-id.ts`; remove the codec import
    from the runtime slice by moving that dependency to a neutral seam or by
    normalizing producer IDs before `SignalMetadata` is called.
- Documentation completeness:
  - This review log still said pending/TBD and did not record the first-round
    reviewer IDs, statuses, or closure state.
  - Public docs need to say `SignalMetadata` does not discover handlers, load
    generated registries, or materialize application handlers.
- TypeScript/API docs:
  - `EventContextInput.producerId` is publicly typed as `unknown`; narrow it to
    the existing public `PrimitiveId` union.
  - `SignalMetadata.version(number)` should reject non-finite, non-integer, and
    out-of-int32-range values before constructing `Version`.
- Security:
  - `SignalMetadata.producerId()` should reject or omit non-finite numeric
    producer IDs instead of packing them.
  - `SignalMetadata.actorContext()` should not retain nested mutable
    `actor`/`tenantId` input references.
- Performance/reliability:
  - `requireEventId()` should reject missing or empty event IDs so repository
    metadata binding preserves the previous invariant.
  - Timestamp conversion should normalize pre-epoch values with floor-style
    seconds/nanos arithmetic.
  - `ProcessManagerCommandExecution.run()` needs the pre-handler command-ID
    check restored before handler invocation or state storage.

## Round 1 Fix Plan

- Add `signalMetadata` to the narrow repository runtime object and instantiate
  it during bounded-context repository registration with a default
  `new SignalMetadata()`.
- Remove the runtime slice's direct dependency on repository codec helpers by
  narrowing `EventContextInput.producerId` to `PrimitiveId` and normalizing
  producer IDs before `SignalMetadata` is called.
- Add focused RED tests for version validation, empty/missing event IDs,
  pre-epoch timestamps, non-finite numeric producer IDs, cloned actor context
  inputs, and early process-manager command-ID rejection.
- Update API/architecture docs and this review log to reflect the small
  metadata-only seam and the captured round-1 reviewer outcomes.

## Round 1 Fix Evidence

- `RepositoryRuntime` now owns `signalMetadata`, and bounded-context assembly
  binds a default `new SignalMetadata()` during repository registration instead
  of relying on a module-global singleton.
- Repository-produced event paths normalize producer IDs before calling
  `SignalMetadata`, so the runtime slice no longer imports the repository codec
  helper directly and non-finite numeric producer IDs are omitted safely.
- `EventContextInput.producerId` is now the public primitive union
  (`string | number | boolean`), `SignalMetadata.version()` rejects non-finite,
  non-integer, and out-of-int32-range inputs, and `requireEventId()` rejects
  missing or empty event IDs.
- Timestamp conversion now uses floor-style normalization for pre-epoch dates,
  and `SignalMetadata.actorContext()` clones nested actor/tenant inputs before
  returning them.
- `ProcessManagerCommandExecution.run()` restores the early `command.id`
  invariant before handler invocation or Stand writes during replay paths.
- Public docs now state that `SignalMetadata` does not discover handlers, load
  generated registries, or materialize application handlers.

## Round 1 Verification

- `pnpm --config.verify-deps-before-run=false exec vitest run
packages/server/test/runtime/signal-metadata.test.ts
packages/server/test/repository/repository-routing.test.ts
packages/server/test/index.test.ts`: passed (`3` files, `130` tests).
- `pnpm --config.verify-deps-before-run=false typecheck:generated`: passed.
- `pnpm --config.verify-deps-before-run=false lint:generated`: passed.
- `pnpm --config.verify-deps-before-run=false format:check`: passed.
- `pnpm --config.verify-deps-before-run=false docs:check:generated`: passed
  with the existing TypeDoc warning about the invalid `origin` git remote and
  confirmed `213` expected `@spine-ts/server` exports.
- `git diff --check`: passed.

## Round 2 Findings

- Documentation completeness:
  - `packages/server/README.md` must restate near the `SignalMetadata` section
    that handlers still return generated domain messages, end-user code must
    not use framework `Event` envelopes, `@Apply` remains absent, and the seam
    does not introduce manual transaction control.
  - `docs/api/README.md` must mirror that `SignalMetadata` keeps the metadata
    seam small and does not broaden public APIs into framework envelopes,
    `@Apply`, or manual transaction APIs.
- TypeScript/API docs:
  - `SignalIds.event()` / `SignalMetadata.eventId()` must reject empty event ID
    values immediately.
  - Add direct coverage for `metadata.eventId("")` and a deterministic
    `SignalIds` generator that returns `""`. While fixing this shared ID path,
    also reject direct and generated empty command IDs so `SignalMetadata`
    cannot create invalid `CommandId` messages.
- Performance/reliability:
  - Repository `requireCommandId()` must reject blank / trim-empty command UUID
    values before handler or state changes.
  - Runtime `requireEventId()` must reject whitespace-only event ID values, not
    just the empty string.

## Round 2 Required Lanes

| Lane                       | Reviewer ID                            | Status                    | Result                                              |
| -------------------------- | -------------------------------------- | ------------------------- | --------------------------------------------------- |
| Documentation completeness | `019f4762-410b-7143-b145-a6e147d73285` | Findings captured; closed | Restate small public seam and preserved boundaries. |
| TypeScript/API docs        | `019f4762-5cd4-7e62-82ff-9f6ecd42a27a` | Findings captured; closed | Reject empty generated/direct event IDs.            |
| Performance/reliability    | `019f4762-91f2-7491-b607-1ffa0c39f8ec` | Findings captured; closed | Reject blank command IDs and whitespace event IDs.  |

## Round 2 Fix Plan

- Add focused RED tests for:
  - direct `metadata.eventId("")`;
  - generated-empty `SignalIds.event()` values;
  - direct and generated-empty `SignalIds.command()` values;
  - whitespace-only event IDs in metadata causality helpers;
  - blank process-manager and aggregate command IDs before handler/state
    changes.
- Tighten `SignalMetadata` event-ID validation to reject blank/trim-empty
  values both on direct generation and when reading source events.
- Tighten repository command-ID validation to reject blank/trim-empty UUIDs
  before durable writes or handler-driven state changes.
- Refresh the README/API wording so the metadata seam explicitly preserves the
  generated-domain-message boundary, keeps `@Apply` absent, and does not add
  manual transaction control.

## Round 2 Evidence

- `SignalIds.event()` and `SignalMetadata.eventId()` now reject trim-empty
  event IDs immediately, so both direct `metadata.eventId("")` calls and
  deterministic generators that return `""` fail before an invalid `EventId`
  enters the runtime seam.
- `SignalIds.command()` and `SignalMetadata.commandId()` now reject trim-empty
  command IDs immediately for the same reason, before an invalid `CommandId`
  enters origin or follow-up command metadata.
- `requireEventId()` now rejects whitespace-only event IDs, and focused
  metadata tests cover both `commandFromEvent()` and `eventFromEvent()` for
  causality derivation from `"   "` values.
- Repository `requireCommandId()` now rejects trim-empty `command.id.uuid`
  values before handler execution or state writes. Focused aggregate and
  process-manager tests cover bus dispatch and process-manager inbox replay.
- The `SignalMetadata` README/API summaries now restate that handlers still
  return generated domain messages, end-user code must not use framework
  envelopes, `@Apply` remains absent, and the seam does not add manual
  transaction-control APIs.

## Round 2 Verification

- `pnpm --config.verify-deps-before-run=false exec vitest run
packages/server/test/runtime/signal-metadata.test.ts
packages/server/test/repository/repository-routing.test.ts`: passed (`2`
  files, `125` tests).
- `pnpm --config.verify-deps-before-run=false typecheck:generated`: passed.
- `pnpm --config.verify-deps-before-run=false docs:check:generated`: passed
  with the existing TypeDoc warning about the invalid `origin` git remote and
  confirmed `213` expected `@spine-ts/server` exports.
- `pnpm --config.verify-deps-before-run=false format:check`: passed.
- `git diff --check`: passed.

## Round 3 Findings

- Code style/maintainability:
  - Reviewer `019f4772-00e5-7d82-8b5f-04cf7c734bd6` reported no additional
    findings; lane is clean.
- Documentation completeness:
  - Reviewer `019f4772-1912-7951-8406-e9527e449196` flagged that the
    `docs/architecture/README.md` `SignalMetadata` paragraph still needs to
    restate the public handler/API boundary explicitly: end-user handlers do
    not accept framework `Event` envelopes, `@Apply` remains absent, and the
    seam does not add manual transaction controls.
- TypeScript/API docs:
  - Reviewer `019f4772-38fc-73d2-a992-6e14261f17c7` reported no additional
    findings; lane is clean.
- Security:
  - Reviewer `019f4772-55d7-7f32-9bb2-11249eaef1cc` reported no additional
    findings; lane is clean.
- Performance/reliability:
  - Reviewer `019f4772-7450-7883-9bcd-41e844ad18e7` found that
    `ProcessManagerEventExecution` can still persist changed Stand state before
    follow-up metadata binding rejects a missing/blank source event ID. The
    fix must validate source event IDs before handler invocation whenever the
    process-manager event path may derive follow-up commands or events.

## Round 3 Required Lanes

| Lane                       | Reviewer ID                            | Status                    | Result                                                  |
| -------------------------- | -------------------------------------- | ------------------------- | ------------------------------------------------------- |
| Code style/maintainability | `019f4772-00e5-7d82-8b5f-04cf7c734bd6` | Clean; closed             | No additional findings.                                 |
| Documentation completeness | `019f4772-1912-7951-8406-e9527e449196` | Findings captured; closed | Architecture docs must restate public handler boundary. |
| TypeScript/API docs        | `019f4772-38fc-73d2-a992-6e14261f17c7` | Clean; closed             | No additional findings.                                 |
| Security                   | `019f4772-55d7-7f32-9bb2-11249eaef1cc` | Clean; closed             | No additional findings.                                 |
| Performance/reliability    | `019f4772-7450-7883-9bcd-41e844ad18e7` | Findings captured; closed | Validate source event IDs before PM state mutation.     |

## Round 3 Fix Plan

- Add focused RED coverage in
  `packages/server/test/repository/repository-routing.test.ts` for:
  - a missing source event ID on a process-manager event-commanding path; and
  - a blank source event ID on a process-manager event-producing path.
- Keep the runtime check narrow by validating `requireEventId(this.#event)`
  before handler invocation only when process-manager event execution may later
  derive follow-up commands or emitted events.
- Reuse the existing event-ID validation semantics already enforced by
  `SignalMetadata.commandFromEvent()` / `eventFromEvent()` rather than adding a
  second bespoke validator.
- Update `docs/architecture/README.md` so the `SignalMetadata` paragraph
  states the same public handler/API boundary guarantees as the README/API
  docs.
- Record fresh verification evidence for the focused repository-routing suite,
  any touched signal-metadata suite, docs/format checks if needed, and
  `git diff --check`.

## Round 3 Evidence

- `ProcessManagerEventExecution.run()` now validates the source event through
  the existing `SignalMetadata.originFromEvent()` event-ID semantics before any
  entity is loaded or mutated, but only when the routed handler set may derive
  follow-up commands or emitted events.
- The narrowing logic leaves pure state-only process-manager event reactors
  alone: if there are no command reactions and no event-reaction emitted
  schemas, the pre-handler source-event-ID check does not run.
- Focused repository-routing coverage now proves:
  - a missing source event ID on the process-manager event-commanding path
    rejects before handler counters increment, state is stored, or follow-up
    commands dispatch; and
  - a blank source event ID on the process-manager event-producing path rejects
    before handler counters increment, state is stored, or follow-up events
    dispatch.
- `docs/architecture/README.md` now states the same README/API boundary
  guarantees:
  end-user handlers still accept generated domain messages, not framework
  `Event` envelopes; `@Apply` remains absent; and the seam does not introduce
  manual transaction controls.

## Round 3 Verification

- RED check:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/repository/repository-routing.test.ts`
  initially failed in the two new round-3 cases, proving the old
  process-manager event path invoked handlers before rejecting invalid source
  event IDs.
- GREEN check:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/repository/repository-routing.test.ts`
  passed (`1` file, `118` tests).
- `pnpm --config.verify-deps-before-run=false docs:check:generated`: passed
  with the existing TypeDoc warning that the configured `origin` git remote is
  invalid, and confirmed the expected export counts including `213`
  `@spine-ts/server` exports.
- `pnpm --config.verify-deps-before-run=false format:check`: passed after
  formatting the updated durable logs.
- `git diff --check`: passed.

## Round 4 Findings

- Code style/maintainability:
  - Reviewer `019f477e-7aea-72c3-b0e2-f092861ae0ed` reported no additional
    findings; lane is clean.
- Documentation completeness:
  - Reviewer `019f477e-9280-7340-ae73-196ff9178594` found one P3 review-log
    wording issue: the log overstated the architecture-doc update as exact
    README/API wording parity when the docs preserve the same guarantee in
    different wording.
- TypeScript/API docs:
  - Reviewer `019f477e-ab76-76c1-8508-fbbebc735829` reported no additional
    findings; lane is clean.
- Security:
  - Reviewer `019f477e-c6b3-7df2-9f44-3109e003aebb` reported no additional
    findings; lane is clean.
- Performance/reliability:
  - Reviewer `019f477e-f10c-7090-8b19-b0f61f9581db` reported no additional
    findings; lane is clean.

## Round 4 Required Lanes

| Lane                       | Reviewer ID                            | Status                    | Result                                 |
| -------------------------- | -------------------------------------- | ------------------------- | -------------------------------------- |
| Code style/maintainability | `019f477e-7aea-72c3-b0e2-f092861ae0ed` | Clean; closed             | No additional findings.                |
| Documentation completeness | `019f477e-9280-7340-ae73-196ff9178594` | Findings captured; closed | Soften over-strong review-log wording. |
| TypeScript/API docs        | `019f477e-ab76-76c1-8508-fbbebc735829` | Clean; closed             | No additional findings.                |
| Security                   | `019f477e-c6b3-7df2-9f44-3109e003aebb` | Clean; closed             | No additional findings.                |
| Performance/reliability    | `019f477e-f10c-7090-8b19-b0f61f9581db` | Clean; closed             | No additional findings.                |

## Round 4 Evidence

- The review log now says `docs/architecture/README.md` states the same public
  handler/API boundary guarantees as the README/API docs, instead of claiming
  exact wording parity.

## Round 5 Findings

- Code style/maintainability:
  - Reviewer `019f4783-a172-7c31-bc83-7038e4c692a4` found repository-specific
    error wording in the public `SignalMetadata` helper.
- Documentation completeness:
  - Reviewer `019f4783-bad1-7640-9f64-7b698b3ca8f4` confirmed the prior P3
    wording issue was fixed and found only stale top-level durable-log status
    lines.
- TypeScript/API docs:
  - Reviewer `019f4783-e104-7020-a3ea-fd5861c1bf15` reported no additional
    findings; lane is clean.
- Security:
  - Reviewer `019f4783-f61c-7183-9fa1-93207d79eca0` reported no additional
    findings; lane is clean.
- Performance/reliability:
  - Reviewer `019f4784-0bf2-7f00-aa63-5ee6140f389d` reported no additional
    findings; lane is clean.

## Round 5 Evidence

- `SignalMetadata` source command/event ID errors now use metadata/source-signal
  wording instead of repository execution wording.
- The top-level review and work log statuses now reference the current
  round-five cleanup state instead of stale round-three re-review state.
- The task file status now references the same round-five documentation-status
  cleanup state instead of the generic `in progress` state.

## Review Requirements

- Confirm the API remains small and avoids broad client SDK scope.
- Confirm deterministic test seams do not introduce process-wide mutable
  global state.
- Confirm end-user handler APIs still avoid framework `Event` envelopes,
  `@Apply`, and manual transactions.
- Confirm produced metadata follows the selected policy and preserves tenant
  and origin behavior.
- Confirm docs and durable logs match the actual implementation and
  verification evidence.
