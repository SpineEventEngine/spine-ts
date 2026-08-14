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

Strict result: 16 findings are true in substance and remain open; `S-04` is the
only false finding. Qualifiers below correct scope or remediation without
turning a real finding into partial completion.

| ID     | Verdict                      | Kind                      | Opinion and required disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ---------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P-01` | **True**                     | Missing feature           | Bounded Contexts own isolated event buses and no integration broker consumes external-event intent. This is a material DDD capability gap, although the public API reference already records the broker exclusion. Implement JVM-equivalent domestic/external event exchange across both same-process and transport-separated contexts; a same-process forwarder alone does not complete the feature.                                                                                                                                                                            |
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
2. Qualify domestic/external event classification as future work tied to
   cross-context exchange.
3. Leave the Proto-contract enrichment list in `docs/architecture/README.md`
   unchanged: it explicitly excludes runtime behavior.
4. Mark first-field command routing as verified parity. The local pinned JVM
   checkout at `origin/master` `461a8281` uses `DefaultCommandRoute` backed by
   `ByFirstField`, which reads descriptor field index zero.
5. Reword non-event-sourced aggregate framing as current parity; the same pinned
   JVM `Aggregate.kt` says event sourcing and `@Apply` were removed.
6. Remove every public/framework claim that `catchUpReadSide()` is Projection
   catch-up. Describe it only as a legacy-named local reset/replay helper until
   Wave 17 decides whether it survives under a truthful name.

## Remediation Waves

### Wave 12 — Runtime Correctness And Bounded Delivery

Fix the three confirmed operational bugs before adding capability:

- `C-01`: sustained browser subscriptions through at least three passive-viewer
  updates, with native-versus-Gateway fault isolation and real-browser proof;
- `X-01`: MySQL query-plan capability and SQL execution, plus un-stubbed
  cross-provider conformance;
- `D-01`: finite delivered-Inbox retention and cleanup under the existing shard
  ownership/fencing model;
- the confirmed `P-04` documentation corrections that describe these current
  or deferred runtime boundaries truthfully.

These defects affect normal user-visible delivery, production query scale, and
unbounded storage. They therefore precede every feature or publication cleanup.

### Wave 13 — Secure Distributed Defaults And Dependency Hygiene

- `S-01`: ship Gateway-only/default-deny node reachability for GKE and narrower
  role-specific GCE ingress, with explicit distributed-deployment threat
  boundaries; add authenticated node channels or a cryptographically
  authenticated trusted-context boundary so network reachability alone does not
  grant arbitrary actor/tenant authority;
- `S-03`: upgrade affected dependency chains, verify compatibility, and add a
  networked dependency-audit release/CI lane;
- re-run the final security review across node access, tenant context, storage
  egress, health probes, and dependency exposure.

This Wave closes actual exposure and known vulnerable dependency state. It does
not pretend that a forgeable header is node authentication.

### Wave 14 — Release Evidence And Coverage Truth

- `T-01`: record coverage per package, surface skipped provider suites, and run
  Datastore emulator and MySQL profiles in CI;
- `I-01`: narrow unsupported runtime-interoperability claims, add pinned
  bidirectional JVM/TS golden wire fixtures, then run a bounded real JVM/TS
  service profile;
- finish only the `P-03` and `P-04` comparative wording that the pinned JVM
  evidence actually proves.

This is neither defect repair nor product capability. It makes release claims
match executable evidence before the public/package surface grows.

### Wave 15 — Publishable Package And SPI Boundaries

- `A-01`: move build-time handler analysis/codegen out of the server runtime;
- `A-02`: replace accidental-looking internal exports with deliberate,
  documented, versioned SPIs or corrected ownership;
- `A-03`: split or lazily load browser/auth hosting so native server consumers
  do not install optional auth runtime code.

These are existing package/public-surface defects. Close them before missing
capabilities add more public contracts.

### Wave 16 — Registry And Tenant Admission Hardening

- `S-02`: isolate registry credentials/storage and decide whether signed leases
  are required, including rotation and Gateway verification;
- `S-05`: define tenant provisioning, admission, retirement, and optional
  allowlisting consistently across Datastore and MySQL;
- consider authenticated node channels only as a designed extension of the
  secure network defaults from Wave 13.

These are missing defense-in-depth and admission features. They follow concrete
bugs but precede topology expansion.

### Wave 17 — JVM-Equivalent Projection Catch-Up

- `P-02`: expose catch-up from the Projection repository boundary, including a
  historical starting point, optional target IDs, catch-up-all, and a returned
  generated `CatchUpId` operation identity;
- execute replay as a durable, resumable job with explicit progress, overlap
  admission, finalization, completion, and failure state;
- page the EventStore and coordinate historical and live events through the
  Inbox `CATCH_UP` / `TO_CATCH_UP` lifecycle so ordering, duplicate handling,
  restart, and multiple-node behavior are explicit;
- retain tenant isolation and define whether state-update subscriptions remain
  excluded, as they are in the pinned JVM implementation.
- decide whether `catchUpReadSide()` is removed, renamed as a local maintenance
  utility, or internalized. Its implementation and tests provide no acceptance
  credit toward Projection catch-up.

The feature is currently not done properly. This Wave closes the whole
capability gap after package boundaries are stable; it does not extend or bless
the invented local helper as the starting public contract.

### Wave 18 — JVM-Equivalent Cross-Context Event Exchange

- `P-01`: define external-event interest/classification, same-process routing,
  loop prevention, ordering, tenant propagation, duplicate semantics, and
  failure isolation;
- route the same domestic/external contract between transport-separated
  Bounded Contexts, with durable delivery/retry behavior appropriate to the
  existing runtime topology;
- prove same-process and cross-process exchange with compatibility tests against
  the pinned JVM Integration Broker semantics. This does not require or imply
  multiple-Gateway support.

This is the other confirmed missing domain capability in the parity review. It
comes after correctness, security, evidence, package-boundary stabilization,
and real Projection catch-up.

### Wave 19 — Multiple-Gateway Behavior

The former Wave 12 is renumbered to Wave 19 without expanding its scope. It
still requires human Q&A and a separate architecture plan. Cloud Run remains
excluded. Multiple-Gateway work begins only after all accepted agentic-review
defects and missing features above are integrated, release-verified, and remote
`main` again has no extra branches or tags.

## Explicit non-work

- Do not present `catchUpReadSide()` as Projection catch-up or as partial
  completion of it. Until Wave 17 decides its fate, describe it only as a
  legacy-named process-local whole-read-side reset/replay utility.
- Do not change `P-03` routing behavior without new human direction.
- Do not implement the proposed `S-04` GET-only rule.
- Do not claim adapter source files are absent from V8 accounting under `T-01`,
  and do not treat that accounting as provider-backed execution.
- Do not modify or commit the human-owned agentic-review folder.
- Do not begin the previously deferred multiple-Gateway Wave until Waves 12
  through 18 are complete.
