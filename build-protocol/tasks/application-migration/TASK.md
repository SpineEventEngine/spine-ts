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
proposal or review transcripts. Implementation and focused review are accepted;
final release verification and exact-SHA CI remain.

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
  configuration is synchronous and does not connect services. Repeated `use()` or
  `under()` calls preserve other named settings for the same profile, matching
  JVM TypeConfigurator’s per-setting updates. Capture the supplied settings and
  reject retained configurator calls after the builder is used.
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
- Administrative preparation failure after startup affects that operation only,
  through both Application-wide and narrower Bounded Context runtime methods.
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
- ManagedServerApplication receives subscriptionQueueCapacity explicitly for its
  Coordinator. This preserves the existing configurable queue/default while
  removing its singleton lookup. Child Application capacity is configured separately.
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

Skills: test-driven-development and verification-before-completion were read in
full from the installed obra/superpowers skills. The expected inventory and
`~/.agents/.skill-lock.json` confirm provenance and readable task-relevant paths.
No documentation-writing skill or skill installation is needed. Desktop supports
explicit child profiles. Runtime introspection was unavailable; acceptance uses
explicit dispatch fields and the immutable configured role/profile.

Assignments and dispositions:

| Assignment                       | Existing role or function            | Explicit profile   | Scope and disposition                                                                                                                                                              |
| -------------------------------- | ------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| application_architecture         | requirements_splitter                | gpt-6-astra / high | Accepted architecture pass, no unexplained Entity-family difference.                                                                                                               |
| application_callers              | Orchestrator read-only scanning      | gpt-6-luna / low   | Completed caller inventory.                                                                                                                                                        |
| application_provider_preparation | implementer                          | gpt-6-sol / medium | Provider preparation caches and regressions, complete.                                                                                                                             |
| application_provider_review      | performance_reliability_reviewer     | gpt-6-sol / medium | Accepted after preserving prior schema signatures on failed recheck.                                                                                                               |
| application_implementation       | implementer                          | gpt-6-sol / medium | Server production, new Application tests, persistent index, ThirdParty, six managed fixtures, and Stand retry assertion. Implementation complete, retained for review corrections. |
| application_external_callers     | implementer                          | gpt-6-sol / medium | Maintained external production/tests/scripts, plus transferred SpineServices and Server suites. Complete, retained for corrections.                                                |
| application_server_tests         | implementer                          | gpt-6-sol / medium | Remaining converted server tests. Complete, retained for corrections.                                                                                                              |
| application_preflight            | Orchestrator mechanical verification | gpt-6-luna / low   | Completed checks and changed-source coverage inspection.                                                                                                                           |
| application_reliability_review   | performance_reliability_reviewer     | gpt-6-sol / medium | Accepted findings resolved in affected re-review.                                                                                                                                  |
| application_api_review           | typescript_api_docs_reviewer         | gpt-6-sol / medium | Accepted findings resolved in affected re-review.                                                                                                                                  |
| application_style_review         | style_maintainability_reviewer       | gpt-6-sol / medium | Helper cleanup finding resolved in focused re-review.                                                                                                                              |

Parent edits maintained Markdown. Writer scopes do not overlap. All four review
concerns are accepted after focused corrections and affected re-review. The
documentation reviewer used explicit gpt-6-luna / medium and checked reader
comprehension, completeness and accuracy without documentation-writing skills.
The security reviewer used explicit gpt-6-sol / high and found no confirmed
security regression. Both full and production dependency audits are clean.

Accepted review corrections cover managed endpoint/wrapper capture, startup
cleanup, ThirdParty attachment and broker readiness before handler activation,
independent-Application cleanup, caller/test helper cleanup, retryable
ReleaseStudio close, synchronous under() configuration, private constructor
declarations and endpoint-resource documentation. Focused regressions demonstrate
the corrected behavior. No unexplained Entity-family difference remains.

Release version is `2.0.0-snapshot.31`, checked unpublished for all 21 public
packages. Version-only commit `d867c3f1f` changes 41 top-level manifest versions.
Commit `64a53cef9` aligns 109 internal pins, lockfile specifiers, 12 Proto
manifests and five generation markers. External dependency versions are unchanged.
Frozen installation succeeds. Both commits are pushed to the official branch.

Verification evidence:

- Server/testing suites: 2,525 passing tests, 15 intentional skips. Focused
  integration tests also check concurrent broker readiness and complete cleanup.
- Disposable live checks: PostgreSQL 16 and 18, MySQL 8.4, Datastore emulator,
  Agent persistence, native preparation, Orders restart/tenant isolation and
  Fieldnotes persistence/restart/paging all pass. Task-only containers are removed.
- Full static build, tooling typecheck, lint, formatting, cleanup, TSDoc, copyright,
  time-read, documentation API/audience/snippets, fixture generation, generated
  consistency, logging containment, production dependency and readiness checks pass.
  Changed Mermaid diagrams were parse-checked.
- Changed-source coverage was inspected before review, with focused lifecycle
  regressions added. This is not a substitute for global coverage. The required
  release gate must still establish at least 90% in all four metrics.

### Remaining release corrections

The latest full gate passed static checks but exposed 15 test failures in six files.
Isolated clean-build tests check out HEAD, so the release metadata alignment is
now committed and pushed before their focused rerun.

| Assignment                                                | Explicit profile   | Bounded responsibility                                                                                                                                         |
| --------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| application_caller_corrections, existing implementer role | gpt-6-sol / medium | Fieldnotes profile isolation, Orders cleanup spy receiver, delivery-client child-process failures. Earlier caller agent is unavailable on the current surface. |
| application_server_tests, existing implementer role       | gpt-6-sol / medium | PostgreSQL connection test expectations for repeated compatibility checks and resource release.                                                                |
| application_preflight, mechanical verification function   | gpt-6-luna / low   | Isolated clean-build tests, then complete cheap preflight and release gate after correction convergence.                                                       |

All profiles were explicit dispatch fields. Runtime introspection is unavailable.
No children or overlapping production edits are allowed. Do not weaken guards,
expected failure behavior, coverage thresholds or provider checks to pass tests.
Caller and provider corrections pass 48 focused tests, scoped formatting/lint and
tooling typecheck. Fieldnotes resets the deployment profile between tests; the
Orders spy resumes the actual instance method after its deliberate failure; the
delivery fixture explicitly supplies and closes its storage factory. PostgreSQL
assertions verify fresh checks, index queries and temporary-pool release on every
call. These are test/fixture corrections; production semantics are unchanged.
No specialist re-review is needed for this mechanical correction batch.
Remaining estimate: 1–2 hours for preflight, release verification and synchronization.

Selected final profile: `verify:release`, because the change affects shared runtime,
public contracts and maintained callers. After any failed gate, complete the cheap
preflight again before another full attempt. Generation staging and repository
scans run sequentially to avoid inspecting temporary generated directories.

Remaining work:

1. Resolve the focused failure batch and complete cheap preflight.
2. Pass the full release gate, including global coverage and Node tests.
3. Push final corrections and acceptance evidence, then verify the remote SHA.
4. Obtain only the approval needed for required PR-only CI. The Build workflow
   runs on pull requests; no final-SHA Build run or open task PR exists. No PR or
   issue mutation is authorized. Finish local work before requesting publication.
