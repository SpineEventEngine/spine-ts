# T-0115 Review Log

Status: Third targeted correction batch in implementation

## Scope

Reviews only T-0115 paired System Context assembly, strict bus boundaries,
shared subscription-runtime ownership, `persistSystemEvents()`, partial-build
cleanup, and terminal close. Later lifecycle/dispatch events, Message Board,
and broad documentation remain outside this task.

## Human Requirements

Reviewers must check the complete ledger in
`build-protocol/tasks/T-0115-system-context-cutover/TASK.md` and the exact T-0115
acceptance section in `build-protocol/planning/T-0113_SYSTEM_CONTEXT_PLAN.md`.

## Planned Assignments

| Concern                 | Existing role/profile   | Status                           |
| ----------------------- | ----------------------- | -------------------------------- |
| Style/maintainability   | `gpt-5.6-terra` / high  | Pending.                         |
| Documentation           | `gpt-5.6-luna` / medium | Pending if public claims change. |
| TypeScript/API docs     | `gpt-5.6-terra` / high  | Pending.                         |
| Performance/reliability | `gpt-5.6-terra` / high  | Pending.                         |

Every dispatch must pass model and reasoning explicitly. Actual metadata or the
immutable configured profile limitation must be recorded before acceptance.

## Frozen Review Package

- Base: `origin/main@8059a0a6`.
- Endpoint: `a1f4999a`.
- Immutable diff: `.superpowers/sdd/review-8059a0a6..a1f4999a.diff`.
- Mechanical evidence: 63 server test files and 1,896 tests pass; changed-code
  coverage is 94.49% statements, 92.06% functions, and 91.26% branches.
  Build/tooling typechecks, changed-file ESLint, TSDoc enforcement, API docs,
  audience checks, generated-Proto checks, Prettier, and `git diff --check`
  pass.

## Dispatched Review Wave

| Concern                 | Existing role                      | Expected profile        |
| ----------------------- | ---------------------------------- | ----------------------- |
| Style/maintainability   | `style_maintainability_reviewer`   | `gpt-5.6-terra` / high  |
| Documentation           | `documentation_reviewer`           | `gpt-5.6-luna` / medium |
| TypeScript/API docs     | `typescript_api_docs_reviewer`     | `gpt-5.6-terra` / high  |
| Performance/reliability | `performance_reliability_reviewer` | `gpt-5.6-terra` / high  |

The role, expected model, and expected reasoning are explicit in every child
dispatch. The documentation role has an immutable Luna/medium configuration;
the dispatch surface does not accept a separate Luna model override, so that
role configuration and this limitation are the recorded metadata until the
result returns. Reviewers are read-only and must assess the frozen endpoint.

## Review Results

- Style/maintainability: changes requested. Immutable configured role/profile
  `style_maintainability_reviewer`, `gpt-5.6-terra` / high; runtime
  self-introspection was unavailable and no mismatch was visible.
- Documentation: changes requested. Immutable configured role/profile
  `documentation_reviewer`, `gpt-5.6-luna` / medium; runtime
  self-introspection was unavailable and the role configuration is the
  authoritative metadata.
- TypeScript/API docs: changes requested. Immutable configured role/profile
  `typescript_api_docs_reviewer`, `gpt-5.6-terra` / high; runtime
  self-introspection was unavailable and no mismatch was visible.
- Performance/reliability: changes requested. Immutable configured
  role/profile `performance_reliability_reviewer`, `gpt-5.6-terra` / high;
  runtime self-introspection was unavailable and no mismatch was visible.

## Accepted Correction Batch

1. Removes the combined observer compatibility entry point that can default the
   System bus to the domain bus, and migrates tests/callers to explicit event or
   state observation.
2. Routes entity-state observation through the paired System Stand access
   boundary instead of retaining and void-reading an unenforced dependency.
3. Retains acquired EventBus handles during construction and closes their owned
   stores through those buses; the registry has exactly one cleanup owner after
   `SubscriptionRuntime` construction.
4. Coalesces ten-second background reconciliation ticks while one cycle is
   pending so a hung registry call cannot accumulate unbounded queued work.
5. Makes direct runtime close attempt registry closure exactly once even when
   observer detachment fails, aggregating independent failures and preserving
   the coalesced terminal outcome.
6. Documents that a directly constructed public `EventBus` is domain-only and
   rejects System schemas/dispatchers/events.

All findings are accepted because they enforce the frozen T-0115 contract and
were independently confirmed against the implementation. Documentation's
finding duplicates item 1 and does not create a seventh correction.

## Correction Assignment

- Existing role: implementer `/root/t0115_terminal_impl`.
- Ownership: the six accepted findings, focused RED/GREEN tests, task/review
  records, one correction commit, and immediate feature-branch push.
- Expected and explicitly dispatched model: `gpt-5.6-terra`.
- Expected and explicitly dispatched reasoning: `medium`.
- Runtime self-introspection is unavailable; the immutable configured role and
  explicitly dispatched profile are the available metadata.

## Accepted Correction Outcome — 2026-08-05

- Implementer: `/root/t0115_terminal_impl`, explicitly dispatched
  `gpt-5.6-terra` / medium. Runtime self-introspection is unavailable; the
  immutable configured profile is the available metadata and no mismatch was visible.
- Items 1–2: removed `observeSubscription`; runtime callers now choose explicit
  event observation or route state observation through `standAccess` and the paired System Stand.
- Item 3: construction retains EventBus handles and uses internal bus abort-close
  once ownership transfers; raw stores close directly only before bus construction,
  and a constructed runtime exclusively owns registry cleanup.
- Items 4–5: reconciliation ticks coalesce while a cycle is pending. Runtime close
  attempts registry closure after detach failure, aggregates failures, and keeps one
  terminal promise. Focused detach and timer tests cover these outcomes.
- Item 6: public EventBus TSDoc now declares direct construction domain-only and
  directs System events to the package-internal System factory.
- Focused evidence: six affected test files passed 266 tests; server typecheck,
  changed-file ESLint, TSDoc, Prettier, and diff checks passed.

## Targeted Re-review

- Correction base: `a1f4999a`.
- Correction endpoint: `0a187aed`.
- Immutable correction diff:
  `.superpowers/sdd/review-a1f4999a..0a187aed.diff`.
- Expanded evidence: 63 server test files and 1,897 tests pass. Diff-scoped
  coverage is 94.46% statements, 93.24% functions, and 90.52% branches. All
  deterministic pre-review gates pass.
- Style/maintainability, documentation, TypeScript/API docs, and
  performance/reliability are all substantively affected and are re-dispatched
  with the same explicit roles and expected profiles recorded above. Review is
  read-only and limited to resolution of the accepted batch plus regressions
  introduced by its correction diff.

## Targeted Re-review Results

- TypeScript/API docs: clean. Both accepted API findings are resolved; no
  public/internal contract regression was introduced.
- Documentation: clean. The observer contradiction is removed and EventBus
  claims match the corrected behavior.
- Style/maintainability: changes requested for two synchronous-throw cleanup
  holes in EventBus abort and SubscriptionRuntime terminal close.
- Performance/reliability: changes requested for EventBus abort cleanup and
  for incorrectly coalescing explicit consumer reconciliation with a possibly
  stale in-flight periodic snapshot.
- Immutable configured profiles remain the metadata recorded for the first
  wave; runtime self-introspection was unavailable and no mismatch was visible.

## Second Accepted Correction Batch

1. Coalesces periodic timer ticks only. Explicit `consume()` and explicit
   reconciliation requests queue one complete snapshot after any current
   cycle, so activation cannot resolve against stale pre-activation data.
2. Isolates synchronous EventStore/EventBus abort failures so every partial
   build cleanup hook still starts, the original construction failure remains
   primary, and cleanup failures are retained after all attempts.
3. Starts observer drain and registry close through independent promise thunks
   so a synchronous registry close throw cannot prevent drain, and both errors
   aggregate into the one coalesced terminal outcome.

All three findings are accepted because they preserve the frozen lifecycle and
activation guarantees. Style and reliability independently confirmed item 2.

## Second Correction Assignment

- Existing role: implementer `/root/t0115_terminal_impl`.
- Ownership: the three accepted findings, focused RED/GREEN tests, records,
  one correction commit, and immediate feature-branch push.
- Expected and explicitly dispatched model: `gpt-5.6-terra`.
- Expected and explicitly dispatched reasoning: `medium`.
- Runtime self-introspection is unavailable; the immutable configured role and
  explicit profile are the available metadata.

## Second Accepted Correction Outcome — 2026-08-05

- Implementer: `/root/t0115_terminal_impl`, explicitly dispatched
  `gpt-5.6-terra` / medium. Runtime self-introspection is unavailable; no
  visible profile mismatch occurred.
- Timer ticks now coalesce independently, while explicit reconciliation remains
  queued behind accepted work. Cleanup catches each synchronous abort failure,
  retains the original construction failure first, and attempts every remaining
  owner. Runtime terminal close starts drain and registry-close thunks without
  allowing a synchronous registry throw to suppress drain.
- Focused evidence: affected server tests passed 107 tests; server and tooling
  typechecks, changed-file ESLint, TSDoc, Prettier, and diff checks passed.

## Second Targeted Re-review

- Correction base: `0a187aed`.
- Correction endpoint: `6f949c6f`.
- Immutable correction diff:
  `.superpowers/sdd/review-0a187aed..6f949c6f.diff`.
- Style/maintainability and performance/reliability are substantively affected
  and re-dispatched with their previously recorded explicit roles and
  `gpt-5.6-terra` / high profiles. Documentation and API lanes remain clean and
  are not reopened because this correction changes no public claim or API.

## Second Targeted Re-review Results

- Style/maintainability: changes requested. Synchronous abort findings are
  resolved, but registry close now starts before observer detachment settles.
- Performance/reliability: changes requested. Explicit reconciliation and
  synchronous cleanup isolation are resolved; dispatcher-registration failure
  can still strand an unretained bus runtime, and raw-store cleanup can report
  the primary construction failure twice.
- Immutable configured reviewer profiles remain the accepted runtime metadata;
  self-introspection was unavailable and no mismatch was visible.

## Third Accepted Correction Batch

1. Settles observer detachment before starting registry close, while still
   attempting registry close after a detach failure and aggregating both.
2. Constructs and retains each domain/System EventBus before registering its
   dispatchers so a synchronous registration failure leaves an abortable bus.
3. Reports a raw-store cleanup failure after the primary construction failure
   exactly once, without nesting or duplicating the primary error.

These findings are accepted because they close the remaining frozen partial
build and terminal-order requirements without changing public scope.

## Third Correction Assignment

- Existing role: implementer `/root/t0115_terminal_impl`.
- Ownership: the three findings, focused injected-failure tests, records, one
  correction commit, and immediate feature-branch push.
- Expected and explicitly dispatched model: `gpt-5.6-terra`.
- Expected and explicitly dispatched reasoning: `medium`.
- Runtime self-introspection is unavailable; immutable role/profile metadata
  applies.

## Third Accepted Correction Outcome — 2026-08-05

- Implementer: `/root/t0115_terminal_impl`, explicitly dispatched
  `gpt-5.6-terra` / medium. Runtime self-introspection is unavailable; no
  visible profile mismatch occurred.
- Runtime drain completes before registry close starts, while its failure still
  permits and aggregates registry closure. EventBus instances are retained
  before dispatcher registration, and raw EventStore cleanup contributes its
  own failure once after the primary construction failure.
- Focused evidence: EventBus, context, runtime, and Stand tests passed 148
  tests; server/tooling typechecks, changed-file ESLint, TSDoc, Prettier, and
  diff checks passed.
