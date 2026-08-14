# Agentic Review Remediation Plan

Status: Validation complete; remediation sequence active

Validated baseline: `origin/main` at `0ffbdfa4`

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

## Finding ledger

| ID     | Verdict              | Kind                      | Opinion and required disposition                                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | -------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P-01` | **True**             | Missing feature           | Bounded Contexts own isolated event buses and no integration broker consumes external-event intent. This is a material DDD capability gap, although the public API reference already records the broker exclusion. Implement only after the bug and evidence Waves, beginning with an explicit same-process classification/exchange contract.                                                                    |
| `P-02` | **False / obsolete** | No action                 | `BoundedContext.catchUpReadSide()` already rebuilds a Projection from stored events and is covered by server and To-Do tests. The separate unsupported Inbox `CATCH_UP` delivery label does not make the public rebuild feature absent. Do not reimplement it.                                                                                                                                                   |
| `P-03` | **Partly true**      | Intentional divergence    | TypeScript deliberately falls back to the first field when the producer ID is type-incompatible. The behavior is covered, documented in public TSDoc, and recorded in the decision log. Keep it; do not copy an unchecked JVM cast. Only comparative JVM wording remains optional evidence work.                                                                                                                 |
| `P-04` | **Partly true**      | Documentation defect      | Runtime-architecture enrichment wording is false and domestic/external wording needs a deferred qualifier. The architecture README already says enrichment is contract-only, so that subclaim is false. The claimed current-JVM proof for first-field and non-event-sourced wording is not locally reproducible from the pinned corpus; correct only claims established by pinned evidence.                      |
| `A-01` | **Partly true**      | Package-boundary feature  | TypeScript compiler tooling does live in the server runtime package and creates the wrong dependency direction. This is install/publication architecture debt, not a runtime bug. Move analyzer/codegen ownership to tooling while preserving generated-registry contracts.                                                                                                                                      |
| `A-02` | **Partly true**      | Public SPI design         | Eight exported `internal/*` paths are importable after publication, but several are genuine cross-package provider/codegen SPIs. The review's proposed direct sibling-source imports would fail normal package export-map use. Formalize narrow versioned SPI entry points or move ownership; do not merely delete exports.                                                                                      |
| `A-03` | **True**             | Optional-feature boundary | The server eagerly reaches browser hosting, making auth a hard runtime dependency even for native-only applications. An optional peer alone is insufficient because the import is eager. Split or lazily load the browser-host adapter with a deliberate public-type migration.                                                                                                                                  |
| `S-01` | **True**             | Security defect           | Native nodes trust caller-supplied actor/tenant context. Combined mode is loopback-contained, but shipped distributed GKE/GCE defaults do not enforce Gateway-only node access. Add default-deny/role-specific network policy and deployment-specific warnings first; authenticated node channels are later defense in depth.                                                                                    |
| `S-02` | **Partly true**      | Missing security control  | A principal that can write the selected registry records can claim a vacant or expired node identity and redirect Gateway traffic. It is not every application-storage writer in every deployment. Separate registry IAM/namespace is the immediate control; signed leases require an explicit key lifecycle.                                                                                                    |
| `S-03` | **True**             | Supply-chain defect       | The fresh audit confirms seven advisories. Production example chains include `brace-expansion` and `uuid`; tooling chains include `postcss`, `nanoid`, and `js-yaml`. Upgrade parent dependencies first and add a networked CI/release audit without making deterministic offline checks network-dependent.                                                                                                      |
| `S-04` | **False**            | No action                 | Auth routes do enforce missing and allowlisted Origin policy inside `dispatchAuth()`. The review stopped at the outer dispatcher. Do not impose GET-only callbacks; that could break legitimate OIDC `form_post`.                                                                                                                                                                                                |
| `S-05` | **True, contingent** | Missing security feature  | Datastore accepts any structurally valid tenant namespace while MySQL admits configured tenants only. This becomes exploitable when `S-01` permits direct node access. After network containment, define optional tenant provisioning/admission semantics rather than relying on discovery.                                                                                                                      |
| `X-01` | **True**             | Runtime/performance bug   | MySQL never overrides query-plan capabilities or execution. Feature/comparison plans reject, while admitted equality plans can fetch the whole storage group and filter in Node. Reproduce without stubbing, implement SQL pushdown, and add cross-provider query conformance.                                                                                                                                   |
| `D-01` | **True**             | Bounded-resource bug      | Delivered Inbox rows are never removed; `keepUntil` affects deduplication only. Storage grows forever. Define default retention, add shard-fenced cleanup across providers, and verify crash/retry behavior without weakening deduplication.                                                                                                                                                                     |
| `C-01` | **True**             | User-visible runtime bug  | The review reproduced stream termination after successive Message Board updates on the current runtime lineage, and no relevant production file changed afterward. Existing browser acceptance proves one late update, not three consecutive passive-viewer updates. Reproduce on current `main`, isolate native versus Gateway streaming, fix, and retain a two-tab multi-update regression.                    |
| `I-01` | **True**             | Missing evidence          | Proto source equality is strong contract evidence but no JVM runtime encodes/decodes messages or serves a request in the suite. Add pinned JVM-produced golden bytes in both directions, then a bounded JVM/TS service interop profile. Do not claim runtime interoperability from source equality alone.                                                                                                        |
| `T-01` | **Partly true**      | Test/evidence gap         | The default release run skips live MySQL and Datastore suites, so external-service behavior is absent. However, the claim that both adapter packages are excluded from coverage is false: the root coverage configuration explicitly includes all adapter sources, and deterministic provider tests exercise much of them. Report per-package coverage and skipped live profiles, then run both providers in CI. |

## Documentation sub-dispositions for `P-04`

1. Mark event enrichment as deferred/unsupported in the runtime architecture.
2. Qualify domestic/external event classification as future work tied to
   cross-context exchange.
3. Leave `docs/architecture/README.md` unchanged: it already labels enrichment
   as a copied contract rather than runtime behavior.
4. Do not claim verified current-JVM first-field parity until the pinned JVM
   implementation is available to the repository check. The TypeScript default
   command rule itself remains correct.
5. Reword the non-event-sourced statement only with pinned upstream evidence;
   the TypeScript runtime behavior itself is not defective.

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
  boundaries;
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

### Wave 15 — Registry And Tenant Admission Hardening

- `S-02`: isolate registry credentials/storage and decide whether signed leases
  are required, including rotation and Gateway verification;
- `S-05`: define tenant provisioning, admission, retirement, and optional
  allowlisting consistently across Datastore and MySQL;
- consider authenticated node channels only as a designed extension of the
  secure network defaults from Wave 13.

These are missing defense-in-depth and admission features. They follow concrete
bugs but precede topology expansion.

### Wave 16 — Publishable Package And SPI Boundaries

- `A-01`: move build-time handler analysis/codegen out of the server runtime;
- `A-02`: replace accidental-looking internal exports with deliberate,
  documented, versioned SPIs or corrected ownership;
- `A-03`: split or lazily load browser/auth hosting so native server consumers
  do not install optional auth runtime code.

Do this before adding a new public cross-context API, so the next capability is
built on the package surface intended for publication.

### Wave 17 — Cross-Context Event Exchange

- `P-01`: define external-event interest/classification, same-process routing,
  loop prevention, ordering, tenant propagation, duplicate semantics, and
  failure isolation;
- prove exchange between two Bounded Contexts without introducing provisional
  cross-process or multiple-Gateway APIs;
- decide separately whether cross-process integration belongs with a later
  topology Wave.

This is the only confirmed missing domain capability in the parity review. It
comes after correctness, security, evidence, and package-boundary stabilization.

### Wave 18 — Multiple-Gateway Behavior

The former Wave 12 is renumbered to Wave 18 without expanding its scope. It
still requires human Q&A and a separate architecture plan. Cloud Run remains
excluded. Multiple-Gateway work begins only after all accepted agentic-review
defects and missing features above are integrated, release-verified, and remote
`main` again has no extra branches or tags.

## Explicit non-work

- Do not implement `P-02`; Projection catch-up already exists.
- Do not change `P-03` routing behavior without new human direction.
- Do not implement the proposed `S-04` GET-only rule.
- Do not claim all adapter code was excluded from coverage under `T-01`.
- Do not modify or commit the human-owned agentic-review folder.
- Do not begin the previously deferred multiple-Gateway Wave until Waves 12
  through 17 are complete.
