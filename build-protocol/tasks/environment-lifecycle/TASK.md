# Shared environment and storage lifecycle

## Status and decisions

The high-risk `environment-lifecycle` feature branch started from official
`origin/master` at `ff6c8669537a016c47f012150306500d3b52b5d1`.
The [accepted proposal](PROPOSAL.md) includes the full Agent recovery-removal
requirement. The detailed [factory preparation](FACTORY_PREPARATION.md),
[Agent live execution](AGENT_LIVE_EXECUTION.md),
[Agent delivery lifetime](AGENT_DELIVERY_LIFETIME.md),
[Agent completion audit](AGENT_COMPLETION_AUDIT.md),
[shared Delivery close](SHARED_DELIVERY_CLOSE.md), and
[fatal initialization](FATAL_INITIALIZATION.md) decisions remain applicable.
The common workspace version is `2.0.0-snapshot.25` in a separate version-only commit.

Fresh independent review corrections are complete. The changes include environment
AI inheritance, the Production storage default, shared Inbox enforcement,
Delivery failure reporting and concurrent handoffs, one native Datastore Agent
transaction attempt, and corrected public configuration examples. Required
review concerns are clear; focused checks include native Datastore transactions
and shared-Delivery tenant and shard behavior.

## Binding requirements

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
- Environment AI is optional and inherited unless `withAi()` overrides it;
  no configured AI remains valid for Bounded Contexts without Agents.
- InboxStorage, ShardedWorkRegistry, and Delivery accept only a shared
  single-tenant storage context, including lower-level public construction.
  Packed signals retain tenant identity for dispatch.
- Production retains the complete application `typeRegistry` requirement and
  uses an in-memory StorageFactory if none is configured.
- Native Datastore Agent commits use one transaction and propagate failure
  after rollback; configured live AI correction settings are unchanged.

## Verification and handoff

Local release verification at `b6235d13f` passed: 6,269 Vitest tests and 39 Node tests, with
14 optional tests skipped and branch coverage at the unchanged 90% threshold.
The native Datastore Agent tests also pass. The release stages were resumed
after staging intended document deletions and correcting obsolete test fixtures.
All accepted independent-review findings are resolved.

Linux CI exposed a late repeated-signal shutdown race in the delivery-server
executable. Signal handlers now remain installed until process death. The
deterministic regression and all five process tests pass, and independent
runtime review is clear. Final release and remote checks cover this correction.

[Draft PR #20](https://github.com/SpineEventEngine/spine-ts/pull/20) contains the
feature branch. Exact-revision Build and Security workflow results are the final
remote checks; earlier repository audits reported zero known vulnerabilities.
Do not merge or push to `master` without explicit human instruction.
