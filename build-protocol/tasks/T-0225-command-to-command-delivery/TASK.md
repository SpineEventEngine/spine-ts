# T-0225: Command-to-Command Delivery

Status: Final verification passed; ready for human review
Baseline: `origin/master@e37ec8a1fed84f11e0df07c78846d5607a698ede`
Branch: `fix-command-to-command-delivery`
Worktree: `/Users/armiol/development/experiments/spine-ts-fix-command-to-command-delivery`

## Objective

Make a `@Command` handler whose input is a Command participate in Command Bus
registration and execution. Keep event-to-command and rejection-to-command
reactions on the Event Bus.

## Acceptance criteria

1. A generated `@Command` method with a Command input is registered as the
   effective handler for that Command type.
2. A client-posted Command reaches that method instead of returning
   `UNSUPPORTED_COMMAND`.
3. A Command posted by server context reaches the same method.
4. The method returns one or more Commands using the existing supported return
   shapes; zero output remains invalid.
5. Process Manager command transformation works, including an optional
   `CommandContext` parameter. Aggregate and Projection repositories reject all
   `@Command` handlers.
6. The Entity state commit succeeds before transformed Commands are posted.
7. Failure before commit does not publish transformed Commands or partially
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
    command-transformation contract.
13. Domain-correct Protobuf fixtures and focused end-to-end tests reproduce the
    original client and context-posting failures before production code changes.

## Classification and estimate

High risk: this changes shared command registration, Entity execution,
transaction ordering, causal metadata, and a public decorator contract.

Estimated active work: 5–8 uninterrupted hours, including RED tests,
implementation, focused coverage, specialist review and corrections, version
alignment, one release gate, commits, pushes, and reporting.

## Execution and verification

- Use behavior-first TDD and preserve the failing-test output before changing
  production code.
- Inspect and retain JVM command-substitution semantics: command-input
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

## Agent routing

The Codex Desktop surface supports explicit model and reasoning selection.
Subagents may not spawn subagents.

- Implementation owner: existing `implementer` role; generated metadata,
  handler readiness, repository execution, tests, documentation, and task
  records; model explicitly `gpt-5.6-terra`, reasoning explicitly `medium`.
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

- Work from current official `origin/master` on a regular feature branch with no
  `codex/` prefix.
- Never modify or push official `master` directly.
- Push every feature-branch commit to official `origin` immediately.
- Do not create or merge a pull request without explicit human instruction.
- Never rewrite the published feature branch.
- Preserve event-to-command behavior while fixing command-to-command delivery.
- Use domain-correct Protobuf Command fixtures: never substitute entity state
  messages or framework envelopes for command inputs or outputs.
- Command-input transformations return one or more Commands and are the unique
  effective receptor for their input; event/rejection-input `@Command` handlers
  remain EventBus reactions.
- `@Command` handlers are Process Manager-only. Aggregates and Projections
  reject every `@Command` declaration and generated command metadata record.
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

Aggregate and Projection `@Command` support was removed. Process Managers
retain command-input substitutions and event/rejection command reactions. The
current correction requires focused verification before a new review/release
disposition is recorded.
