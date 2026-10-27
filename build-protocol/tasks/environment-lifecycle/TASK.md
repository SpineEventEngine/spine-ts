# Shared environment and storage lifecycle

## Scope and status

Implementation authorized 2026-10-27. High-risk: shared runtime lifecycle,
persistence, concurrency, public and serialized contracts across providers.
Branch: `environment-lifecycle`. Baseline: freshly fetched official
`origin/master` at `ff6c8669537a016c47f012150306500d3b52b5d1`.
Worktree: `/Users/armiol/.codex/worktrees/environment-lifecycle/spine-ts`.
The accepted [proposal](PROPOSAL.md) includes the complete Agent recovery-removal
task. Implementation is in progress. Repository/EventStore retention, shared AnyPacker,
provider commit-storage retention and awaitable shutdown are reviewed and pushed.
Shared preparation contracts and the memory implementation are complete, as is
PostgreSQL offline assembly and tenant resolution. PostgreSQL physical structure
preparation is underway; the remaining milestones follow MILESTONES.md. Existing
behavior descriptions in the proposal refer to the baseline; proposed APIs become
supported only after implementation.

## Human-Imposed Requirements Ledger

- First priority: retain Storage objects for their runtime lifetime.
- ServerEnvironment supplies storage, transport and Delivery; no Application.
- Bounded Context overrides only TenantIndex and AI settings.
- Explicit environment setup; gRPC-only Server; eager context defaults.
- Each false build flag defers its operation to first valid input independently.
- Failed lazy preparation rejects the request and retries on subsequent input;
  explicit startup preparation fails the application.
- After successful initial subscription monitoring, later failures log WARN and
  attempt restart without stopping the application.
- Single-tenant shared Inbox; derive dispatch tenant from the packed signal.
- Primary delivery follows committed Inbox writes; scanning is a safety net.
- Dynamic application-controlled TenantIndex, resolver and TENANT_UNKNOWN.
- Apply JVM PR 1698 registration and cleanup semantics, with unconditional
  rejection of duplicate Entity state types across open domain Bounded Contexts.
  This applies in tests and BlackBox too; no disabling switch or test exception.
- Remove automatic Agent recovery fully; retain normal execution and audit.
- No existing-data migration, conversion scans, migration utilities or tests.
- No framework database provisioning; no arbitrary limits or recovery substitutes.
- Introduce JVM-like AnyPacker and use it consistently across the codebase.
  Preserve Any type URLs through packing and round trips; do not work around the
  Datastore key defect by carrying native keys instead of correcting packing.
- Preserve independent Bounded Context operation during other context builds.

## Workflow

Desktop supports explicit required child model/reasoning profiles. Standard
speed; no boost. Architecture assignment: existing requirements_splitter,
`gpt-6-astra` / `high`, explicit immutable profile. Implementation and relevant
technical reviews: existing Sol roles, `gpt-6-sol` / `medium`. Documentation:
`gpt-6-luna` / `medium`. Mechanical checks: orchestrator-dispatched Luna function.
Actual runtime metadata is recorded when available; otherwise configured
profiles and that limitation suffice. Children must not delegate.

Skill applicability: session inventory, repository expected-skill manifest,
`rg --files ~/.agents/skills -g SKILL.md`, and readable
`~/.agents/.skill-lock.json` were inspected. Apply `using-git-worktrees`,
`test-driven-development`, and `verification-before-completion`; their local
SKILL.md sources were read before governed actions. Repository workflow governs
review batching and autonomous continuation. `executing-plans` is not applied:
the repository already specifies its implementation/review cycle.
Generic backend, CQRS and API-design skills add no task-specific instructions;
Spine JVM source and the accepted design supply the domain contracts.

## Verification and review

Focused behavior tests precede runtime changes. Cheap preflight precedes
specialist review and expensive gates. Use the release profile after convergence
because shared runtime is affected. Every canonical review concern applies to
the full task: maintainability, documentation, TypeScript/API and reliability.
Final release-readiness security review remains required. Baseline build and
tooling typechecks, baseline tests and focused retention checks passed. Bounded
reviews are recorded in REVIEW_LOG.md; full-task review and release verification
remain pending. WORK_LOG.md records the current evidence. Raw command outputs
and dispatch evidence are kept outside version control in `/tmp/spine-environment-lifecycle-20261027`.

## Remaining work

The ordered milestones are frozen in MILESTONES.md. Continue implementing,
verifying and reviewing each. Update public documentation and examples as interfaces
stabilize. Run release checks, select an unused common workspace version, push
every feature commit immediately, and report exact remote state. Do not create
or merge a pull request without explicit human instruction.

## JVM source guardrail

Read `spine-jvm-docs/spine-server-runtime-and-bounded-context.md` storage paths
and local `core-jvm/server/.../entity/Repository.java` storage()/close(), plus
`delivery/Delivery.java` retained InboxStorage. Repository.storage() creates once
when absent; Delivery retains its InboxStorage. The first TS slice follows this
lifetime without introducing common caching infrastructure or a new dependency.
Library selection is N/A for this domain-specific lifecycle correction: reuse the
existing provider interfaces, maps and runtime shutdown paths.
