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
final release verification, version commits and exact-SHA CI remain.

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

Parent edits maintained Markdown. Writer scopes do not overlap.
`application_documentation_review` completed the existing documentation_reviewer
assignment with explicit gpt-6-luna/medium fields and a clean disposition. It checks reader comprehension, completeness and
accuracy without documentation-writing skills. Every reviewer reads the full
ledger and accepted contracts above. Superseded historical text is outside scope
unless changed current text presents it as active behavior. Collect the entire
four-concern wave before one correction batch. Final release-readiness security
review uses the existing security_reviewer with explicit gpt-6-sol/high.

All four specialist concerns are resolved. The original explicit profiles matched
every dispatch and affected re-review; runtime introspection was unavailable.
Accepted corrections cover managed endpoint/wrapper capture, startup failure
cleanup, ThirdParty attachment and broker readiness before handler activation,
independent-Application cleanup after a sibling endpoint failure, caller/test
helper cleanup, retryable ReleaseStudio close, synchronous under() configuration,
private constructor declarations, and endpoint-resource TSDoc. Regression tests
failed before the relevant fixes and pass afterward. Re-review was limited to
affected concerns; no unrelated design expansion was accepted.

The broad ThirdParty Message input predates this change and was excluded from the
batch. No new Fieldnotes failure regression was established. Parent additionally
corrected a stale ThirdParty factory spelling in the API reference. No further
full documentation review was needed for that deterministic correction.

`application_security_review`, existing security_reviewer with explicit
`gpt-6-sol/high`, completed read-only release-readiness review with no confirmed
security regression. Its scope covered tenant admission/preparation, endpoint
authentication/subscriptions, Any handling, integration, local IPC, logging,
resource lifetime, generated registry loading and the workspace dependency change.
Both full and production dependency audits report no known vulnerabilities.

Final combined preflight passes 2,525 tests, with 15 intentional skips across
three skipped files. One stale broker handshake assertion was corrected after
source inspection: concurrent opening lets both peers observe Online and reply
with ExternalEventsWanted. The test now checks announcements and requests per
Bounded Context, domain-correct ProjectCreated metadata, empty withdrawals and
complete publisher cleanup. All 49 focused integration tests also pass. No
production change was needed for that assertion correction.

The next common version `2.0.0-snapshot.31` is unpublished for all 21 public
workspace packages, verified directly against npm. All 41 manifests are still at
`.30`; no version commit has been made yet. Official master was fetched again and
remains the recorded baseline.

Current implementation: Application assembles all Bounded Contexts and shared
query routes before activation. The singleton, public completeSetup, direct
Bounded Context construction, Server.add and tenant-index overrides are removed.
Shared endpoints, managed/browser processes, tenant preparation, retryable cleanup,
BlackBox and maintained examples use the accepted Application contract directly.
The JVM comparison also corrected repeated configuration calls: each use/under
preserves other settings, captures the supplied object, and rejects use after
build. Its regression failed before the fix and passes afterward.

Verification completed:

- Provider checkpoint `2a49166c3` is committed and pushed. All 159 focused provider
  tests pass after independent review; subsequent PostgreSQL method-length cleanup
  preserves behavior and awaits the Application commit.
- Disposable live checks pass: PostgreSQL 16 and 18 (33 selected cases each), MySQL
  8.4 (37), and Datastore emulator (21). Five cross-provider/engine cases are skipped
  in each configured suite. Separate Agent persistence checks pass for PostgreSQL
  (2), MySQL (3), and Datastore (4).
- Adapted live examples pass: native PostgreSQL preparation (3), Agent interruption
  recovery (6), Orders PostgreSQL restart (4), Orders Datastore tenant isolation
  (1), and Fieldnotes PostgreSQL persistence/restart/paging (6). All task-only
  containers were removed; existing services and data were untouched.
- Combined server/testing suites pass 2,515 tests, with 15 skipped tests and three
  skipped files. The added Application kernel regressions pass all 30 cases:
  default-index failed close retries, retained failed-opening cleanup, and
  administrative rejection after closure. These cases required no runtime fix.
- Changed-file formatting, ESLint, whitespace, cleanup, TSDoc, affected build and
  full tooling typecheck pass. Fixture-generation contracts pass 29 tests.
  API documentation, audience checks, all Markdown TypeScript snippets and changed
  Mermaid parse checks pass.
- Selected changed-production-file coverage: 93.89% lines, 92.28% statements,
  96.29% functions and 85.47% branches before the final three regressions. Its
  inherited global branch threshold made the scoped command exit nonzero. This
  does not establish full-repository coverage. The release gate must still reach
  at least 90% in all four metrics; no threshold is changed. Application had
  98.22% line coverage. Remaining invalid-object guards and unreachable internal
  invariants do not justify tests that merely mirror implementation.

Remaining estimate: 0.75–1.5 hours for release verification, any gate corrections,
version commits and remote synchronization. Use
`verify:release` because this changes shared runtime, public contracts and callers.
Run it once after review convergence; a failed gate returns to cheap preflight
before another attempt.

The Build workflow runs on pull requests, not feature-branch pushes or manual
dispatch. No final-SHA Build run exists. Finish local work and pushes before
seeking any necessary PR publication approval. No PR or issue mutation is
currently authorized.

Remaining work:

1. Commit and push the reviewed implementation.
2. Create and push the version-only commit for the unused common workspace
   version, with internal dependency pins and lockfile updates in a separate commit.
3. Run the release gate, including global coverage, then verify the final remote
   SHA. Request only the approval needed to start required PR-only CI after local
   work is ready.
