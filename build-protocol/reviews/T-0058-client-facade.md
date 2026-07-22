# T-0058 Client Facade Review

Status: Accepted — all required concerns clean

Baseline: `9a247c77`

## Required Concerns

- TypeScript/API: public generics, actor/tenant scoping, stable command/query
  outcomes, declaration isolation, frozen-wire compilation, and no server
  implementation leakage.
- Documentation: actual compile-covered public construction, posting, querying,
  outcome/error handling, context, ownership, cancellation, and close examples.
- Style/maintainability: small client surface, JVM concept names where useful,
  no premature T-0059 subscription framework, and clear transport/lifecycle
  ownership.
- Performance/reliability: cancellation, in-flight tracking, close races,
  exactly-once owned transport cleanup, supplied ownership, observation leaks,
  immutable concurrent context, and bounded work.
- Security: N/A unless implementation adds a new credential, dynamic endpoint,
  metadata, or deserialization boundary beyond the existing validated frozen
  service transport. T-0067 retains final Wave 1 security review.

## Specialist Assignment Gate

- Existing `typescript_api_docs_reviewer`: explicit `gpt-5.6-terra` / `high`.
- Existing `documentation_reviewer`: immutable `gpt-5.6-luna` / `medium`.
- Existing `style_maintainability_reviewer`: explicit `gpt-5.6-terra` / `high`.
- Existing `performance_reliability_reviewer`: explicit
  `gpt-5.6-terra` / `high`.
- Reviewers are read-only, return all P0-P3 findings or CLEAN in one wave, and
  may not spawn children. Runtime metadata is recorded when exposed;
  otherwise the immutable configured role/profile and limitation are recorded.

## Dispatch Record

- TypeScript/API: existing `typescript_api_docs_reviewer`, explicitly
  dispatched as `gpt-5.6-terra` / `high` after deterministic gates passed.
- Documentation: existing immutable `documentation_reviewer` role selected as
  `gpt-5.6-luna` / `medium`. The desktop dispatch surface rejected Luna as a
  free-form model override, so the immutable role selection is the explicit
  configured profile; no fallback was visible.
- Style/maintainability and performance/reliability retain the explicit
  assignments above and are queued behind the execution surface's active-agent
  capacity. This sequencing does not split the review wave; findings will be
  aggregated only after all four lanes return.

## Pre-review Evidence

- Native client tests: 6 files / 33 tests passed, including the real loopback
  command/query integration.
- Generated typecheck, lint/cleanup, TypeDoc/API inventory (33 client exports),
  Proto generated-clean check, formatting, and `git diff --check` passed.

## Specialist Wave Results

- TypeScript/API (`gpt-5.6-terra` / `high`): 3 P1 and 3 P2 findings.
  Runtime self-introspection was unavailable; no fallback was visible.
- Documentation (immutable `gpt-5.6-luna` / `medium`): 2 P1 and 3 P2
  findings. Runtime self-introspection was unavailable; no fallback was visible.
- Style/maintainability (`gpt-5.6-terra` / `high`): 4 P1 and 2 P2
  findings, including overlap with API and documentation. Runtime
  self-introspection was unavailable; no fallback was visible.
- Performance/reliability (`gpt-5.6-terra` / `high`): 4 P1 and 2 P2
  findings, including overlap with API. Runtime self-introspection was
  unavailable; no fallback was visible.
- P0/P3: none. The orchestrator deduplicated the complete wave before returning
  one correction batch.

## Aggregated Correction Batch

1. Validate `Ack.messageId` as the posted `CommandId` and reject missing,
   malformed, or mismatched IDs with `ClientProtocolError`.
2. Reuse one actor context per post and expose `events` only on an observed
   `ok` result, with public overloads making that handle required.
3. Hide direct `ClientRequest` construction from the public declaration.
4. Make public outcome messages, query states/versions, and observed
   message/context pairs deeply immutable.
5. Preserve activation transport failures for iterator consumers; handle
   normal activation completion; track activation and cancellation through
   close; prevent late subscribe resolution from re-registering a closed
   stream; keep caller abort effective after a successful observed post.
6. Enforce bounded single-consumer iteration and fail explicitly on matching
   event overflow instead of silently dropping events.
7. Add behavior tests for all corrected malformed-ID, refusal, activation
   terminal/error, abort/subscribe/cancel/close race, overflow, filtering,
   owned-session exactly-once, and supplied-transport ownership cases.
8. Correct README/user-guide contradictions, placeholders/imports, abort
   semantics, and document observed-post iteration/cancellation/automatic
   cleanup with actual exported snippets.

## Correction Ownership Gate

- The existing `implementer` context retains exclusive ownership, explicitly
  configured `gpt-5.6-terra` / `medium`. It receives this single batch, follows
  RED/GREEN, and may not commit, push, merge, edit review dispositions, or spawn
  children. Runtime metadata will be recorded if exposed; otherwise the
  immutable role/profile and limitation will be recorded.

## Focused Re-review And Second Batch

- API: five findings resolved; one P1 remains because exported
  `ClientPostOptions` cannot be passed as a variable to either `post()`
  overload.
- Documentation: all original findings resolved; one P1 and one P2 remain in
  README example sequencing and the missing facade-query example.
- Style/maintainability: original lifecycle/result/docs findings resolved; two
  P1, one P2, and one P3 remain for mutable typed-array fields, incomplete
  automatic-abort/cancel-close assertions, the same options-type issue, and a
  misleading duplicate test name.
- Performance/reliability: all original findings resolved; one P1 remains for
  unbounded remote `Cancel`, swallowed cleanup failures, and owned-session
  shutdown ordering.
- Each focused reviewer retained its configured profile. Runtime
  self-introspection remained unavailable and no fallback was visible.

The same existing `implementer`, explicitly `gpt-5.6-terra` / `medium`, owns
one final narrow batch: make the exported options usable without weakening
observed tuple inference; provide actual deep immutability for byte fields;
prove automatic abort and cancel/close coordination; bound/cancel remote cleanup
with documented, consistent failure propagation; remove the misleading test;
and repair the two README examples. No unrelated refactor or T-0059 work is
permitted.

## Final Narrow Re-review

- API: CLEAN. Both general options variables and tuple-observation inference
  compile with the intended result types; declarations expose no internals.
- Documentation: CLEAN. Sequential lifecycle, observed posting, facade query,
  and cancellation-bound/failure prose are actual.
- Runtime byte immutability and all earlier lifecycle corrections are clean.
- Style/reliability returned one last lifecycle batch: automatic-abort cleanup
  failures must remain reportable to later client close without retaining a
  terminal event; active late-cleanup promises must be removed after settlement
  while a bounded failure summary is preserved; and a regression must start
  explicit cancel and concurrent close and prove close waits before owned
  teardown.

The same `implementer` (`gpt-5.6-terra` / `medium`) owns only this bounded-state
and regression correction. No API, documentation, package, or unrelated
refactor is permitted.

Final reliability re-review confirms bounded cleanup retention and concurrent
cancel/close accounting, but found one P1 primary-error precedence race during
multi-schema observation startup: failed cleanup can replace the caller abort.
The same implementer owns only preserving the primary startup/abort error while
tracking cleanup failure for later close, plus a two-schema regression.

## Final Disposition

- TypeScript/API: CLEAN after focused re-review. General and observed option
  inference, acknowledgement validation, result shape, declaration isolation,
  and primary-error behavior are accepted.
- Documentation: CLEAN after focused re-review. README and user-guide examples,
  ownership, abort, observation, query, timeout, and cleanup-failure claims are
  actual.
- Style/maintainability: CLEAN after evidence correction. Runtime immutability,
  cohesive options, bounded helpers, test naming, and cancel/close coverage are
  accepted.
- Performance/reliability: CLEAN after final focused re-review. Cancellation,
  activation, overflow, single-consumer bounds, owned/supplied lifecycle,
  bounded cleanup state, multi-schema abort precedence, and resource release are
  accepted.
- Security: N/A for this packet. It adds no credential or metadata handling and
  uses a caller-selected standard Connect endpoint/transport. The Wave 1 final
  network/security boundary review remains T-0067.
- All reviewer assignments used the recorded existing roles and explicit
  profiles. Runtime self-introspection was unavailable in every lane; no visible
  fallback occurred.

Final evidence: native client suite 7 files / 60 tests; generated/tooling
typecheck; lint/cleanup; TypeDoc/API inventory with 35 client exports; formatting;
Proto generated-clean; declaration isolation; and `git diff --check` all passed.
