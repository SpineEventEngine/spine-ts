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
PostgreSQL offline assembly, tenant resolution and physical structure preparation.
MySQL/MariaDB offline connection lifecycle and physical structure preparation are
reviewed and complete. Datastore native/custom preparation is also reviewed and
complete. Public live TenantIndex configuration and native membership are reviewed
and complete. Tenant admission and identifiable errors are reviewed and complete.
Unconditional duplicate-state registration and the unified asynchronous build API
are verified, independently reviewed and pushed. Immutable Agent acceptance receipts and
conditional live Agent persistence and server recovery removal are reviewed and pushed.
M21 removal of the remaining AI-adapter replay SPI and saved-response paths is
verified and independently reviewed, including preservation of live corrections
and typed audit records.
Shared environment setup and Delivery consolidation are reviewed and complete,
including context-specific shutdown and retained shared dispatch lifetimes.
Bounded Context eager/lazy initialization is reviewed and pushed.
Subscription monitoring is reviewed and pushed. Explicit context and environment
preparation APIs are verified, independently reviewed and pushed. Protocol integration
and remaining AnyPacker adoption are verified, independently reviewed and pushed.
Final documentation, native evidence, specialist review and security review
are accepted. The version-only commit for all 35 workspace manifests is pushed.
Full-suite regression corrections are implemented, reviewed and pushed. The latest full diagnostic run (M43 at 19549e68c) passes all 6,243 tests
(14 skipped) in 107.31 seconds. Branch coverage is 89.65% (20,609/22,986),
requiring another 79 covered branch outcomes to reach 90%; the other three
coverage measures pass. This replaces the earlier M26 and pre-M26 measurements.
M20 fixture isolation and M21 adapter recovery removal are verified and reviewed.
Focused coverage work continues; final release acceptance remains pending.
Exact-final-SHA remote CI remains pending. On 2026-10-28 the human additionally
requested remediation of all findings from the scheduled Security workflow,
including run 40632154594. Its dependency audit reports 31 vulnerabilities;
remediation is implemented and independently reviewed, and both local audits
report zero known vulnerabilities. Feature-branch Security CI passed at 89e6faafa;
it will be refreshed on the final pushed revision. Full release/global coverage
remain required before final acceptance. Remaining milestones follow MILESTONES.md. Existing
behavior descriptions in the proposal refer to the baseline; proposed APIs become
supported only after implementation.

## Added Delivery validation regression

2026-10-28: Human prioritizes fellow-developer feedback before further coverage.
Snapshot .24 reportedly lets post-handler state/output validation errors bypass
onReceptionFailure and failure counts; supervisor silence leaves the Inbox row
pending, repeatedly runs handler effects and blocks later shard work. Investigate
.24 and this branch, reproduce, and route these errors through onReceptionFailure
so the existing monitor policy decides acknowledgement or retry. Preserve failure
observability and ordinary delivery semantics. Ask only substantive unresolved
questions after source investigation. This correction is implemented, verified and independently reviewed; resume coverage.

Acceptance for this correction:

- A handler's invalid resulting state or produced signal reaches
  `onReceptionFailure` with the original error and increments `failed`.
- The existing monitor decides whether to acknowledge or repeat. Successful
  acknowledgement allows later work in the same shard and prevents automatic
  repetition of that acknowledged message.
- The default monitor's acknowledgement completes a local post normally, as it
  already does for an exception thrown inside a handler. Tests must assert the
  monitored validation error and unchanged persisted state, not merely replace
  a rejection assertion with a successful post assertion.
- Invalid input remains rejected before handler invocation; genuine storage and
  shard-session failures must not become default-acknowledged receptions.
- A genuine escaping background Delivery failure is observable through safe
  logging. Do not duplicate returned/observed failure logs or log normal close
  cancellation as an application failure.

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
- Address all scheduled security dependency findings after lifecycle work; retain
  the existing audit thresholds and checks.

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
The lifecycle and dependency security reviews are accepted. Both dependency
audits are clean, and the feature-branch Security workflow passed at 89e6faafa. Baseline build and
tooling typechecks, baseline tests and focused retention checks passed. Bounded
reviews are recorded in REVIEW_LOG.md; release verification and exact-final-SHA
CI remain pending. WORK_LOG.md records the current evidence. Raw command outputs
and dispatch evidence are kept outside version control in `/tmp/spine-environment-lifecycle-20261027`.

## Remaining work

The ordered milestones are frozen in MILESTONES.md. Implementation and review
are accepted for the completed slices. The scheduled security findings are fixed
and reviewed. The Node runner and sequential Agent test corrections are accepted.
Complete focused behavior coverage, review and mandatory cheap preflight, then
pass the full release checks, refresh Security CI on the final pushed SHA, and
report exact remote state. The common unused version has been committed separately. Do not create
or merge a pull request without explicit human instruction.

## JVM source guardrail

Read `spine-jvm-docs/spine-server-runtime-and-bounded-context.md` storage paths
and local `core-jvm/server/.../entity/Repository.java` storage()/close(), plus
`delivery/Delivery.java` retained InboxStorage. Repository.storage() creates once
when absent; Delivery retains its InboxStorage. The first TS slice follows this
lifetime without introducing common caching infrastructure or a new dependency.
Library selection is N/A for this domain-specific lifecycle correction: reuse the
existing provider interfaces, maps and runtime shutdown paths.
