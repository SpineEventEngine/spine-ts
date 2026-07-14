# T-0039c Review Log

Status: Complete — remotely synchronized

## Review Scope

- Baseline: `aaa31116`.
- Review the framework user guide and T-0039c records only, plus any narrowly
  justified focused guide assertion.
- Ignore historical superseded text unless current T-0039c records or changed
  guide prose claim it as active behavior.

## Concern Dispositions

- Style/maintainability: relevant for journey organization, duplication,
  vocabulary, and maintainable boundaries.
- Documentation completeness: relevant for the complete install-to-test user
  journey, commands, links, examples, exclusions, and current truth.
- TypeScript/API docs: relevant for imports, declarations, decorator/handler
  contracts, snippet types, public surfaces, compatibility, and internal leaks.
- Performance/reliability: relevant for startup/close ordering, ownership,
  asynchronous acknowledgement, delivery/replay guarantees, bounded behavior,
  storage scope, and ZeroMQ limitations.
- Security: deferred to T-0041 by protocol.

## Expected Profiles

- Documentation: existing reviewer, explicit `gpt-5.6-luna` / medium.
- Style, TypeScript/API docs, and performance/reliability: existing reviewers,
  explicit `gpt-5.6-terra` / high.
- All reviewers will be read-only/no subagents and receive one bounded concern
  over one immutable baseline-to-endpoint package.

## Author Assignment

- Existing implementer, explicit immutable `gpt-5.6-terra` / medium, no
  subagents.
- Author must implement the completion-plan journey with public package imports,
  end-user-safe handler examples, current lifecycle/testing/delivery semantics,
  and explicit exclusions; no reviewer result exists yet.

## Author Handback

- Candidate endpoint changes only `docs/USER_GUIDE.md` and these T-0039c
  records. The guide is now an eleven-step new-user journey and omits internal
  application controls, historical slice chronology, and an uncompleted
  multi-process-example claim.
- Review evidence is grounded in current public documentation and source:
  bare decorator/registry rules; `buildAsync()` registry loading; environment
  ownership and `RunningServer.close()` order/retry; service acknowledgements,
  queries, subscriptions, refusals; fixtures and real Connect/gRPC clients;
  delivery and ZeroMQ limits.
- All consumer-generated package imports are explicitly substitutions. Client
  and fixture fragments declare their required generated service message
  fixtures rather than presenting incomplete setup as copy-paste runnable.
- Pre-review validation is recorded in the work log. No reviewer has run and no
  author review finding exists. Full `pnpm verify`, review-lane dispatch,
  acceptance, commit, merge, push, and cleanup remain coordinator-owned.
- Immutable author profile actually used: implementer, `gpt-5.6-terra` /
  medium; no subagents.

## Coordinator Pre-Review Findings

- `2026-07-14T13:15:07Z`: no reviewer has run. The local pre-review gate
  accepted one guide coherence finding and one stale current-status finding.
- Guide coherence: the shown Protobuf entity state and the handler fragment's
  state schema, ID generic, and extra entity schemas do not agree, despite the
  fragment being described as typeable. Correct the current example as one
  coherent public-package consumer path.
- Status coherence: update only the completion plan's three active-status
  statements from T-0039a to the factual T-0039c pre-review-fix state.
- Complete batch assigned to the same existing implementer with explicit
  immutable `gpt-5.6-terra` / medium, no subagents, and the bounded expanded
  write scope recorded in the task/work logs. The four specialist review lanes
  remain pending until the fix and renewed coordinator pre-review gate pass.

## Pre-Review Fix Implementation

- The candidate guide now declares every entity state, command, and event used
  by the handler fragment, and the generated imports/classes use those exact
  message and schema names with generated `TaskId` entity IDs.
- The three assigned completion-plan statements now identify T-0039c as the
  current framework-user-guide pre-review-fix frontier; historical and later
  packet text was not changed.
- No reviewer has run. Focused fix verification passed before renewed
  coordinator pre-review.

## Pre-Review Fix Handback

- The complete accepted pre-review batch is implemented across the five
  authorized paths. The guide coherence finding is addressed by one exact
  modeled/generated vocabulary and generated-message ID generics; the status
  finding is addressed by only the three assigned completion-plan statements.
- Exact-path format, model/import/identifier, prohibited end-user,
  future-policy, link, status/frontier, docs/API, generated-clean, scope, and
  diff-integrity checks passed. Full `pnpm verify` and all four specialist
  review lanes remain pending coordinator work.
- Remaining uncertainty is limited to the explicitly illustrative consumer
  packages, which cannot be compiled in this workspace; their required
  substitutions and fixture boundary remain explicit.
- Actual immutable profile: existing implementer, `gpt-5.6-terra` / medium; no
  subagents.

## Second Coordinator Pre-Review Finding

- `2026-07-14T13:22:15Z`: reviewer dispatch remains blocked. The renewed local
  audit accepted one documentation/API-usability finding: all three handler
  families must demonstrate state mutation through the supported protected
  draft-state seam so the modeled state, query, and subscription journey is
  behaviorally meaningful.
- The same existing implementer receives this complete one-item batch with
  explicit immutable `gpt-5.6-terra` / medium and no subagents. No specialist
  reviewer has run yet.

## Second Pre-Review Fix Handback

- The guide now demonstrates aggregate, process-manager, and projection state
  updates through the supported protected draft-state seam and uses
  framework-provided routed identity throughout. No transaction/routing/internal
  control leaked into application code.
- Author evidence passed and the actual immutable profile remained existing
  implementer, `gpt-5.6-terra` / medium; no subagents.

## Coordinator Pre-Review Closure

- Fresh local format, docs/API, generated-clean, status, scope, future-policy,
  prohibited end-user/internal API, and diff-integrity checks are clean.
- All four canonical concerns remain relevant as recorded above. Security stays
  deferred to T-0041. The coordinator will freeze one literal implementation
  endpoint, record exact assignments, and dispatch the four bounded lanes only
  after that commit exists.

## Review Wave 1 Assignment

- Endpoint `66a491e12972f942190cb1fd1ab83d4a89babf88`; literal baseline `aaa31116`;
  package `.superpowers/sdd/review-aaa31116..66a491e1.diff`, four commits,
  `125348` bytes.
- Style/maintainability role: explicit immutable `gpt-5.6-terra` / high.
- Documentation completeness role: explicit immutable `gpt-5.6-luna` /
  medium.
- TypeScript/API docs role: explicit immutable `gpt-5.6-terra` / high.
- Performance/reliability role: explicit immutable `gpt-5.6-terra` / high.
- All dispatches are read-only, no-subagent, package/task-ledger bounded, and
  must report actual immutable runtime model/reasoning plus a task-relevant
  skill applicability check. They must ignore historical superseded text unless
  current T-0039c records, completion-plan live status, or changed guide prose
  claim it as active behavior.

## Review Wave 1 Result

- Style/maintainability `019f60d2-56b4-7851-8605-72056b591ce3`: CLEAN,
  actual immutable `gpt-5.6-terra` / high; closed.
- Documentation `019f60d2-5a9e-7a51-800c-310972b9955d`: CLEAN, actual
  immutable `gpt-5.6-luna` / medium from execution-surface role metadata;
  closed. Its generic `GPT-5` self-label and follow-up `UNAVAILABLE` are not
  runtime metadata and do not override the immutable role configuration plus
  explicit dispatch.
- TypeScript/API `019f60d2-613d-7470-a11c-6cd17f804896`: one P2 for omitting
  mandatory `commands.proto` / `events.proto` source-file separation; actual
  immutable `gpt-5.6-terra` / high from execution-surface role metadata;
  closed.
- Performance/reliability `019f60d2-5df5-7932-aa3e-6de9375c4c64`: three P2
  findings for missing query limit maximum, inactive/active subscription
  bounds and close behavior, and the absence of autonomous delivery retry;
  actual immutable `gpt-5.6-terra` / high from execution-surface role metadata;
  closed.
- All findings are confirmed against current canonical/runtime evidence and
  form one accepted batch. Same existing implementer assigned explicit
  immutable `gpt-5.6-terra` / medium, no subagents. Affected review concerns
  will rerun against a new literal endpoint after focused verification.

## Review Wave 2 Assignment

- Literal baseline `aaa31116`; endpoint
  `03d47b93e663c5cc15a2aedfbd336497de0160d5`; package
  `.superpowers/sdd/review-aaa31116..03d47b93.diff`, seven commits, `139142`
  bytes.
- Style/maintainability: existing explicit immutable `gpt-5.6-terra` / high.
- Documentation completeness: existing explicit immutable `gpt-5.6-luna` /
  medium.
- TypeScript/API docs: existing explicit immutable `gpt-5.6-terra` / high.
- Performance/reliability: existing explicit immutable `gpt-5.6-terra` / high.
- Every dispatch is read-only/no-subagent and must report findings or CLEAN,
  skill applicability, and actual immutable role metadata. The execution
  surface's immutable role metadata is the authoritative actual-profile source.
  Prompts repeat the historical-superseded-text rule and current exclusions.

## Second Pre-Review Fix Implementation

- The candidate handler fragment now mutates aggregate, process-manager, and
  projection draft state through the supported protected API using the exact
  modeled schemas and framework-provided entity identity.
- No manual transaction or target-routing ownership moved into application
  code. Focused second-fix verification passed before renewed coordinator
  pre-review.

## Second Pre-Review Fix Handback

- The single accepted finding is addressed in the guide and all three durable
  records. Every shown entity family now demonstrates a meaningful,
  deterministic state replacement through the protected draft API before its
  generated return or subscriber completion.
- Exact-path formatting, state/model/API, public-import, prohibited ownership,
  future-policy, status, docs/API, generated-clean, scope, and diff-integrity
  checks passed. No specialist reviewer has run; full `pnpm verify` and review
  remain coordinator work.
- The pre-existing three-statement completion-plan diff was inspected and not
  altered by this fix.
- Actual immutable profile: existing implementer, `gpt-5.6-terra` / medium; no
  subagents.

## Review Wave 1 Fix Implementation

- The candidate now addresses all four accepted P2 items: mandatory Proto file
  separation, query limit maximum, bounded inactive/active subscription
  behavior, and explicit absence of autonomous failed-delivery retry.
- No plan, runtime, Proto source, package, or example change was made. Focused
  fix verification passed before affected-lane rereview.

## Review Wave 1 Fix Handback

- The complete accepted batch is addressed across the guide and three records.
  The Proto-file P2 and all three reliability P2 findings have focused passing
  evidence in the work log.
- Exact-path formatting, Proto filename/import/model, query/subscription/
  delivery wording, end-user prohibition, future-policy, status, docs/API,
  generated-clean, scope, and diff-integrity checks passed.
- Style and documentation lanes were already clean. TypeScript/API and
  performance/reliability affected-lane rereview remain coordinator work; no
  reviewer ran in this implementation context.
- Actual immutable profile: existing implementer, `gpt-5.6-terra` / medium; no
  subagents.

## Review Wave 2 Result

- Style `019f60de-6e1b-7443-84ee-471c15b0e620`: CLEAN, actual immutable
  `gpt-5.6-terra` / high; closed.
- Documentation `019f60de-724a-7551-a6d5-d83e73ed80f1`: CLEAN, actual
  immutable `gpt-5.6-luna` / medium; closed.
- TypeScript/API `019f60de-75d5-7293-8c9c-608e6b783e95`: one P2 for the
  `SubscriptionService.Cancel` call shape; actual immutable
  `gpt-5.6-terra` / high; closed.
- Performance/reliability `019f60de-79b5-75e0-874d-a6e9faaec566`: two P2
  findings for ambiguous durable projection-handler scope and missing ZeroMQ
  retry/restart limitations; actual immutable `gpt-5.6-terra` / high; closed.
- Complete confirmed batch assigned to the same existing implementer with
  explicit immutable `gpt-5.6-terra` / medium and no subagents. Another literal
  package and affected rereview follow focused coordinator verification.

## Review Wave 2 Fix Implementation

- The guide now passes the returned `Subscription` message to `Cancel` in an
  explicit cleanup path instead of describing cancellation as ID-only.
- Durable delivery wording now identifies projection `@Subscribe` handler
  invocation and explicitly excludes process-local `SubscriptionService`
  client streams from that guarantee.
- ZeroMQ limitations now match the transport package contract: no
  transport-owned retry loops and no retry or restart guarantee.

## Review Wave 2 Fix Handback

- The complete three-item batch is addressed in the guide and mirrored across
  all three T-0039c records. No plan, runtime, Proto source, package, or example
  change was made.
- Focused cancellation, delivery-boundary, ZeroMQ, prohibited API,
  future-policy, status, docs/API, generated-clean, scope, and diff-integrity
  checks are recorded in the work log. Full `pnpm verify` and affected-lane
  rereview remain coordinator-owned.
- Actual immutable profile: existing implementer, `gpt-5.6-terra` / medium;
  no subagents. Skills used: receiving-code-review, doc-coauthoring, and
  verification-before-completion.

## Review Wave 3 Assignment

- Literal baseline `aaa31116`; endpoint
  `6caf1c8ebb624a6d996d82de5c2cb85db59a2799`; package
  `.superpowers/sdd/review-aaa31116..6caf1c8e.diff`, ten commits, `151555`
  bytes.
- TypeScript/API docs: existing explicit immutable `gpt-5.6-terra` / high,
  bounded to the cancellation message/call shape and public client contract.
- Performance/reliability: existing explicit immutable `gpt-5.6-terra` / high,
  bounded to durable handler scope versus process-local streams and ZeroMQ
  retry/restart limits.
- Both are read-only/no-subagent and receive the full ledger, current
  exclusions, and historical-superseded-text rule. Style/documentation retain
  their Wave 2 CLEAN dispositions with the concrete unaffected rationale above.

## Review Wave 3 Result

- TypeScript/API `019f60ed-904f-7962-aeb5-0227783b0d3c`: CLEAN at actual
  immutable `gpt-5.6-terra` / high; closed. The guide passes the returned
  `Subscription` message to `Cancel`, matching generated Proto and real Connect
  tests, with no internal client/API leak.
- Performance/reliability `019f60ed-8c20-75a1-a624-1ed3a59e7763`: CLEAN at
  actual immutable `gpt-5.6-terra` / high; closed. Durable handoff is scoped to
  server entity handlers, client streams remain process-local/bounded, and
  ZeroMQ has no retry loop or retry/restart guarantee.
- Final concern dispositions: style CLEAN (Wave 2), documentation CLEAN (Wave
  2), TypeScript/API docs CLEAN (Wave 3), performance/reliability CLEAN (Wave
  3). Every reviewer used no subagents and is closed. Security is deferred to
  T-0041. Final native verification is the remaining task acceptance gate.

## Final Acceptance Gate

- Native full `pnpm verify` exited `0` on `2026-07-14T14:08:31Z`: both ordinary
  and coverage runs passed `71` files / `1,642` tests; branch coverage is
  `90.12%` and all other coverage dimensions exceed it.
- All static, docs/API, Proto, and generated-clean phases passed. No unresolved
  review finding remains and every participant is closed. Task integration and
  remote closure remain coordinator-owned.

## Integration Gate

- Merge commit `207ba2bc2b5896fd76dff1feed85fa8bae5dc20c` integrates the clean
  reviewed task into `main`.
- Native post-merge full verification exited `0` with the same `71` files /
  `1,642` tests and `90.12%` branch coverage. No review lane or participant was
  reopened. Remote synchronization and clean worktree removal remain.

## Remote Closure

- Confirmed remote task ref
  `2028ffb951f23f55b499d80446ce63778aafda06` and verified integration `main`
  ref `6ac65fea85c54f2cccb34dfab3e1e223f7e4758b` before this evidence-only
  closure record.
- All review concerns remain clean, every participant is closed, and no new
  review is needed for remote evidence or mechanical clean-worktree removal.
