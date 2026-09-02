# T-0153: Wave 9 Plan

Status: Complete

## Objective

Freeze the approved Wave 9 contracts for operational logging, JVM-style
customizable signal routing, semantic Proto routing, event-field handler
filters, implicit required IDs, and rejection conformance. Produce a
dependency-ordered implementation plan with review-sized tasks, exact public
boundaries, RED-first behavior evidence, and a clear Wave 10 documentation
handoff.

## Classification

High-risk. Wave 9 adds a third-party logging dependency, changes public
TypeScript APIs, changes command/event/state-update routing and validation
semantics, adds failure-path logging around security-sensitive code, and spans
server, core, Proto tooling, examples, deployment integration, and generated
handler metadata.

## Baseline And Isolation

- Baseline: `origin/main@b4f53804`.
- Branch: `task/T-0153-wave9-plan`.
- Worktree: `.worktrees/T-0153-wave9-plan`.
- The stale dirty primary checkout remains coordination-only and untouched.
- `pnpm install --frozen-lockfile` passed.
- The clean baseline `pnpm verify:task -- --no-tests` passed TypeScript,
  tooling, TSDoc, format, documentation/API, Proto, generated-cleanliness,
  package/import, and 320-link release-readiness checks.

## Human-Imposed Requirements Ledger

1. Use established TypeScript/JavaScript logging libraries. Do not invent a
   Spine-specific logging mechanism.
2. Use LogLayer as the application/framework logging API. Application code
   creates and retains its logger and supplies it to the server environment;
   framework code uses child loggers without taking over the logger lifecycle.
3. Provide structured framework logging by default and an extensible path for
   third-party collectors. Google Cloud Logging integration is required in
   Wave 9. Sentry is a future example of why the core must remain transport
   neutral, not a Wave 9 implementation requirement.
4. Add the WARN- and ERROR-level logging statements that operational framework
   failures require. Log once at the containment/top boundary rather than at
   every rethrowing layer. Logging failure must never change framework
   behavior.
5. Logs may include stable tenant, actor, Entity, command, event, shard,
   worker, node, and subscription identifiers. They must never include tokens,
   passwords, cookies, authorization headers, signing keys, session secrets,
   CSRF/OIDC secrets, or other authentication secrets.
6. Wave 9 logging is server-side. Browser-side application logging is not part
   of this wave.
7. Make routing customizable in every JVM-supported scenario: commands,
   events, and Entity state updates. Preserve JVM-familiar defaults and allow
   replacement defaults and exact-message custom routes.
8. Event and state-update routes may return an empty collection, which means
   the signal is intentionally not routed to any Entity in that repository.
   Commands remain unicast.
9. An Event producer ID is always present. If it is valid and compatible with
   the repository ID type, route by it. If it is valid but incompatible, fall
   back to the first declared Event field. If it claims the compatible type
   but is malformed, fail; do not fall back.
10. Verify and implement `(is)` and `(every_is)` semantic contracts. Exact
    message routes precede semantic routes, and message-level `(is)` precedes
    file-level `(every_is)`. Ambiguity must fail during construction.
11. Add `@Where` for handlers consuming Events. Its public option is exactly
    `eventField`, not `field`, for example:
    `@Where({ eventField: "board", equals: '{"value":"announcements"}' })`.
    Invalid declarations fail rather than being ignored.
12. `@Where` supports nested Event field paths and converts `equals` through
    field-type Stringifiers. It applies to `@Subscribe`, `@React`, and
    Event-to-command `@Command`; it does not apply to command assignment,
    command-input reaction, or Entity-state subscription.
13. Follow Spine JVM's implicit-ID convention server-side: the first field by
    declaration order in a command or Entity state is implicitly required when
    `(required)` is absent. A redundant explicit declaration is valid. An
    explicit option remains authoritative.
14. Rejections use `rejections.proto` when one rejection file serves a domain
    package/folder and `<domain-entity>_rejections.proto` when several are
    needed. The same naming principle applies to commands and events.
15. Audit the existing rejection runtime before adding behavior. Do not create
    a second rejection mechanism when generated throwables, rollback, rejection
    Events, and client outcomes already satisfy the requirement.
16. Use Message Board as the end-user example for logging, routing,
    `@Where`, implicit IDs, and rejection conformance where each behavior is
    naturally demonstrable.
17. Public API TSDoc ships with its Wave 9 runtime slice. All Markdown and
    README changes, including the complete beginner `docs/USER_GUIDE.md`
    rewrite, are deferred to Wave 10. Keep the preliminary beginner-guide
    structure in the Wave 9 plan for later approval.
18. Repository-wide copyright-header correction is deferred to Wave 10.
    Multiple-Gateway behavior remains Wave 10. Cloud Run remains outside the
    initial offering.
19. Do not build or modify Spine JVM. Inspect current local JVM source and
    official library documentation only.
20. Push only to the then-configured `origin`. Never push to an additional
    remote unless the human explicitly authorizes that exact one-time
    operation. Do not publish packages to npm.
21. Preserve every user-owned or unrelated dirty file in the primary checkout,
    including both human-review files. Do not create `.superpowers` or other
    scratch ledgers; use `build-protocol/work-logs`.
22. Continue autonomously after the plan is approved and integrated. Ask only
    for a real product decision or external blocker.

## Current Research Findings

- LogLayer supplies a concrete TypeScript API, child loggers, structured
  metadata, redaction plugins, testing support, and existing transports for
  Pino, Google Cloud Logging, Sentry, OpenTelemetry, and custom destinations.
- Google Cloud accepts structured JSON through managed stdout/stderr agents and
  through its client library. Wave 9 must prove both the default structured
  output and the direct LogLayer Google Cloud transport without introducing a
  Spine logging facade.
- Current Spine TS has one isolated `ServerEnvironmentSettings.warn` callback
  and no shared logger. Operational failures are otherwise inconsistently
  contained without structured logging.
- Spine JVM exposes `CommandRouting`, `EventRouting`, and
  `StateUpdateRouting`, custom routes, default replacement, multicast Event and
  state routes, and an explicit no-target Event route.
- Current Spine TS routes commands by first field, routes Events to one target,
  special-cases Process Managers, and exposes no public customization surface.
- Current TypeRegistry can hold caller-supplied semantic tags, while automatic
  `(is)`/`(every_is)` extraction exists only in Entity metadata. This is
  incomplete semantic support.
- Spine JVM `@Where` filters Event parameters, accepts nested field paths,
  converts the literal through `Stringifiers`, gives filtered handlers
  precedence over the unfiltered fallback, and rejects conflicting fields for
  one Event/class.
- Spine JVM's required-ID policy uses declaration order and applies the
  implicit rule only when the field has no explicit `(required)` option.
- The current rejection runtime already generates throwable companions,
  rolls back failed Entity work, publishes typed rejection Events, and exposes
  client rejection outcomes. Wave 9 therefore begins with conformance evidence,
  not a new abstraction.

## Skill Applicability

- Inventory sources checked: the session skill catalog,
  `build-protocol/skills/EXPECTED_SKILLS.md`, the bounded complete
  `~/.agents/skills/*/SKILL.md` entrypoint listing, and
  `~/.agents/.skill-lock.json`.
- Selected and fully read: `using-git-worktrees`, `decision-mapping`,
  `subagent-driven-development`, and `test-driven-development`.
- `using-git-worktrees` established the isolated task worktree from the exact
  remote baseline. `decision-mapping` is applied through this compact tracked
  planning record because the human already resolved every question; no
  additional question map is needed. `subagent-driven-development` governs
  serialized implementation ownership after planning. `test-driven-development`
  requires every runtime behavior to begin with an observed RED test.
- The generic subagent skill's `.superpowers` ledger conflicts with the
  explicit human and project requirement; the project task/work/review records
  replace it.
- `planning-with-files` and `architecture-decision-records` were triaged but
  not selected because the repository's canonical plan, task, decision, work,
  and review formats already provide durable memory.
- `requesting-code-review` and `verification-before-completion` apply later and
  will be fully read before those governed actions.
- Library search is complete for logging. LogLayer is preferred over binding
  the framework directly to Pino or Winston and over using the still-developing
  OpenTelemetry JavaScript Logs API as the core contract.

## Requirements-Splitter Assignment

- Existing role: requirements splitter acting as a senior Spine routing,
  validation, and observability architect.
- Scope: inspect this ledger, the accepted user-facing proposal, current TS
  seams, current local Spine JVM routing/filter/required-ID sources, and
  official LogLayer/Google Cloud contracts. Produce the smallest
  dependency-ordered, review-sized Wave 9 split; freeze public API shapes,
  behavior matrices, TDD evidence, ownership boundaries, review relevance,
  verification profiles, and Wave 10 deferrals. Identify contradictions but do
  not ask questions already answered by the ledger.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: `high`.
- Dispatch requirement: both fields must be explicit.
- Subagent must not spawn subagents or edit files.

## Requirements-Splitter Outcome

- Completed read-only with the existing `requirements_splitter` role,
  explicitly dispatched as `gpt-5.6-sol` with `high` reasoning.
- Runtime model/reasoning self-introspection was unavailable; the immutable
  configured role/profile and that limitation are the recorded evidence. No
  mismatch or fallback was exposed.
- No file was edited, no subagent was spawned, and Spine JVM was neither built
  nor modified.
- The result froze `logger?: ILogLayer`, the no-facade/no-owned-lifecycle rule,
  official Google Cloud transport composition, the containment-log matrix,
  exact Command/Event/state routing APIs and defaults, descriptor semantic
  precedence, generated state-subscription metadata, `@Where`, field
  Stringifiers, server-only implicit IDs, rejection conformance, and the
  dependency-ordered T-0154 through T-0167 train, including the parallel
  T-0156A server-side package logging slice.
- No architecture or product-decision blocker remains.

## Verification Profile

T-0153 is record-only and uses `pnpm verify:task -- --no-tests` after
deterministic Markdown checks and planning review convergence. Runtime tasks
use changed-source focused coverage during development and one `verify:task`
after their relevant review corrections converge. T-0167 alone runs the final
converged `verify:release` and post-merge verification.

## Closure

- Reviewed plan commits `74b09d5c` and `380c5a46` were pushed to
  `origin/task/T-0153-wave9-plan`.
- The branch merged without conflict as `b266606e` in a clean integration
  worktree.
- A fresh worktree required the repository's ignored Protobuf output to be
  prepared with `pnpm proto:generate`. After that canonical setup step,
  `pnpm verify:task -- --no-tests` passed every selected post-merge gate.
- T-0153 is integrated and Wave 9 runtime work starts with T-0154.
