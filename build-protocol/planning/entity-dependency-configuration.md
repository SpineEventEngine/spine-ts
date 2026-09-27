# Entity dependency configuration

Status: implementation approved on 27 September 2026 and in progress.
Date: 27 September 2026.
Branch: `entity-dependency-configuration`.
Base: freshly fetched official `origin/master`,
`794bd524b8875f10a75777a41bbebe1dbece600b` (merged PR #10).

## Human-Imposed Requirements Ledger

- Update local master, then use a new descriptive branch from that commit.
- Investigate how repositories configure Entity instances in the latest Spine
  JVM and how applications supply external dependencies.
- Use only freshly fetched official `SpineEventEngine/core-jvm` source for JVM
  evidence, not memory, research notes, or published documentation sites.
- Examine current Spine TS implementation and tests before declaring a gap.
- Implement the approved small, TypeScript-native `onCreate` solution; identical
  JVM syntax is not required. The preceding analysis is complete.
- Continue in this chat and checkout; no additional chat or worktree, following
  the human's earlier explicit instruction.
- Beginning with the next publication, npm `latest` must point at the newest
  published snapshot. Do not mutate npm tags during this investigation.
- Use simple explanations and concrete examples. No new dependency container,
  speculative lifecycle system, or unrelated infrastructure.

## Completed analysis

The analysis covered a high-risk public creation/lifecycle contract and changed
only planning records. Its acceptance required exact JVM hook/call-site/test
references, TS construction/restore/test references, alternatives, proposed
semantics, compatibility consequences, and focused implementation tests.

Analysis estimate: 0.5–0.8 hours of source investigation, comparison, design
assessment, and reporting. No builds or tests were run during analysis.
Implementation status and verification are tracked in the
[work log](../work-logs/entity-dependency-configuration.md).

Local master was fast-forwarded without conflict. Its tree equals the reviewed
PR head. Official Publish run `36317844305` succeeded for the merged commit.
The JVM comparison is pinned to freshly fetched official master
`ea3067b137938ac0beb6920c39d11e300976fcc9`. Existing unrelated JVM working-tree
changes are preserved; read committed files with `git show` and `git grep`.

## Skills and assignments

Checked the exposed skill catalog, `build-protocol/skills/EXPECTED_SKILLS.md`,
the installed entrypoints via bounded `rg --files`, and the installed skill
lock entry. Main read the complete codebase-design skill and applies its small
interface/dependency-passing guidance. Its specialist vocabulary does not
override the human's plain-language requirement. Implementation/testing skills
were deferred during analysis and are selected in the implementation work log. Existing project
records supply planning persistence; no duplicate planning-file workflow.

Desktop supports explicit child model/reasoning dispatch. Read-only assignments
below use fresh context and may not use memory, edit files, run tests/builds, or
spawn children. Actual runtime self-inspection is not exposed; the explicit
immutable dispatch settings are the acceptance evidence absent a mismatch.

| Assignment                                             | Function                           | Model       | Reasoning |
| ------------------------------------------------------ | ---------------------------------- | ----------- | --------- |
| TS creation, restore, registration, and existing tests | Read-only repository investigation | gpt-6-sol   | medium    |
| JVM configuration hooks and tests from fetched commit  | Read-only source investigation     | gpt-6-sol   | medium    |
| Public-contract proposal assessment after evidence     | Existing requirements splitter     | gpt-6-astra | high      |

## Next publication

The human's new tag policy is binding for the next publication. Preserve the
existing snapshot access and advance latest to the newly published snapshot.
Implementation source checks found that the supported trusted-publishing flow
sets one tag per publication. A human clarification about continued snapshot
tag advancement is pending in the work log. Do not introduce private token
handling or mutate live tags. Version preparation has advanced to snapshot.16.

## Confirmed source findings

All JVM paths below refer to the freshly fetched commit above.

- `server/src/main/kotlin/io/spine/server/procman/ProcessManagerRepository.kt`
  lines 277–309: `protected open configure(processManager: P)` runs after
  `super.create(id)` and after `super.toEntity(record)`. Its documentation
  explicitly supports supplying dependencies. The default injects the Bounded
  Context for querying; overriding methods must call super.
- `server/src/main/java/io/spine/server/entity/RepositoryCache.java` lines
  107–119: delivery batching can reuse an object. Configuration is per created
  or reconstructed object, not once per persistent ID or necessarily once per
  dispatched signal.
- `server/src/test/java/io/spine/server/procman/ProcessManagerRepositoryTest.java`
  lines 605–629 and `server/src/testFixtures/java/io/spine/server/procman/given/repo/TestProcessManagerRepository.java`
  lines 55–67 exercise the override with a boolean flag. The finding test does
  not reset the flag after its initial create, so these assertions alone do not
  prove restoration calls or invocation counts; implementation establishes the
  restoration call. No external-service injection example was found in these
  committed tests.
- Aggregate and Projection repositories have no matching configure callback.
  Common factories and framework history initialization are separate concepts.
- A configuration exception propagates out of creation/restoration. The JVM
  Process Manager endpoint loads before opening the transaction; configuration
  is not a transactional external-service operation.

Current TS source and tests:

- `packages/server/src/entity/entity.ts:369` supplies `EntityOptions` with ID,
  schema, state, Version, and lifecycle. Constructor at line 442 clones the
  state and Version. These values remain framework responsibilities.
- `packages/server/src/repository/repository.ts:288` has no Entity dependency
  option. Aggregate construction at line 1843 directly calls the class with
  framework options; shared Projection/Process Manager construction at line
  4632 does the same. All three restore current records before invocation.
- Projection loading at line 2960 handles deleted-state rebuild; Process
  Manager loading at line 3086 handles restoration. History binding follows
  construction. Query binding at line 2999 remains framework-controlled and
  tenant-aware for each handler invocation.
- TS creates fresh Entity objects along these dispatch/load paths. The history
  page cache is not an Entity instance cache. State queries in
  `packages/server/src/services/query-reader.ts:32` read Stand records and do
  not instantiate Entities.
- `packages/server/src/context/bounded-context.ts:1172` restricts generated
  repository options to routing/field mappings. `add()` at line 1322 passes
  those options through repository assembly at line 2473. Generated handler
  registries retain the class and metadata, not application dependency objects.
- Existing coverage to extend: `packages/server/test/repository/repository.test.ts`
  (constructor/schema type constraints and restricted public surface),
  `repository-routing.test.ts` (all three families' dispatch, restoration,
  versions and rebuild), `packages/server/test/context/bounded-context.test.ts`
  (generated/manual registration), and
  `packages/server/test/entity/process-manager-querying.test.ts` (query binding).

## Recommended interface

Add one typed, synchronous `onCreate(options)` factory to repository options and
to `BoundedContextBuilder.add(EntityClass, options)`. Default to the existing
construction when absent. The callback supplies application dependencies through
the Entity constructor, for example `new ShippingProcess(options, shipping)`.
The dependency may therefore be required and readonly. No container, lookup
tokens, reflection, extra decorators, or additional Entity generic parameter.

`onCreate` means creating an object, including reconstructing a stored Entity.
It is not notification that a new persistent Entity was first created. It must
return a fresh instance of the registered class and pass the supplied options
to the base constructor unchanged. Reject an unrelated object or a Promise;
do not add deep comparisons of every stored field or a new lifecycle system.

Application startup creates shared clients, awaiting their initialization if
needed. The synchronous callback merely passes those ready clients to each
instance. Application/server shutdown closes shared resources, not individual
Entities. Do not store clients in Proto state or generated registries. Do not
capture request-specific or tenant-specific mutable data in a shared client.

All history, query, transaction and handler setup remains framework-controlled.
Factory exceptions stop that invocation before business state/results are
committed. Normal dispatch failure reporting remains unchanged. Supplying a
client does not make its external calls transactional or change retry semantics.

Alternative: `onConfigure(entity)` would closely match JVM but requires mutable
setter/property injection and leaves an object temporarily without its required
dependencies. A repository subclass override also adds a class solely for
configuration. Neither is needed alongside the preferred constructor factory.

## Approved implementation plan

1. Define the callback contract and registration typing. Require `onCreate`
   when a class cannot be constructed with the framework options alone. Keep
   ID/schema/instance inference, the nominal Entity check, and existing
   concrete-schema restrictions. The current constructor constraint intersects
   an erased signature with `typeof Entity`; prove the behavior with type tests
   instead of assuming extra required parameters currently compile.
2. Use one internal creation operation from the Aggregate and shared
   Projection/Process Manager construction paths. Preserve restored state,
   Version, lifecycle, deleted Projection rebuild and framework bindings.
3. Carry the callback through explicit Repository registration and generated
   class registration. Dependencies stay in application code. Generation
   continues to discover the original class and handler signatures.
4. Demonstrate a Process Manager using an injected application service, with
   ordinary typed fakes in tests. Document constructor injection, restoration,
   client lifetime, and the unchanged rules for external effects in guides,
   TSDoc, and one existing example. No real external service is needed to test
   dependency passing.
5. Separately update publication policy/workflow/tests before the next release
   so `latest` advances to the new snapshot. Current
   `scripts/release-policy.mjs:53` selects only `snapshot`, and
   `.github/workflows/publish.yml:69` passes that selection to Lerna. Audit
   current first-publish instructions and any opposite-tag assertions in
   `scripts/release-publisher.mjs`; changing just the workflow is insufficient.
   Keep trusted publishing, existing snapshot access, and rollback protection.
   Resolve how both tags are set using the actual supported npm authorization
   flow during that slice; do not assume separate tag mutation is authorized by
   a publish-scoped credential.

### Required behavioral evidence

- For Aggregate, Projection, and Process Manager: new and restored objects
  receive the intended client; later dispatch creates/configures its new object
  without reconstructing the shared client. Verify state/Version continuity.
- Deleted Projection rebuild receives its fresh state/Version/lifecycle.
- Explicit and generated registration both invoke the callback; ordinary
  registration without a callback remains unchanged.
- Two contexts registering the same Entity class can supply different clients.
  Verify no cross-context or tenant state leakage through framework setup.
- Compile-time cases cover inferred options/result, required extra constructor
  arguments, optional constructor arguments, rejected missing callbacks,
  unrelated return types, async callbacks, and existing schema mismatch checks.
- A factory exception invokes no handler and commits no business state, Version
  increment or produced signal; normal failure reporting still works.
- History and Process Manager queries still work; state-only queries do not
  call the factory. Application clients never enter persisted state.
- Release tests verify the new latest/snapshot policy for every publishable
  package and preserve trusted publishing and partial-release safeguards.

No Proto, wire, storage format, package dependency, or generated-registry format
change is expected. Existing one-options constructors need no migration. A
stricter registration check may expose unsupported constructors; their remedy
is the new callback. Confirm exact declaration compatibility in implementation.

## Assignment results and verification

Both fresh source investigations completed with explicit Sol/medium dispatch,
without memory, file changes, builds, tests, or child agents. Runtime metadata
was not separately exposed. No profile mismatch was reported.

The existing requirements splitter completed the bounded architecture pass
with explicit Astra/high dispatch and fresh context. It supported `onCreate`
and identified the constructor-intersection typing risk above. The assessment
also confirmed that EntityOptions has no actor or tenant: inject a service that
can receive validated handler context when needed, rather than adding tenant
selection or mutable current-tenant state to the creation callback. The pass
made no file changes and ran no builds/tests. It is design assessment, not an
implementation review. Style, API documentation, and runtime review of an
implementation remain pending until the approved implementation converges.

The merged master tree equals the previously verified PR tree
`f9cb0232b2a75031dde87f54616c063f3ebcc0b6`; a duplicate release build is not
needed for the completed analysis. Current implementation, focused checks,
review status, and release verification are recorded in the work log; the
preceding analysis is not evidence that implementation has passed its gates.
