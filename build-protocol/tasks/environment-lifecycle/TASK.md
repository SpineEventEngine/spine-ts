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
AI inheritance, the Production storage default, single-tenant InboxStorage enforcement,
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
- Single-tenant InboxStorage holds messages for individual Entity Inboxes;
  derive dispatch tenant from the packed signal.
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

Follow-up requested for PR #20: demonstrate first-subscription creation in a
multitenant Bounded Context using the default persistent subscription registry
and PostgreSQL, including deferred preparation. Add an extensive storage layout
reference for every provider, covering single-tenant and multitenant modes,
physical structure names, framework record fields and types, prerequisites,
and supported customization. Keep application infrastructure provisioning and
existing-data migrations outside scope.
The [storage layout reference](../../../docs/STORAGE_LAYOUT.md) includes gateway
and authentication storage requirements, including runtime-only state and
persistence delegated to application-provided implementations. Native PostgreSQL
tests use the public gRPC service to cover eager and lazy first subscriptions,
shared registry placement, and tenant-specific state updates for the same Entity ID.
This follow-up changes
tests and documentation only; it uses the bounded `verify:task` profile plus
native integration tests. The PR Build workflow runs full release verification.

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

## Storage guide revision

Organize the storage guide into six chapters, following the latest human direction:
single-tenant mode, multitenant mode, common value conversion and customization,
Agent storage, gateway/authentication storage, and startup sequence. Each mode
starts with the same small domain example and an explanation of its layout,
then treats every provider separately. Within each
provider, explain each domain table followed by each framework table, then give
the required human configuration checklist. End the multitenant chapter with
adding tenants and the resulting preparation and first-use behavior.

For each physical table or Datastore kind, list every column/property, its database
type, the exact source Protobuf field or whole serialized record, and an example
value. Show supported configuration/override code directly below the structure it
affects; use fenced code examples, including imports where needed, instead of prose
instructions to import schemas or invoke builder methods. State beside every
table who creates it and when. Distinguish framework-created SQL tables,
Datastore kinds appearing on first write, and infrastructure/indexes that humans
must provision. Say plainly when a component cannot be configured. Distinguish
native Datastore keys from properties and in-memory collections from physical tables.
Include example-defined Entity states, all enabled framework records, optional
histories, Agent audit/receipts/preferences, gateway bindings and node leases.
Keep authentication requirements and complete Datastore index instructions.
Place the detailed Agent and gateway/authentication explanations after value
conversion, in separate chapters. Remove their essays and additional application
checklist from the tenancy-mode introductions. Explain each through concrete
storage examples, with patient paragraphs instead of densely packed summaries.

Explain the physical mapping through the example application, rather than giving
a catalogue of familiar framework Protobuf messages. Use patient, beginner-friendly
prose with concrete examples. Move shared conversion rules into their own chapter,
including message-valued fields, Entity identifiers and conversion overrides, with
provider subsections for actual differences. Show startup code and explain the
order of creation/checks, monitoring and input, including eager/lazy preparation.
This is a documentation revision; existing runtime behavior and tests remain unchanged.

The final CI run must also pass the delivery-server process shutdown checks.
Repeated-signal tests must coordinate with a running child process and distinguish
normal shutdown handling from signals sent after its JavaScript runtime has stopped.
Preserve normal graceful shutdown and listener release; do not hide failures with
additional sleeps, larger timeouts, or retries.

## Event storage naming investigation

Compare domain and optional System Event persistence directly with Spine JVM.
Explain why TS introduced logical groups and hashed physical names, identify the
actual isolation requirements, and determine whether JVM's simpler naming/storage
approach can be used. Do not treat the present TS design as a required constraint.

Also compare `StringifierRegistry` with the JVM singleton and investigate whether
build-generated knowledge of Protobuf schemas can configure the default TS registry
automatically, instead of requiring application code to assemble it manually.
Include the findings in the explanation to the user.

## Approved Event Store and stringifier implementation

Implement the investigated JVM-like defaults in this existing task and feature
worktree, following the [accepted contract](STORAGE_DEFAULTS.md). This is a high-risk continuation because physical storage selection,
identifier conversion, generated application setup, and public builder APIs change.
No existing-data migration, fallback reads or dual writes are authorized.

- Derive readable Event Store names from the Bounded Context name. Preserve
  separate domain/System Event Stores, tenant destinations and original Event IDs.
  All preparation, atomic writes, ordinary writes, reads and catch-up must agree.
- Support a naming override for a specific Bounded Context's Event Store. Reject
  invalid or colliding physical names clearly, including domain/System name clashes.
- Provide one shared default StringifierRegistry with the application descriptor
  inventory installed by generated application/model startup code. Ordinary users
  must not construct and populate stringifier registries. Preserve optional custom
  converters, exact Any type URLs and stable identifier conversion. Avoid factories
  retaining an empty snapshot before generated registration runs.
- After implementing both changes, revise the storage guide against all comments
  below and update the existing PR #20 description, preserving its useful examples
  and explaining the resulting APIs. No verification section in the PR description.

Storage guide follow-up requirements:

1. Remove fictional-person narratives, including Ada. Expand the contents to show
   subsections. Explain PostgreSQL's default schema and its override with actual code.
2. Explain every retained Inbox SQL search column and its query use, comparing
   JVM persistent Inbox storage. The source investigation confirmed `inbox_id` and
   `signal_id` have no TS predicates, sorting, public column export or index use;
   remove those two materialized columns and retain both fields in the Protobuf
   payload. Preserve the six query columns and current delivery behavior.
3. Every bytes-cell example must say exactly: "Protobuf message serialized into
   binary array". Remove pseudo-decoded payload strings from those table cells.
4. Keep concrete provider-builder code for every supported override; no mystery
   builder variable or prose instructions standing in for code.
5. Format Proto examples with blank lines, message/field comments and proper
   Entity options. Examples must represent valid domain concepts and generation.
6. Rewrite conversion, Entity identifiers and provider customization from actual
   Proto definitions. Walk through individual values point by point, with provider
   subsections and detailed examples. Avoid compressed summaries and jargon.
7. Stop using documentation skills. Use the same direct, conversational language
   as the chat. Independent reviewers must explicitly test reader comprehension,
   explanations and examples, in addition to technical accuracy and completeness.

Use one architecture pass to settle the public contracts, one implementation
context, focused behavior tests, relevant independent review, cheap preflight and
one converged release verification. Preserve completed baseline work and do not
repeat its full review without a newly affected concern.

### Storage defaults continuation accepted

Readable Event Store names, provider overrides, generated-schema-backed default
stringifiers, the bounded Inbox-column cleanup, and the storage-guide rewrite are
implemented and independently reviewed. The final release profile passes, including
6,287 Vitest tests, 39 Node tests, and all coverage thresholds. See
[the accepted contract and evidence](STORAGE_DEFAULTS.md) for the review corrections
and exact results. Publication uses the existing feature branch and PR #20.
