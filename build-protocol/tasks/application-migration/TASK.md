# Application API and lifecycle

## Scope and status

The human authorized implementation on 2026-11-13 after accepting the scenario
proposal. This is a high-risk public API, persistence, and concurrency change.
Branch: `application-migration`. Worktree: the existing `application-api-plan/spine-ts`
worktree. Official baseline: `origin/master` at `963282d101059cd6777b65840b4ffd7003f18771`,
merged into the published task branch without rewriting history.

Estimated uninterrupted agent work: 10–16 hours, including focused tests,
maintained examples and API documentation, independent review, and release checks.
This record keeps accepted requirements and remaining work, not the discarded
proposal or review transcripts. No implementation is accepted yet.

## Human-imposed requirements ledger

- Use the official repository and an isolated worktree. Protect `master`, preserve
  unrelated changes, push every feature commit immediately, and make no GitHub
  PR or issue changes without explicit approval. Do not rewrite published history.
- Follow BUILD_PROTOCOL.md, CODE_QUALITY.md, and AGENTS.md. No documentation-writing
  skills, speculative infrastructure, compatibility shims, or data migration tools.
- Follow actual latest Spine JVM Application and ServerEnvironment behavior,
  including builder configuration through `under()`. Explain intentional TS
  differences in maintained API documentation with concrete examples.
- Keep the accepted TS storage preparation API, moving application-wide operations
  from ServerEnvironment to Application. Retain Bounded Context runtime operations.
- Every changed authored production/example type and method has semantic TSDoc.
  Keep changed callables within the quality limits. Use generated, domain-correct
  Protobuf fixtures and `when_` Timestamp fields. Parse-check changed Mermaid.
- Preserve behavior across Entity families. Compare any discovered difference with
  JVM and ask the human if it lacks an existing accepted decision.
- No artificial caps, retries, or timeouts. Preserve existing approved constraints.
- Use simple human-facing wording and “Bounded Context”. Avoid possession terms
  unless required for accuracy; never use the verb prohibited by AGENTS.md.
- Put human questions only at the end of a final reply, with context, options,
  consequences, and a recommendation. Do not ask routine implementation questions.
- Report each review, verification, commit push, or blocker promptly and continue.
- Subagents must not spawn agents. Use explicit model/reasoning dispatch and one
  writer for overlapping production files. Record dispositions for all four review
  concerns and run security review only at release readiness.

## Accepted contracts

### Application and environment

- `ServerEnvironment.newBuilder().under(type, callback).build()` creates a separate
  environment. The callback uses named TS settings through `use({...})`. Building
  configuration is synchronous and does not connect services.
- Remove the singleton API and runtime fallbacks. Keep global environment-profile
  selection and current memory defaults, including Production. Preserve current
  Production schema-registry requirements. Remove the inert `tracerFactory` setting.
- `Application.newBuilder().setServerEnvironment(environment).setTenantIndex(index)`
  accepts optional custom tenant storage; `.add()` accepts Bounded Context builders
  and unattached ThirdPartyContext declarations. `build(options?)` is asynchronous.
- Application build performs existing environment setup internally. No mandatory
  public `completeSetup()` call and no replacement Application setup method.
- Require an open, unclaimed environment and at least one Bounded Context. Freeze
  membership after a successful build. Reject reused builders/environments and
  duplicate names, generated System names, and domain Entity state types within
  one Application. Separate Applications may use the same names and state types.
- `contexts()` is a synchronous read-only list in build order, retaining closed
  entries. Internal System pairing does not add public Bounded Context entries.
- Assemble every Bounded Context and shared query registration before recovered
  messages or subscription monitoring can invoke handlers.
- Production Bounded Context construction goes through Application. Testing helpers
  create fresh Applications/environments and clean them up. Use `multiTenant` for
  the public builder spelling; preserve actual serialized field names.
- ThirdPartyContext factories create synchronous unattached declarations. Before
  attachment they are not open and cannot publish. Reject a second attachment.
  Schema and transport come from the Application. Pre-attachment close is a no-op.

### Tenant storage and preparation

- One tenant index per Application, with no environment or Bounded Context override.
  Custom storage may use a provider separate from domain storage.
- `tenantIndex()` is synchronous and returns the same object. Obtaining the default
  lazy handle performs no storage I/O. Coalesce asynchronous first initialization.
  A single-tenant Application that never needs the index does not prepare it.
- Add asynchronous TenantIndex close. Wait for admitted work; reject new work when
  closing; retry unfinished failed cleanup without repeating successful cleanup.
  PersistentTenantIndex does not close its separately supplied StorageFactory.
- Explicit `createStorageStructures(tenantId...)` and compatibility checks accept
  structurally valid caller IDs without index membership. Deduplicate full TenantId
  values. Select all open multi-tenant Bounded Contexts, excluding single-tenant
  Bounded Contexts. Explicit IDs with no multi-tenant Bounded Context fail clearly.
- With no IDs, prepare each open single-tenant Bounded Context once and enumerate
  the Application index for multi-tenant Bounded Contexts. Empty index means no
  tenant structures. Avoid index access when there are no multi-tenant targets.
- Keep request membership admission and TENANT_UNKNOWN. Index lookup failure is
  an error, not evidence that the tenant is absent. Storage destination callbacks
  remain provider configuration, not platform eligibility checks.
- Administrative preparation failure after startup affects that operation only.
  Required startup preparation failure prevents startup. Existing lazy first-use
  failures remain request-local. No automatic retry policy is added.
- Compatibility checking actually checks declared Bounded Context structures even
  after creation. Concurrent create/check must not silently substitute one mode
  for another. This is not a whole-process guarantee against structure creation.
- Application build options retain `createStorageStructures` and
  `startSubscriptionMonitoring`, both true by default. Both false defer preparation.
  Monitoring may prepare its shared registry even when creation is disabled.
- Application close rejects new administrative work and waits for admitted work.

### Servers, cleanup, and process integration

- `Server.atPort(port).setApplication(application).start()` returns RunningServer.
  Remove Bounded Context assembly from Server. Reject duplicate Command handlers
  while assembling endpoint services rather than silently selecting the first.
- Multiple endpoints may share one Application. Each has its request/authentication,
  App Query/read-filter/subscription services. Shared reads, Delivery, Bounded
  Contexts, and monitoring have Application lifetime.
- Closing an endpoint stops its intake, waits for accepted work, and releases its
  sessions/subscriptions/resources without closing shared Application services.
  A failed additional endpoint start leaves established endpoints running.
- Callers stop successful endpoints before Application.close(). Application.close()
  does not automatically stop them. Close Bounded Contexts in reverse order, then
  index, then environment; preserve dependencies under active or unclosed work.
  Attempt safe remaining cleanup, preserve all errors, and retry failed phases.
- If Application.close() races a pending Server start, start cleans up its listener
  and rejects. Application waits for cleanup. Retain failed-start cleanup in the
  Application even if the caller discards the Server builder, and retry it before
  releasing storage. Do not release storage under a listener that failed to stop.
- Application.Builder.close() retries partial-build cleanup. Retain failed partial
  Bounded Context/default-index cleanup and the environment claim until complete.
  Do not close caller environment/custom index. Retire a failed builder. Reject
  builder.close after successful construction, directing callers to Application.
- Ordinary assembly failure with successful rollback leaves supplied environment
  open. Required setup/preparation failure may close services and needs fresh
  services for another attempt. Custom index transfers only on successful build.
- Process-managed `Server.run()` coordinates per Application, closes it once after
  the final managed endpoint, and accounts for pending starts. Do not mix manual
  start and managed run for one Application. Keep existing process signal behavior.
- BrowserServer.open(native) closes its endpoint, leaving Application cleanup to
  the caller. BrowserServer.run(builder) uses managed Application cleanup. Standalone
  browser gateways need no Application.
- ManagedServerApplication keeps createServer({host, port}): Promise<RunningServer>.
  Associate returned endpoints with their Application for cleanup, and retain failed
  startup cleanup before callback return. Preserve existing readiness constraints.

### Exclusions

No new JVM System subsystems, durable catch-up, tracing, data conversion, tenant
platform, generic application-resource API, or legacy compatibility path. Existing
catchUpReadSide behavior is unchanged and is not called automatically at startup.

## Evidence and execution

JVM reference: official core-jvm checkout at `04ba1bedc3f8db3c8c58b987f9795f952f14c0ab`,
outside this repository under the sibling application-migration-research directory.
Inspect Application, ServerEnvironment, ContextRegistry, Server, TenantIndex,
TenantFilter, ThirdPartyContext, and test helpers. PRs #1717 and #1720 establish
the change; use latest master for current behavior.

Skills applicability: read test-driven-development and
verification-before-completion in full from the installed obra/superpowers skills.
Expected inventory checked in build-protocol/skills/EXPECTED_SKILLS.md. The installed
`~/.agents/.skill-lock.json` confirms both selected skills come from obra/superpowers.
Task-relevant entrypoints were checked with Python pathlib and are readable.
No skill installation or documentation-writing skill is needed. The existing
worktree and project workflow already supply isolation and review sequencing.

Desktop supports explicit child profiles. First architecture assignment:
`/root/application_architecture`, requirements_splitter, gpt-6-astra/high, read-only,
dispatched with both profile fields explicit. Implementation assignment:
implementer, gpt-6-sol/medium. Review concerns use their configured existing roles.
Configured metadata is the acceptance source when runtime introspection is absent.

Dispatched implementation: `/root/application_implementation`, implementer,
gpt-6-sol/medium, both fields explicit, sole writer for the server assembly kernel
and its tests. Parent edits protocol records only during this slice.
Read-only caller inventory: `/root/application_callers`, orchestrator scanning
function, gpt-6-luna/low, both fields explicit. No nested delegation is permitted.

Independent provider slice: `/root/application_provider_preparation`, implementer,
gpt-6-sol/medium, both fields explicit. Scope is preparation caches and focused tests
in storage-mysql, storage-postgres, and storage-datastore only. The server implementer
confirmed it will not edit those files. This slice has no dependency on new server
interfaces and shares the task worktree without overlapping writes.

External maintained callers: `/root/application_external_callers`, implementer,
gpt-6-sol/medium, both fields explicit. Scope is production/tests in examples,
packages/testing, server-blackbox-tests, delivery-client fixtures, proto-tools
templates/tests, and affected scripts. It excludes packages/server, provider files,
and all Markdown. The server implementer confirmed that boundary. Parent adapts
maintained Markdown and verifies snippets against the final public declarations.

Architecture pass accepted: the existing role/profile matched its explicit
dispatch; runtime introspection was unavailable. No blocking contradiction or new
Entity-family difference was found. The required assembly barrier includes
integration, monitoring, and recovered Delivery. Provider preparation caches also
need mode-aware behavior for real compatibility checks after creation. Caller
inventory completed read-only with its explicitly configured Luna/low profile.
Latest official JVM master was fetched again and remains the recorded commit.

Provider checkpoint: sequential create/check and later-check drift regressions
were observed failing before their fixes. Parent rerun confirms 159 focused tests
pass. Provider builds, scoped lint, formatting, and whitespace checks pass. No live
provider service was exercised. A parent review caught permanent check-result
caching; it was removed before independent review. Concurrency/failure review:
`/root/application_provider_review`, existing performance_reliability_reviewer,
gpt-6-sol/medium, both fields explicit. Remaining task review concerns are deferred
until the shared runtime and external callers converge, not marked N/A.

Provider reliability review found that a failed recheck erased the last accepted
schema signature. The same implementer added regressions and retained accepted
signature/readiness while clearing pending work. Re-review resolved the finding
without further concerns. Final focused provider tests remain 159 passing; package
builds and scoped lint pass. Provider references document fresh checks and pending
operation behavior. Live provider-service integration remains unverified. This
bounded checkpoint does not mark the Application task complete.

Remaining work:

1. Application assembly and independent environment, with shared reads installed
   before integration, monitoring, and recovered Delivery activation.
2. Tenant preparation/index lifecycle, including provider mode caching; then shared
   endpoint lifetime, process/browser/managed integration, and testing helpers.
3. Adapt all maintained callers, examples, and API documentation directly.
4. Cheap preflight and focused evidence, then aggregate specialist review findings.
5. Resolve findings, run release-readiness security review and verify:release after
   convergence, and confirm coverage and final-SHA CI.
6. One version-only common unused workspace version commit; internal pins and lock
   updates separate. Push each commit. No PR creation or merge is authorized.
