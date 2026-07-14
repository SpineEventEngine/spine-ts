# T-0039c Review Log

Status: Second coordinator pre-review finding assigned

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
