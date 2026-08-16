# Agentic Review Remediation Plan

Status: Strict capability revalidation complete; remediation sequence active

Validated baseline: `origin/main` at `10d0a415`

This plan validates the human-owned review in
`agentic-review-of-main-branch-14-Aug-2026` against current `main`. The review
folder remains untracked and read-only. Accepted defects and security problems
come first, evidence and documentation corrections come next, and missing
features follow. Every older deferred Wave moves behind this sequence.

## Validation method

- TypeScript/API and JVM-parity validation used the existing
  `typescript_api_docs_reviewer`, explicitly configured as
  `gpt-5.6-terra` / high.
- Security validation used the existing `security_reviewer`, explicitly
  configured as `gpt-5.6-terra` / high.
- Delivery, storage, browser, and coverage findings were traced through current
  production code, test configuration, release evidence, and the review's
  recorded runtime reproduction.
- The desktop surface exposed the configured reviewer roles and profiles, but
  not additional runtime model telemetry.
- A fresh `pnpm audit --audit-level=low --json` on 2026-08-14 confirmed seven
  advisories: five high, two moderate, and zero critical.

The second validation applies these stricter rules:

- a similarly named helper does not satisfy a JVM capability;
- local or test-only behavior does not satisfy a durable/distributed contract;
- source-file coverage does not prove a provider-backed execution path;
- an intentional behavior difference remains a real compatibility divergence;
- an imperfect suggested fix does not make a correctly observed finding partial.

## Finding ledger

Strict result: `P-01` is resolved by Wave 13; 15 findings remain open in
substance, and `S-04` is the only false finding. Qualifiers below correct scope
or remediation without turning a real finding into partial completion.

| ID     | Verdict                      | Kind                      | Opinion and required disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ---------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P-01` | **Resolved by Wave 13**      | Missing feature           | T-0195 through T-0201 implement JVM-equivalent domestic/external event exchange across isolated Bounded Contexts, exact typed Protobuf channels, same-process in-memory transport, and a genuine two-process ZeroMQ application flow. T-0202 owns final documentation, review, security, release, and remote closure; no test-only forwarder receives credit.                                                                                                                                                                                                                    |
| `P-02` | **True — not done properly** | Missing feature           | Spine TS does not implement Projection catch-up. `BoundedContext.catchUpReadSide()` is a legacy-named, context-wide, process-local clear-and-replay maintenance helper. It offers no Projection repository boundary, target IDs, starting time, `CatchUpId`, durable progress, Inbox `CATCH_UP` delivery, historical/live coordination, overlap guard, restart, resumption, or multi-instance execution. It is not credited as partial completion. Build the real capability from the JVM contract and separately decide whether to remove, rename, or internalize the helper.   |
| `P-03` | **True**                     | Intentional divergence    | TypeScript falls back to the first field when the producer ID is type-incompatible; JVM uses the producer and its unchecked cast fails. This is a real observable compatibility difference. The TS behavior may be preferable, but tests and an internal decision do not erase the divergence. Retain it only as an explicit human-approved public divergence, with comparative documentation and porting tests.                                                                                                                                                                 |
| `P-04` | **True**                     | Documentation defect      | Current framework documents contain stale or false runtime/parity claims: domestic/external event handling and event enrichment are requirements that TS does not implement; the reduction inventory wrongly doubts verified JVM first-field routing; the technical spec frames non-event-sourced aggregates as TS-specific although current JVM matches; and several public docs mislabel the local reset/replay helper as catch-up. One review subclaim is rejected: the architecture README's enrichment list is explicitly Proto-contract-only, not a runtime-support claim. |
| `A-01` | **True**                     | Package-boundary defect   | TypeScript compiler tooling lives in the server runtime package, pins the compiler as a production dependency, and reverses the intended runtime/tooling dependency direction. Move analyzer/codegen ownership to tooling while preserving generated-registry contracts.                                                                                                                                                                                                                                                                                                         |
| `A-02` | **True**                     | Public SPI defect         | Eight `internal/*` subpaths are exported and therefore become supported import paths at publication. Some are genuine cross-package SPIs, which changes the correct repair but not the finding. Move ownership or replace them with deliberately named, documented, versioned SPI boundaries; do not use direct sibling-source imports.                                                                                                                                                                                                                                          |
| `A-03` | **True**                     | Optional-feature boundary | The server eagerly reaches browser hosting, making auth a hard runtime dependency even for native-only applications. An optional peer alone is insufficient because the import is eager. Split or lazily load the browser-host adapter with a deliberate public-type migration.                                                                                                                                                                                                                                                                                                  |
| `S-01` | **True**                     | Security defect           | Native nodes trust caller-supplied actor/tenant context. Combined mode is loopback-contained, but shipped distributed GKE/GCE defaults do not enforce Gateway-only node access. Enforce Gateway-only/default-deny reachability in shipped deployments and add authenticated node channels or a cryptographically authenticated trusted-context boundary for distributed mode; documentation alone does not close the defect.                                                                                                                                                     |
| `S-02` | **True**                     | Missing security control  | In the GCE registry-backed topology, any principal able to write the registry records can claim a vacant or expired node identity and redirect authenticated Gateway traffic. The finding is scoped to that registry path, not every deployment. Separate registry IAM/namespace is the immediate control; signed leases require an explicit key lifecycle.                                                                                                                                                                                                                      |
| `S-03` | **True**                     | Supply-chain defect       | The fresh audit confirms seven advisories. Production example chains include `brace-expansion` and `uuid`; tooling chains include `postcss`, `nanoid`, and `js-yaml`. Upgrade parent dependencies first and add a networked CI/release audit without making deterministic offline checks network-dependent.                                                                                                                                                                                                                                                                      |
| `S-04` | **False**                    | No action                 | Auth routes do enforce missing and allowlisted Origin policy inside `dispatchAuth()`. The review stopped at the outer dispatcher. Do not impose GET-only callbacks; that could break legitimate OIDC `form_post`.                                                                                                                                                                                                                                                                                                                                                                |
| `S-05` | **True**                     | Missing security feature  | Datastore accepts any structurally valid tenant namespace while MySQL admits configured tenants only. `S-01` makes the difference directly exploitable, but the provider inconsistency exists independently. After network containment, define tenant provisioning/admission semantics rather than relying on discovery.                                                                                                                                                                                                                                                         |
| `X-01` | **True**                     | Runtime/performance bug   | MySQL never overrides query-plan capabilities or execution. Feature/comparison plans reject, while admitted equality plans can fetch the whole storage group and filter in Node. Reproduce without stubbing, implement SQL pushdown, and add cross-provider query conformance.                                                                                                                                                                                                                                                                                                   |
| `D-01` | **True**                     | Bounded-resource bug      | Delivered Inbox rows are never removed; `keepUntil` affects deduplication only. Storage grows forever. Define default retention, add shard-fenced cleanup across providers, and verify crash/retry behavior without weakening deduplication.                                                                                                                                                                                                                                                                                                                                     |
| `C-01` | **True**                     | User-visible runtime bug  | The review reproduced stream termination after successive Message Board updates on the current runtime lineage, and no relevant production file changed afterward. Existing browser acceptance proves one late update, not three consecutive passive-viewer updates. Reproduce on current `main`, isolate native versus Gateway streaming, fix, and retain a two-tab multi-update regression.                                                                                                                                                                                    |
| `I-01` | **True**                     | Missing evidence          | Proto source equality is strong contract evidence but no JVM runtime encodes/decodes messages or serves a request in the suite. Add pinned JVM-produced golden bytes in both directions, then a bounded JVM/TS service interop profile. Do not claim runtime interoperability from source equality alone.                                                                                                                                                                                                                                                                        |
| `T-01` | **True**                     | Test/evidence gap         | The default release gate skips every live MySQL and Datastore suite, and the broken MySQL query-plan method is replaced by a stub in the only nearby contract test. V8 includes adapter source files in its denominator and deterministic tests exercise some adapter logic, so the review title is imprecise; nevertheless, no percentage derived without provider-backed execution establishes production-adapter behavior. Report per-package and per-profile coverage, then run both providers in CI.                                                                        |

## Documentation sub-dispositions for `P-04`

1. Mark event enrichment as deferred/unsupported in the TypeScript runtime
   architecture. Do not justify this by claiming current JVM removed it: the
   pinned JVM mainline still contains active enrichment code.
2. Resolved by Wave 13: domestic/external event classification and its
   cross-context exchange are implemented and documented as current runtime behavior.
3. Leave the Proto-contract enrichment list in `docs/architecture/README.md`
   unchanged: it explicitly excludes runtime behavior.
4. Mark first-field command routing as verified parity. The local pinned JVM
   checkout at `origin/master` `461a8281` uses `DefaultCommandRoute` backed by
   `ByFirstField`, which reads descriptor field index zero.
5. Reword non-event-sourced aggregate framing as current parity; the same pinned
   JVM `Aggregate.kt` says event sourcing and `@Apply` were removed.
6. Remove every public/framework claim that `catchUpReadSide()` is Projection
   catch-up. Describe it only as a legacy-named local reset/replay helper until
   Wave 16 decides whether it survives under a truthful name.

## Remediation Waves

The Wave numbers are execution order. On 2026-08-15 the human replaced the
earlier ordering with this binding sequence:

| Wave | Feature group                                      | Review findings owned                                                      |
| ---- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| 12   | Runtime correctness and bounded delivery           | `C-01`, `X-01`, `D-01`, current-runtime part of `P-04`                     |
| 13   | JVM-equivalent cross-context event exchange        | `P-01`                                                                     |
| 14   | Publishable package and SPI boundaries             | `A-01`, `A-02`, `A-03`                                                     |
| 15   | Registry integrity and tenant admission            | `S-02`, `S-05`                                                             |
| 16   | JVM-equivalent Projection catch-up                 | `P-02`                                                                     |
| 17   | Secure distributed defaults and dependency hygiene | `S-01`, `S-03`                                                             |
| 18   | Release evidence and coverage truth                | `T-01`, `I-01`, `P-03`, remaining comparative part of `P-04`               |
| 19   | Multiple-Gateway behavior                          | Previously deferred capability; no agentic-review finding claims it exists |

`S-04` has no Wave because it is false. Auth callbacks already enforce the
Origin policy in `dispatchAuth()`, and forcing GET-only callbacks could break
legitimate OIDC `form_post`. No roadmap work may treat `S-04` as an accepted
defect.

All roadmap work previously deferred beyond Wave 11 is subordinate to this
sequence. It must not begin before the accepted review findings are closed
through Wave 18. Multiple-Gateway work is the sole named Wave 19 scope; any
other older deferral moves after Wave 19 unless the human explicitly reorders
it.

### Wave 12 — Runtime Correctness And Bounded Delivery

**Purpose:** repair the three confirmed operational bugs before adding another
framework capability. This is the next Wave and the starting point for the new
development chat.

**Feature 1 — sustained browser subscriptions (`C-01`):**

- reproduce the reported termination on current `main` before changing runtime
  code, using the real browser/Gateway path and a passive subscriber;
- trace native subscription production separately from Gateway and gRPC-Web
  forwarding so the failing lifecycle boundary is identified rather than
  hidden by retries;
- keep one passive viewer subscribed through at least three sequential updates
  produced elsewhere, and include a two-tab case in which one tab only watches;
- preserve the documented best-effort notification contract: reconnect and
  re-query remain recovery behavior, but an otherwise healthy active stream
  must not terminate after ordinary successive updates;
- retain a real-browser regression, not only a mocked stream or direct native
  client test.

**Feature 2 — MySQL query-plan execution (`X-01`):**

- reproduce the current feature/comparison rejection and equality full-scan
  behavior without replacing the adapter method with a stub;
- advertise only the query-plan capabilities the MySQL adapter really executes;
- translate admitted equality, comparison, and supported composite plans into
  parameterized SQL while preserving tenant and storage-group containment;
- reject unsupported plans explicitly instead of silently fetching a whole
  group for Node-side filtering;
- run the same query cases against the in-memory contract and live MySQL, and
  include Datastore where its capability model overlaps.

**Feature 3 — finite Inbox retention (`D-01`):**

- define a finite default retention policy for successfully delivered Inbox
  rows, with a deliberate configuration boundary if operators may override it;
- distinguish retention from the existing `keepUntil` deduplication window;
- delete only eligible delivered rows in bounded pages; never delete pending,
  claimed, retryable, or still-protected deduplication records;
- perform cleanup under the existing shard ownership and fencing rules so a
  stale owner cannot delete another owner's data;
- prove crash/restart, retry, duplicate, expired-row, and multi-provider
  behavior, including a bounded-resource test that storage stops growing under
  sustained successful delivery.

**Documentation correction (`P-04`):** update only claims touched by these
runtime boundaries, keep unsupported behavior labeled unsupported, and do not
call the local reset/replay helper Projection catch-up.

**Done when:** each bug has a failing-before/passing-after behavior proof; the
real browser, live MySQL, and applicable storage-provider profiles pass; cleanup
is bounded and fence-safe; affected public docs describe only implemented
behavior; specialist review and final Wave security review converge; one
release verification passes after corrections; `main` is post-merge verified
and `origin` again contains only `main` and no tags.

**Excluded:** cross-context event exchange, package restructuring, Projection
catch-up, multiple Gateways, and Cloud Run.

These defects affect normal user-visible delivery, production query scale, and
unbounded storage. They therefore precede every feature or publication cleanup.

### Wave 13 — JVM-Equivalent Cross-Context Event Exchange

**Purpose:** close `P-01`, the missing JVM-style integration capability. A
same-process event forwarder alone is not completion.

**Feature scope:**

- inspect and pin the relevant JVM `IntegrationBroker` contract before freezing
  the TypeScript public or serialized design;
- define how a Bounded Context declares interest in external events and how
  domestic events become eligible for export without exposing every event;
- deliver the same domain contract between contexts in one process and between
  transport-separated application processes;
- preserve event identity, tenant context, ordering guarantees, and handler
  semantics across the boundary;
- delegate delivery strength, reconnect behavior, and bounded adapter queues to
  the selected transport; add no broker Inbox, retry queue, deduplication,
  replay cursor, restart checkpoint, or fencing policy;
- prevent an imported external event from being re-exported indefinitely;
- prove same-process and cross-process behavior against pinned JVM semantics,
  including wanted-interest changes, context close, malformed intake, and one
  normal application event crossing real Node processes.

**Done when:** applications can declare and execute real cross-context event
exchange through one coherent contract in both deployment shapes; no test-only
forwarder is counted as the feature; compatibility and reliability reviewers
accept the semantics; security reviews tenant propagation and transport trust;
the release gate and post-merge checks pass. T-0195 through T-0201 are complete;
T-0202 is the current documentation, review, security, release, and remote
closure task.

**Excluded:** multiple-Gateway selection/failover and Cloud Run. Wave 13 may use
the current package boundaries; Wave 14 must subsequently preserve or migrate
its deliberate public/SPI contracts without changing its semantics.

### Wave 14 — Publishable Package And SPI Boundaries

**Purpose:** close `A-01` through `A-03` before more public surface is added.

**Feature scope:**

- move TypeScript compiler analysis and handler-code generation out of the
  server runtime package, so runtime consumers do not install compiler tooling
  as a production dependency;
- preserve generated handler-registry behavior and clean-build generation while
  correcting the dependency direction;
- inventory all eight exported `internal/*` subpaths and, one by one, either
  move ownership to the consuming package or replace the path with a named,
  documented, versioned SPI;
- prohibit cross-package imports from sibling source trees and prove package
  consumers work from packed artifacts and declared exports only;
- split or lazy-load browser/auth hosting so a native-only server does not load
  or require the optional authentication runtime;
- plan any public-type migration explicitly; do not disguise a breaking import
  change as an internal refactor.

**Done when:** packed native-server installation has no compiler or optional
browser-auth runtime dependency, every cross-package seam has deliberate
ownership, clean packed-tarball consumers build, and the package/API inventory
contains no accidental `internal/*` public contract.

**Excluded:** new runtime features. Wave 14 must preserve the Wave 13 event-
exchange behavior while moving its boundaries.

### Wave 15 — Registry Integrity And Tenant Admission

**Purpose:** close `S-02` and `S-05` as deliberate admission and identity
features after package/SPI ownership is stable.

**Feature 1 — registry integrity (`S-02`):**

- define the trust model for GCE registry writers and readers;
- separate registry credentials and namespace from ordinary application
  storage access, with least-privilege IAM and deployment policy tests;
- prevent an arbitrary storage writer from claiming a vacant or expired node
  identity and redirecting Gateway traffic;
- decide during architecture planning whether isolated IAM is sufficient or
  signed leases are required; if leases are signed, specify key issuance,
  rotation, revocation, verification, and failure behavior;
- prove lease expiry, stale replacement, concurrent claim, restart, and
  unauthorized-write cases.

**Feature 2 — tenant admission (`S-05`):**

- define provider-neutral tenant provisioning, admission, retirement, and
  optional allowlisting semantics;
- make MySQL and Datastore enforce the same application-level tenant policy,
  while retaining provider-native physical isolation choices;
- ensure discovery of a structurally valid namespace is not itself permission
  to create or access a tenant;
- test unknown, retired, concurrently provisioned, and cross-tenant access in
  both providers.

**Done when:** registry authority is narrower than application data authority,
node identity cannot be stolen through ordinary registry writes, tenant
admission is consistent across providers, deployment guidance is executable,
and the security reviewer accepts the lifecycle and trust boundaries.

**Excluded:** this Wave does not by itself claim all distributed node channels
are authenticated; Wave 17 owns secure distributed defaults.

### Wave 16 — JVM-Equivalent Projection Catch-Up

**Purpose:** close `P-02`. Projection catch-up is currently not implemented;
`catchUpReadSide()` is not partial completion and must not shape the new public
contract.

**Public feature contract:**

- expose catch-up from the Projection repository boundary;
- accept a historical starting point and either selected Projection IDs or an
  explicit catch-up-all operation;
- return the generated `CatchUpId` operation identity used by the JVM contract;
- define admission and overlap rules, progress observation, completion,
  failure, cancellation only if supported by the pinned contract, and tenant
  scope.

**Runtime feature contract:**

- persist catch-up jobs and their progress so work resumes after process or node
  restart;
- page historical events from the EventStore instead of loading an unbounded
  history;
- coordinate historical events with newly arriving live events through the
  Inbox `CATCH_UP` / `TO_CATCH_UP` lifecycle;
- define ordering, deduplication, idempotency, retry, overlap, multi-node
  ownership, fencing, and finalization behavior;
- preserve the pinned JVM exclusion of state-update subscriptions unless the
  human approves a deliberate divergence.

**Legacy helper disposition:** remove `catchUpReadSide()`, rename it as a local
maintenance-only reset/replay utility, or internalize it. Its current behavior
and tests earn zero acceptance credit for this Wave.

**Done when:** catch-up survives restart and node handoff, handles live-event
overlap without gaps or double application, exposes durable progress by
`CatchUpId`, supports selected IDs and catch-up-all, and passes JVM comparative,
provider-backed, reliability, API, documentation, and security review.

### Wave 17 — Secure Distributed Defaults And Dependency Hygiene

**Purpose:** close the actual distributed trust defect `S-01` and the verified
supply-chain defect `S-03` after the preceding runtime capabilities have stable
network and package surfaces.

**Feature 1 — secure distributed defaults (`S-01`):**

- ship Gateway-only/default-deny application-node reachability for GKE and
  narrower role-specific ingress for GCE;
- add authenticated node channels or a cryptographically authenticated trusted-
  context boundary; a forgeable actor/tenant header and network policy alone do
  not establish application identity;
- bind actor and tenant context to authenticated Gateway authority before native
  handlers trust it;
- preserve required health and operations access without exposing application
  RPCs;
- verify direct-node denial, forged-context rejection, replay resistance,
  credential rotation, node restart, and failure modes in deployment-level
  tests.

**Feature 2 — dependency hygiene (`S-03`):**

- upgrade the parent dependency chains responsible for the confirmed seven
  advisories, not merely transitive lockfile entries;
- run compatibility tests for production examples, browser/auth paths, tooling,
  generation, and packaging;
- add a networked CI/release audit lane with recorded policy and exception
  handling while keeping deterministic offline verification independent of
  registry availability.

**Done when:** shipped distributed modes deny unauthenticated direct node use,
trusted context is cryptographically bound, the dependency audit meets the
recorded policy, deployment and runtime tests pass, and final security review
is clean or records explicit human-accepted exceptions.

### Wave 18 — Release Evidence And Coverage Truth

**Purpose:** close `T-01`, `I-01`, and the remaining `P-03`/`P-04` evidence and
documentation work only after the implementation Waves are integrated.

**Feature 1 — provider-backed coverage truth (`T-01`):**

- report coverage by package and verification profile instead of presenting one
  aggregate percentage as proof of every adapter;
- make skipped MySQL and Datastore suites visible in release output;
- run live MySQL and Datastore-emulator profiles in CI/release evidence;
- prohibit stubbing the exact adapter method whose production behavior a test
  claims to prove;
- distinguish source inclusion in V8 accounting from provider-backed execution.

**Feature 2 — runtime interoperability proof (`I-01`):**

- keep Proto source equality as contract evidence, not runtime proof;
- add pinned JVM-produced bytes decoded by TypeScript and TypeScript-produced
  bytes decoded by JVM for representative contracts;
- run at least one bounded real JVM/TypeScript service interaction through the
  supported transport and record the pinned JVM revision;
- fail clearly when the JVM fixture/runtime revision drifts.

**Feature 3 — parity decisions and documentation (`P-03`, `P-04`):**

- retain the producer-ID fallback only if the human explicitly accepts it as a
  public TS/JVM divergence; otherwise implement the separately approved change;
- publish comparative tests and porting guidance for the accepted behavior;
- ensure event exchange, enrichment, first-field routing, non-event-sourced
  aggregates, and Projection catch-up are described exactly as implemented and
  verified—never inferred from similarly named helpers.

**Done when:** every release claim points to an executable profile, live
providers and pinned JVM interoperability run in the release evidence, public
documentation contains no known parity fiction, repository coverage remains at
or above the required threshold, and the fully converged release is reviewed,
verified, integrated, post-merge verified, and remotely clean.

### Wave 19 — Multiple-Gateway Behavior

**Purpose:** execute the previously deferred multiple-Gateway capability only
after every accepted agentic-review finding is closed through Wave 18.

**Planning boundary:** Wave 19 starts with human Q&A and a separate high-risk
architecture plan. That planning must decide Gateway discovery, client
selection, failover, subscription ownership, duplicate suppression,
coordination, rollout, configuration, health, observability, and deployment
semantics before implementation begins.

**Done when:** the human-approved multiple-Gateway contract is implemented and
proved under the repository protocol. No earlier Wave may add a provisional
multiple-Gateway API.

**Excluded:** Cloud Run remains outside the offering unless the human separately
authorizes it.

## Explicit non-work

- Do not present `catchUpReadSide()` as Projection catch-up or as partial
  completion of it. Until Wave 16 decides its fate, describe it only as a
  legacy-named process-local whole-read-side reset/replay utility.
- Do not change `P-03` routing behavior without new human direction.
- Do not implement the proposed `S-04` GET-only rule.
- Do not claim adapter source files are absent from V8 accounting under `T-01`,
  and do not treat that accounting as provider-backed execution.
- Do not modify or commit the human-owned agentic-review folder.
- Do not begin the previously deferred multiple-Gateway Wave until Waves 12
  through 18 are complete.
