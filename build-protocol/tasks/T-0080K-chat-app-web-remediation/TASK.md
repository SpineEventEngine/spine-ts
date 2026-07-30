# T-0080K: Remediate the Chat application and web client

## Status

Planned.

## Parent And Dependencies

- Parent: T-0080.
- Depends on: T-0080F, T-0080G, T-0080H, and T-0080J.
- Required by: T-0080O.

## Objective

Complete TSDoc, name, and behavior-ownership remediation in the Chat server app
and React web client, and finish the family README against the stabilized code.

## Classification

High-risk where authentication, subscription, browser/React lifecycle, or
public example workflow code moves; otherwise standard.

## Human-Imposed Requirements Ledger

- Exported example declarations/public members have complete concise TSDoc.
- Callable summaries start with a third-person verb; parameters and non-void
  results are documented.
- Authored TypeScript names have at most four semantic components.
- Standalone behavior moves to cohesive named owners or receives an exact
  necessity disposition.
- Chat uses Projection entities and `client-react`.
- Best-effort subscription updates retain reconnect/re-query behavior and no
  completeness promise.
- The family README covers the complete application accurately.
- End-user API prohibitions remain enforced.
- No generated edit and no Spine JVM build.

## Ownership

- `examples/chat/app`, `examples/chat/web`, the family README, their tests, and
  their quality partitions.

## Acceptance Criteria

1. Owned authored TypeScript has zero TSDoc/name debt and exact standalone
   dispositions.
2. Moved behavior remains cohesive with existing application, auth, client, or
   React owners; no `Utils`/facade dumping ground is introduced.
3. Command, query, subscription, authentication/session, reconnect/re-query,
   React Strict Mode, browser transport, and server shutdown behavior remain
   equivalent.
4. End-user handler and API prohibition scans remain clean.
5. The family README commands work from the nested layout and accurately cover
   generation, start, browser use, auth topology, commands, queries,
   subscriptions, tests, and known best-effort limitations.
6. Focused app black-box, web unit/browser/interop, auth, and lifecycle tests
   pass.

## Exclusions

- No new Chat feature, auth provider, browser protocol, delivery guarantee, or
  deployment topology.
- No Proto/model rename after T-0080J except a blocker correction returned to
  that owner.
- No final repository-wide generation/full gate.

## Verification And Review

- Focused Chat app/web/browser/interop tests, clean Chat generation/build,
  end-user API scans, TypeDoc/docs command checks, lint/format, checker
  partitions, generated cleanliness, and `git diff --check`.
- All four canonical concerns are relevant because public prose and
  lifecycle-sensitive application/browser behavior are touched.

## Planning Dispatch

- T-0080K starts after pushed T-0080J merge commit `baef9891`.
- Because authentication, browser/React lifecycle, public example APIs, and
  subscription/reconnect behavior are high-risk boundaries, the existing
  requirements splitter is explicitly assigned `gpt-5.6-sol` / high.
- The splitter is read-only, may not spawn subagents, and must return an exact
  58-row TSDoc, 20-row standalone-function, one-row semantic-name, README,
  behavior-invariant, test, and bounded-writer plan.
- Both model and reasoning fields are explicit. Runtime metadata is recorded if
  exposed; otherwise the configured profile and limitation are recorded.

## Accepted Bounded Plan

- Exact debt is 58 TSDoc rows, 20 standalone-function rows, one semantic-name
  row, and zero Proto rows. Tests, ignored generated output, and `dist` are
  excluded; the tracked browser fixture remains authored production-fixture
  code.
- K1 owns only app authorization policy/source tests: 13 TSDoc and two
  standalone rows move into cohesive `ChatAuthorizationPolicy` behavior.
- K2 owns app runtime/validation, focused tests, app README, and exact interop
  startup consumers: 17 TSDoc, eight standalone, and one name row move into
  cohesive application and validation owners.
- K3 owns web UI/browser fixture, focused tests, and web README: 28 TSDoc and
  ten standalone rows move into cohesive view/post/fixture owners while named
  React components remain idiomatic function-valued declarations.
- K4 runs after integration and owns only the three K ledgers and family
  README. It targets exact zero debt; any retained function requires an exact
  checker-valid necessity reason.
- The three implementation writers use separate branches/worktrees with
  non-overlapping production ownership. Each is an existing implementer,
  explicitly `gpt-5.6-terra` / medium, may not spawn, and must preserve all
  auth/session, command, Projection, query/subscription, best-effort recovery,
  React Strict Mode, browser transport, shutdown, registry/package/generated,
  and end-user prohibition invariants.
- Baseline passes the canonical workspace build, 58 focused Vitest tests with
  loopback permission, and three local Playwright browsers. No model/Proto,
  registry, manifest, package-coordinate, lockfile, or workspace metadata
  change is permitted.
- All four canonical review concerns apply after one complete integration
  verification wave. Final security and Proto-specific review are N/A at this
  milestone because release readiness owns security and K changes no serialized
  contracts.
- Splitter runtime self-introspection was unavailable for the explicit
  Sol/high profile, with no visible mismatch.

## Implementation Wave Completion

- K1 changes only authorization policy/source tests. Room-filter evaluation is
  private policy behavior, malformed input fails closed, 13 TSDoc rows and two
  standalone rows are resolved, and build, 12 tests, lint, format, and diff
  checks pass.
- K2 changes only app runtime/validation, two focused tests, app README, and the
  allowed interop startup consumer. `ChatApplication` owns context/startup,
  `ChatMessageValidation` owns private checks, trivial `Any` wrappers are gone,
  the long name is shortened, and build, 29 tests, lint, format, generated
  cleanliness, and diff checks pass.
- K3 changes only web UI, browser fixture, and web README. Cohesive view/post/
  notice and fixture/queue owners replace standalone behavior while named React
  components remain. Build, 19 focused tests, three Playwright browsers,
  formatting, TypeDoc with zero errors, and diff checks pass.
- The only checker failures are the exact stale K rows intentionally reserved
  for K4 reconciliation. No writer changed Proto/model/registry/manifests/
  packages/lock/generated output or another writer's ownership.
- Every writer was explicitly `gpt-5.6-terra` / medium. Runtime
  self-introspection was unavailable, with no visible mismatch.

## Complete Review Wave Assignments

- Style/maintainability: existing reviewer, explicitly
  `gpt-5.6-terra` / high, across all three endpoints and cohesive ownership.
- Documentation: existing immutable reviewer configured
  `gpt-5.6-luna` / medium, across TSDoc and app/web guides.
- TypeScript/API docs: existing reviewer, explicitly
  `gpt-5.6-terra` / high, across public app/web contracts and compatibility.
- Performance/reliability: existing reviewer, explicitly
  `gpt-5.6-terra` / high, across authorization bounds, server lifecycle,
  subscriptions, abort fencing, Strict Mode, browser transport, and shutdown.
- All reviewers are read-only, inspect the three isolated worktrees as one
  complete wave, and may not spawn subagents. Runtime metadata or its honest
  limitation is required before accepting results.

## Complete Review Wave Findings

- Documentation finds two P2 corrections: K1 `authorize()` must describe its
  boolean result rather than implying conditional resolution, and exported K3
  `ChatBrowserApp` needs explicit `@param props` and `@returns`.
- Style/maintainability finds one P2 correction: replace the static,
  single-method `ChatSubscriptionNotice` facade with an idiomatic named
  function-valued React component.
- TypeScript/API and performance/reliability are clean. Public replacements,
  registry/contracts, authorization bounds, concurrency, Projection delivery,
  lifecycle, subscription, fencing, browser, and shutdown behavior are
  accepted.
- One correction batch returns to the original K1 and K3 existing implementers,
  each explicitly `gpt-5.6-terra` / medium. K2 remains closed. Only
  documentation re-review applies to K1; documentation and
  style/maintainability re-review apply to K3.
- Reviewer runtime introspection was unavailable for configured Luna/medium and
  Terra/high profiles, with no visible mismatch.

## Correction Batch Completion

- K1 now documents that authorization resolves to true when allowed and false
  otherwise. Twelve policy tests, formatting, source TSDoc, and diff checks
  pass with no runtime change.
- K3 now documents `ChatBrowserApp`'s `props` and `ReactElement` result and uses
  a named function-valued `ChatSubscriptionNotice` React component with
  unchanged status/alert DOM behavior. Typebuild, 18 component tests,
  formatting, source TSDoc, and diff checks pass.
- Both correction writers were the original existing implementers, explicitly
  Terra/medium. Runtime introspection was unavailable with no mismatch.
- Re-review assigns immutable Luna/medium documentation across K1/K3 and
  explicit Terra/high style/maintainability for K3 only. API and reliability
  remain closed.

## Endpoint Acceptance

- Documentation re-review is clean for K1 and K3.
- Style/maintainability re-review is clean for K3's named notice component.
- All four canonical review concerns are closed across the complete
  implementation wave. Stale K ledgers and the family README remain K4
  responsibilities after integration.
- Reviewer runtime introspection remained unavailable for configured
  Luna/medium and Terra/high profiles, with no visible mismatch.
- K1, K2, and K3 are accepted for scoped commit, immediate branch push, and
  integration into `task/T-0080K-chat-app-web`.
