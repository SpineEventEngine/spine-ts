# T-0225: Command-to-Command Delivery

Status: Final contract correction in progress
Baseline: `origin/master@e37ec8a1fed84f11e0df07c78846d5607a698ede`
Branch: `fix-command-to-command-delivery`
Worktree: `/Users/armiol/development/experiments/spine-ts-fix-command-to-command-delivery`

## Objective

Provide JVM-aligned delivery for decorated Entity and standalone signal
handlers. A Process Manager `@Command` method with a Command input performs
command substitution through the Command Bus. Standalone assignees, commanders,
event reactors, and event subscribers participate through generated metadata.
Aggregates and Projections reject `@Command` methods.

## Acceptance criteria

1. A generated Process Manager `@Command` method with a Command input is
   registered as the effective handler for that Command type.
2. A client-posted Command reaches that method instead of returning
   `UNSUPPORTED_COMMAND`.
3. A Command posted by server context reaches the same method.
4. A command substitution returns one or more Commands using the supported return
   shapes; zero output remains invalid.
5. Process Manager command substitution works, including an optional
   `CommandContext` parameter. Aggregate and Projection repositories reject all
   `@Command` handlers.
6. The Entity state commit succeeds before substituted Commands are posted.
7. Failure before commit does not publish substituted Commands or partially
   persist state.
8. Actor, tenant, origin, and causal metadata remain correct for each produced
   Command.
9. One Command input type has one effective receptor: either one `@Assign`
   method or one command-input `@Command` method. Duplicate or mixed receptors
   fail during readiness validation.
10. Event-input and rejection-input `@Command` handlers keep their existing
    event-side behavior.
11. Routing continues to support default and custom routes, composite IDs, and
    tenant isolation.
12. Public TSDoc and runtime architecture documentation describe the same
    command-substitution contract.
13. Domain-correct Protobuf fixtures and focused end-to-end tests reproduce the
    original client and context-posting failures before production code changes.
14. Export `AbstractAssignee`, `AbstractCommander`, `AbstractEventReactor`, and
    `AbstractEventSubscriber` as nominal base classes for decorated standalone
    handlers.
15. Standalone handler registration matches JVM capabilities: assignees receive
    Commands and produce Events; commanders receive Commands, Events, or
    rejections and produce Commands; reactors receive Events or rejections and
    produce Events or no signal; subscribers receive Events, rejections, or
    Entity states and produce no signal.
16. Register a commander through `addCommandDispatcher()` and install both its
    command and event sides exactly once. Add `addAssignee()` for standalone
    assignees. Reactors and subscribers use `addEventDispatcher()`. Existing raw
    dispatcher registration remains supported.
17. Replace the versioned Entity-only generated registry with one unversioned
    `receivers` collection containing Entity and standalone receiver records.
    Old `{ version, entities }` registries fail with an instruction to regenerate.
18. Match a registered standalone instance to generated metadata by exact
    constructor. The registry never constructs application handler instances.
19. A standalone state subscriber receives exact-schema state changes through
    the System Event Bus. It does not use a Repository, Entity Inbox, or the
    Integration Broker. State subscriptions reject `External<State>` and
    `@Where`.
20. A produced Command re-enters the Command Bus and a produced Event re-enters
    the Event Bus after the current handler or transaction succeeds. Same-bus
    work is admitted without awaiting the currently executing queue.
21. `BoundedContext` does not retain, expose, or report produced-signal dispatch
    failures. A separate internal signal publisher contains detached failures,
    logs them, drains admitted work during close, and prevents unhandled promise
    rejections.
22. Remove Aggregate command-substitution execution and tests. Keep defensive
    Aggregate and Projection rejection in analysis, ingestion, metadata, and
    runtime binding.
23. Remove registry v3/v4 compatibility and obsolete command-substitution
    aliases, tests, and documentation.
24. Refactor touched large modules into cohesive classes/modules. Do not add a
    general cleanup unrelated to this correction.

## Classification and estimate

High risk: this changes shared command registration, Entity execution,
transaction ordering, causal metadata, and a public decorator contract.

Estimated active work: 18–24 uninterrupted agent-hours and 12–16 elapsed hours,
plus 1–3 hours of CI or release-gate waiting. This includes implementation,
focused coverage, one parallel specialist-review wave and corrections, version
validation, one release gate, commits, pushes, and reporting.

## Execution and verification

- Use behavior-first TDD and preserve the failing-test output before changing
  production code.
- Retain JVM command-substitution semantics: command-input
  `@Command` is a command receptor, while event/rejection-input `@Command` is an
  event receptor.
- Run focused handler, repository, service, and metadata tests plus
  changed-source coverage before review.
- Run one complete relevant review wave after mechanical convergence.
- Run `verify:release` once after review convergence because this changes shared
  server runtime and public-contract behavior.
- Select the next common unused snapshot version. Put only workspace top-level
  version changes in the commit named exactly `Bump version -> <version>`;
  dependency pins, lockfile, generated metadata, and release expectations belong
  in separate commits.
- Run the completed architecture pass only again if implementation reveals a
  material contract conflict.

## Agent routing

The Codex Desktop surface supports explicit model and reasoning selection.
Subagents may not spawn subagents.

- Implementation owner: existing `implementer` role; generated registry and
  analyzer, handler metadata and readiness, standalone runtime, Bounded Context
  assembly, Process Manager substitution, focused tests, narrow documentation,
  and task records; model explicitly `gpt-5.6-terra`, reasoning explicitly
  `medium`.
- Mechanical verification: orchestrator-dispatched function; focused commands
  and output classification; model explicitly `gpt-5.6-luna`, reasoning
  explicitly `medium` when classification needs judgment.
- Correctness/compatibility review: existing specialist review function;
  registration uniqueness, transaction ordering, metadata, routing, and JVM
  parity; model explicitly `gpt-5.6-terra`, reasoning explicitly `high`.
- Style/maintainability review: existing `style_maintainability_reviewer`;
  affected runtime and tests; model explicitly `gpt-5.6-terra`, reasoning
  explicitly `high`.
- TypeScript/API documentation review: existing
  `typescript_api_docs_reviewer`; generated/public handler contracts and TSDoc;
  model explicitly `gpt-5.6-terra`, reasoning explicitly `high`.
- Performance/reliability review: existing
  `performance_reliability_reviewer`; transaction, publication, Inbox, retry,
  and lifecycle behavior; model explicitly `gpt-5.6-terra`, reasoning
  explicitly `high`.
- Reader documentation review: existing `documentation_reviewer`; changed
  architecture and user-facing claims; immutable configured profile
  `gpt-5.6-luna`, reasoning `medium`.
- Security: N/A as a separate lane because no credential, authorization, or new
  remote-input boundary is introduced. Rejection and malformed-command behavior
  remain correctness concerns.

Runtime self-introspection may be unavailable. In that case, explicit dispatch
fields and the immutable role profile are the accepted metadata evidence.

## Human-Imposed Requirements Ledger

- Avoid `own` and its derived forms unless they are necessary for technical
  accuracy. This applies to code, documentation, review records, and chat
  responses; name the responsible class, module, package, agent, or person
  directly when possible.
- Work from current official `origin/master` on a regular feature branch with no
  `codex/` prefix.
- Never modify or push official `master` directly.
- Push every feature-branch commit to official `origin` immediately.
- Do not create or merge a pull request without explicit human instruction.
- Never rewrite the published feature branch.
- Preserve event-to-command behavior while fixing command-to-command delivery.
- Use domain-correct Protobuf Command fixtures: never substitute entity state
  messages or framework envelopes for command inputs or outputs.
- Command substitutions return one or more Commands and are the unique
  effective receptor for their input; event/rejection-input `@Command` handlers
  remain EventBus reactions.
- `@Command` handlers are Process Manager-only. Aggregates and Projections
  reject every `@Command` declaration and generated command metadata record.
  This Entity restriction does not apply to standalone `AbstractCommander`.
- The framework supports all four JVM standalone signal-handler families. They
  are not Entities and must not be materialized through a Repository.
- Do not use a registry version or retain compatibility with earlier unreleased
  generated-registry snapshots.
- Do not place produced-signal failure responsibility in `BoundedContext`.
- Use command substitution; do not retain obsolete transformation terminology
  as an alias.
- Use the official `origin` remote and this feature worktree; any eventual
  merge-version change is a separate version-only commit with the required
  message and never changes internal dependency pins or the lockfile.

## Superseded final disposition

All acceptance criteria are implemented and verified on the published feature
branch. The release version is `2.0.0-snapshot.9`. The corrective
independent review is clean across every applicable concern. Its final
`pnpm verify:release` run passed 288 test files and 4,578 tests with 93.29%
statement, 90.01% branch, 92.87% function, and 94.45% line coverage.

This disposition predates the Process Manager-only correction below and must
not be treated as current verification evidence.

## Current disposition

The final specialist-review correction passed its cheap preflight. Narrow
re-review then found two remaining public-contract gaps: dependency-injected
standalone handlers must remain assignable, and generated registry ingestion
must reject fabricated descriptor-like objects. Active repository test fixtures
also need the final command-substitution rename. These corrections are in
progress. This task has no current release-verification claim.

## Historical pre-standalone disposition

This disposition is superseded by the corrective implementation started on
2026-09-08. It remains historical evidence only.

The previous binding domain correction stated that Aggregates and Projections
reject every `@Command`; Process Managers retain command-input substitutions
and event/rejection command reactions. The corrected review convergence also
includes domain-correct black-box fixtures, truthful generated-registry
documentation examples, and the analyzer symbol-lookup guard for unrelated
heritage types.

The former two-file generator failure is resolved: its focused rerun passed 98
tests. The canonical preflight passed 9 files and 437 tests. The authoritative
`pnpm verify:release` exited 0 with 288 files and 4,586 tests: 93.29% statements,
90.04% branches, 92.89% functions, and 94.45% lines. These final gates supersede
all earlier entries stating that release verification had not run. The branch is
clean. That endpoint missed standalone decorated handlers, retained a versioned
registry, used rejected terminology, and placed produced-signal failure
responsibility in `BoundedContext`; it is not ready for review.

## Standalone integration tranche evidence (2026-09-08)

- Added focused runtime proof that generated rejection handlers route to an
  `AbstractCommander`, `AbstractEventReactor`, and `AbstractEventSubscriber`.
- Added bounded-context proofs that standalone-produced Command-to-Command and
  Event-to-Event work re-enters the local buses, immediate close drains an
  accepted produced Command, and a failed produced Command neither suppresses
  its later sibling nor causes an unhandled rejection.
- TDD RED was recorded for the rejection case with an invalid per-receiver
  publisher fixture; the expected failure established that the runtime uses one
  context publisher. The corrected shared-publisher fixture passed without a
  runtime correction. The new context cases passed against the existing
  publisher and close implementation.
- Focused validation: the runtime and bounded-context suites passed 88 tests;
  server typecheck, generated-build typechecks (including `typecheck:tooling`),
  generated-fixture check, scoped ESLint/Prettier, and `git diff --check`
  passed. `typecheck:tooling` emitted no diagnostics, so there is no T-0225
  tooling failure to classify.
- Focused coverage completed with the two suites and exercised
  `standalone-handler-runtime.ts` at 96.70% statements, 91.42% branches, and
  100% functions/lines. The run exited nonzero only because the repository-wide
  90% global threshold is inapplicable to this narrowed two-suite invocation
  (21.49% aggregate); it is coverage evidence, not a global coverage gate.

## Standalone review correction batch (2026-09-08)

- Standalone event selection now partitions `@Where` filters by both signal
  schema and domestic/external origin. Two-parameter command and event methods
  receive cloned generated default contexts when an envelope omits context.
- Context assembly includes generated standalone external interests in broker
  setup and rejects duplicate standalone command receptors before bus intake.
- The external standalone test now marks its envelope as external; rejection
  commander output uses a Command fixture rather than an Event fixture. Public
  standalone registration methods have parameter/return and `buildAsync()`
  metadata TSDoc.
- Focused standalone/context suites passed 88 tests. The combined broker suite
  is blocked by pre-existing `RED-15` versioned registry test metadata, which
  fails registry discovery before the standalone paths execute.

## Final standalone re-review correction batch (2026-09-08)

- Standalone Event dispatchers now define explicit domestic and external schema
  sets through `EventDispatcherOriginSchemas`, keeping a same-schema domestic
  handler registered while retaining the external interest.
- Focused behavior covers same-schema routing in both directions, generated
  Assignee/Commander receptor rejection, RecordingTransport broker interest
  and imported delivery, semantic standalone fixture roles, default and cloned
  two-argument contexts, and commander installation TSDoc.
- Fresh focused runtime, bounded-context, and integration-broker tests passed
  104 cases. The scoped coverage run exercised `standalone-handler-runtime.ts`
  at 97.95% statements, 93.42% branches, and 100% functions/lines; its process
  exit reflects only the inapplicable repository-wide global threshold for a
  three-file subset.

## Generated standalone broker-proof correction (2026-09-08)

- The broker integration proof now materializes a concrete standalone Event
  subscriber through a temporary generated registry root and
  `addEventDispatcher(...).buildAsync()`. It verifies the assembled standalone
  external schema appears in `ExternalEventsWanted` and imported delivery calls
  that registered instance.
