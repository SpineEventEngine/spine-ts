# Performance corrections report

Status: the review correction batch is implemented and the one-second acceptance
target is **not met**. Main's earlier uncontended five fresh-context runs
measured 1162.899917, 1171.200583, 1175.728208, 1182.376000, and
1174.916708 ms. The source-built measurements for the current correction are
recorded at the end of this report.
No validation, coordination, benchmark work, or publication behavior was skipped.

## Preflight correction

`packages/storage-mysql/test/mysql-factory-commit-mocked.test.ts` has one
assertion shared by the transactional and nontransactional cases. It now expects
`undefined` from the `Promise<void>` Entity commit contract. The previous
four-package run failed both cases (583/585 passed). After the correction,
`pnpm exec vitest run packages/storage/test packages/storage-mysql/test packages/storage-postgres/test packages/storage-datastore/test --coverage --coverage.include packages/storage/src/memory/in-memory-entity-commit.ts --maxWorkers=1`
passed 585/585 before the performance changes and 590/590 after them. The
selected commit file reached 97.14% statements, 94.52% branches, 100%
functions, and 97.84% lines. A first coverage rerun passed all 585 tests but
exited nonzero because its default include measured unrelated packages at 0%;
the explicit include resolved that coverage configuration issue.

## Profile evidence and retained changes

The original CPU profile is
`/tmp/entity-delivery-profile.ZTRAPt/CPU.20261001.125239.14605.0.001.cpuprofile`.
It spans the whole benchmark process rather than only `eventBus().post()`.
Main measured overlapping inclusive totals of 1,593 ms in `getOption`, 647 ms
in `describeEntityMetadata`, 1,088 ms in tenant `selectBounded`, and 1,111 ms
in validation `createRootRegistry`; these totals cannot be added. A call-stack
inspection attributed a 1,007 ms `selectBounded` subtree to Inbox reads and
found metadata extraction under Entity ID packing and storage construction.
The installed validation API has no supported registry input, so validation
remains unchanged.
Later profiles made through `NODE_OPTIONS` sampled pnpm/Vitest coordinators,
not the benchmark worker; they are excluded from the in-post findings below.
The older raw-profile summary misattributed about 430 ms of self samples to
`compareIdentityObjects` and 267 ms to `compareIdentityNormalized`; the sampled
frames are `tagged` and `normalize`, respectively. The old profile still
supports investigating repeated normalization but cannot quantify a specific
current delivery phase.

- `entity-storage-descriptor.ts`, `spec-scanner.ts`, and repository call sites
  reuse the repository's validated ID descriptor for packing, storage keys,
  and Entity record specifications. Standalone paths still extract and validate
  schema metadata. Focused tests compare scalar and message packed IDs, invalid
  values, storage keys, and mismatched descriptors.
- `tenant-records.ts` prepares bounded-query sort and continuation values once
  per query candidate, and expected filter keys once per query. Stored rows are
  still matched and ordered through the same comparisons. Tests cover Unicode
  ID ties, object and numeric ordering, keyset continuation, replacement,
  returned-ID isolation, and mutable filter values across query calls.
- `canonical-utf8.ts` returns immediately for equal strings and compares code
  points without allocating encoded arrays. `bytes()` is unchanged. A focused
  red test observed four `bytes()` calls before the change and zero after it;
  the new comparator matched the **sign** of the byte comparator for all pairs
  of 121 strings built from ASCII, non-ASCII, supplementary characters,
  prefixes, and lone surrogates.

An attempted entry-lifetime Map of normalized sort values made the measured
runs slower and was removed. Moving the existing repository handle lookup ahead
of factory creation also lacked a measured gain and could change observable
factory open/close calls; it was reverted. No new persistent index, global
cache, public service, or library patch remains.

## Identical real benchmark measurements

Every row below used the unchanged opt-in benchmark command
`SPINE_ENTITY_DELIVERY_BENCH=1 pnpm exec vitest run packages/server/test/repository/entity-delivery-benchmark.test.ts --maxWorkers=1`,
one worker, no coverage, fresh in-memory contexts, and verification of every
recipient state outside timing. Milliseconds are raw. Later runs are diagnostic
because live provider tests were running concurrently.

| Stage                                                                |     Warm-up |        100 |        500 | Five fresh 1,000-recipient runs                                 |
| -------------------------------------------------------------------- | ----------: | ---------: | ---------: | --------------------------------------------------------------- |
| Delivery slice before this follow-up                                 | 1448.214750 | 127.478125 | 617.104625 | 1314.987000, 1354.385000, 1325.810125, 1389.348125, 1323.825166 |
| Validated descriptor reuse                                           | 1468.852166 | 121.427292 | 631.042250 | 1299.271584, 1430.760917, 1313.501250, 1350.648292, 1379.800583 |
| Per-query comparison preparation                                     | 1404.100917 | 130.223209 | 654.573958 | 1239.137083, 1213.753875, 1202.801125, 1176.926375, 1156.640791 |
| Removed entry-lifetime cache experiment                              | 1333.641250 | 130.480417 | 587.174792 | 1302.611125, 1286.209500, 1253.560834, 1297.730959, 1236.860500 |
| Descriptor keys and allocation-free UTF-8 comparison                 | 1339.242583 | 121.105875 | 628.084416 | 1209.145292, 1202.753042, 1184.229042, 1163.044250, 1168.476042 |
| Prepared filter keys, retained code before final formatting refactor | 1289.217417 | 113.220500 | 588.872791 | 1222.912417, 1229.778542, 1188.055708, 1194.217125, 1145.080375 |

The last diagnostic row is the closest measured version of the retained runtime
logic. Its five 1,000-recipient runs remain 145–230 ms above the target. The
final formatting and <=35-line refactors preserved the same operations. Main's
uncontended five runs above confirm the target is still unmet. A
diagnostic run of the reverted handle-lookup experiment measured 1324.693708,
1325.905083, 1342.710500, 1323.635500, and 1352.113458 ms and is not a
measurement of retained code.

## Worker-only, in-post CPU diagnostic

The benchmark now accepts an optional diagnostic directory. Run it with:

```sh
SPINE_ENTITY_DELIVERY_BENCH=1 SPINE_ENTITY_DELIVERY_PROFILE_DIR=/tmp/entity-delivery-worker-post-20261001 pnpm exec vitest run packages/server/test/repository/entity-delivery-benchmark.test.ts --maxWorkers=1
```

The directory must be explicitly supplied under `/tmp`. With the profile
variable absent, the normal benchmark has no inspector session or profile
output. Diagnostic mode uses a local `node:inspector/promises` Session in the
Vitest worker and opens no listening port. It starts the profiler before the
existing timer, records the same elapsed timestamp immediately after
`context.eventBus().post(event)`, then stops and writes the profile. Saved
samples are clipped to those two monotonic timestamps; sample weights are the
microsecond overlap with that interval. This excludes profiler startup and
state verification without changing the timed work, warm-up, run counts, or
assertions. Profiles are in `/tmp/entity-delivery-worker-post-20261001/`.

The corrected diagnostic run passed its one test. Milliseconds were: warm-up
1290.852334, 100 recipients 115.854542, 500 recipients 574.025458, and five
1,000-recipient runs 1183.701750, 1185.315333, 1200.578917, 1226.070084,
1187.518917. The five profiles contain 4,785 samples weighted to 5,979.0 ms
of the 5,983.185 ms measured post intervals. Profiling perturbs timings; use
main's uncontended numbers for acceptance.

Across those five in-post profiles, the leading **self** weights were Protobuf
`nestedTypes` 585.8 ms, registry `add` 398.4 ms, `createZeroMessage` 382.9 ms,
`createExtensionContainer` 327.7 ms, garbage collection 303.3 ms, and the
anonymous tenant-record function 174.0 ms. Representative weighted **leaf
stacks**, written leaf to caller, were registry `add <- addFile <-
initBaseRegistry <- createRegistry <- createRootRegistry` 263.0 ms;
`nestedTypes <- nestedTypes <- addFile <- initBaseRegistry <- createRegistry`
228.4 ms; `createZeroMessage <- create <- createExtensionContainer <-
getExtension <- getOption` 249.0 ms; and `createExtensionContainer <-
getExtension <- getOption <- validate <- validate` 201.3 ms. Inclusive weights
were validation `validate` 1,546.8 ms, `createRootRegistry` 887.1 ms,
`getOption` 823.1 ms, storage `compareAndSet` 708.1 ms, and Inbox
`markDelivered` 679.5 ms. Inclusive totals overlap; they must not be summed.
The profiles confirm where CPU samples occur inside delivery, but do not alone
justify a new contract or further production change.
After the diagnostic helper's final guard, a TypeScript check rooted at the
benchmark test reported zero diagnostics; focused ESLint and Prettier also
passed. The benchmark behavior test passed in the corrected diagnostic run.

## Assessed Stand follow-up and controlled measurements

`SpecScanner.scan` again accepts only its original Entity-class argument.
Repository storage construction calls the internal `repositorySpecScanner`
method to reuse matching validated metadata; ordinary scans still discover and
validate their schema. The repository-only deferred Stand path now forwards
matching repository metadata through Aggregate, Projection, and Process Manager
updates. Stand checks the metadata schema before packing the ID and retains its
ordinary metadata-discovery fallback for direct updates. Deferred notification,
cancellation, state cloning, tenant selection, and commit order are unchanged.

The benchmark now counts handler calls and verifies exactly one call per
recipient as well as every final state. Counts are checked outside the post
timer. It retains the warm-up, 100/500 cases, five fresh 1,000-recipient runs,
and the same handler state change. The controlled rows below are unprofiled,
use the same command shown above with no coverage, and are raw milliseconds.
The temporary baseline row removed only the three repository-to-Stand metadata
arguments and was restored immediately afterward.

| Stage                                      |     Warm-up |        100 |        500 | Five 1,000-recipient runs                                       |
| ------------------------------------------ | ----------: | ---------: | ---------: | --------------------------------------------------------------- |
| Instrumented baseline before Stand change  | 1223.996125 | 109.197667 | 551.803459 | 1105.598208, 1109.270750, 1113.841250, 1094.561583, 1095.577209 |
| Stand metadata reuse, first run            | 1204.312500 | 108.296750 | 540.580500 | 1103.286750, 1090.712666, 1088.813791, 1086.613500, 1087.092959 |
| Stand metadata reuse, second run           | 1226.437125 | 109.364208 | 552.979833 | 1104.560291, 1107.775041, 1098.992542, 1094.467250, 1096.655917 |
| Temporary baseline without Stand arguments | 1205.732916 | 108.741875 | 540.379542 | 1104.629750, 1109.079708, 1125.280708, 1113.107209, 1087.569292 |
| Final refactored Stand code                | 1194.131625 | 107.545000 | 534.727375 | 1087.266417, 1091.480125, 1092.929000, 1158.880708, 1076.819709 |

Both baseline five-run averages are about 1,104 and 1,108 ms. The retained
Stand-code averages are about 1,091, 1,100, and 1,101 ms, respectively. The
direction repeats, but the gain is small and individual runs overlap. The
latest run still exceeds the one-second target on every measurement. This
evidence supports retaining the correct internal reuse path without claiming
that it closes the gap.

The earlier timed-post worker profiles show 708.1 ms inclusive under storage
`compareAndSet` and 679.5 ms under Inbox `markDelivered` across five runs. Within
the CAS subtree, self samples include tenant-record `encode` 114.0 ms,
`normalize` 84.5 ms, its anonymous function 86.7 ms, and `structuredClone`
51.4 ms. Inbox checks the caller's exact pending snapshot before CAS; the
storage CAS then checks the observed row against its expected record. Those
checks guard different stale-snapshot and concurrent-replacement cases. The
profile does not establish a safe way to remove either or predict a net gain
from caching a record key. No Inbox or storage CAS runtime change was made in
this follow-up.

After the follow-up, 66 Stand/scanner tests passed, including matching and
mismatched deferred metadata. A targeted repository selection passed 10 tests
covering primitive and message IDs, invalid-state rejection, failed Aggregate,
Projection, and Process Manager commits with notification cancellation, and
tenant routing. The direct Inbox and in-memory storage comparison selection
passed 62 tests. Targeted TypeScript diagnostics were zero; focused ESLint,
`pnpm lint:cleanup`, `pnpm lint:tsdoc`, and changed-file Prettier passed. The
final benchmark passed its exactly-once and state assertions. Main handles the
independent Datastore diagnostic; no Datastore file was edited here.

## Final focused verification and limits

After the retained changes, the bounded four-package selection passed 590/590
with focused coverage. Server descriptor, primitive ID, and delivery selection
passed 68/68. A combined five-file storage/server focused selection passed
97/97 before the final mechanical refactor. Affected storage, MySQL, PostgreSQL,
Datastore, and server TypeScript project checks passed. Focused ESLint,
changed-file Prettier, `pnpm lint:cleanup`, `pnpm lint:tsdoc`, and
`git diff --check` passed. Newly changed production declarations have TSDoc.

The evidence supports lower repeated query and metadata work, plus exact UTF-8
ordering equivalence. It does not establish that the measured remaining gap
requires a broader contract. Validation registry rebuilding occurs inside the
installed dependency; its contribution to each delivery does not establish an
unavoidable floor. An unbounded query index or new validation contract would
expand the approved scope and needs a separate evidence-backed decision. No
Docker, full suite, commit, push, version edit, or publication was performed
here.

## Prepared-record reuse and direct key-encoding experiment

The preceding prepared-record slice reused the accepted, validated
`EntityRecord` from Stand's deferred update during repository commit, avoiding
the second `EntityRecords.pack` of the same state. The identical unprofiled
benchmark rows supplied from that slice were:

| Stage                        | Five 1,000-recipient runs (ms)                                  |
| ---------------------------- | --------------------------------------------------------------- |
| Before prepared-record reuse | 1088.708833, 1093.098125, 1132.544625, 1083.287500, 1079.138917 |
| After prepared-record reuse  | 1122.446875, 1099.751917, 1089.074125, 1071.510500, 1075.441459 |

Those samples overlap; the reuse is retained for avoiding duplicate validated
packing, with no claimed standalone performance gain or one-second success.
This report did not rerun that production slice.

The preceding direct-key encoder experiment's 1,000-recipient measurements
were 1291.664583, 1247.580583, 1233.618625, 1266.267041, 1265.410792 ms
before its source edit, and 1289.245708, 1268.771625, 1266.354250,
1230.928125, 1268.311666 ms afterward. Those timings **cannot establish a
performance conclusion about that source edit**: the recorded commands ran
TypeScript checks with `--noEmit` and then a benchmark that imports the storage
package from `dist`, without an emitting build between the rows. One additional
post-edit row overlapped a typecheck and is also unsuitable for comparison.
The experiment's focused source tests passed, and its source edit was reverted
at the time. This audit does not reclassify earlier unrelated measurements
without build-status evidence.

## Complete review correction batch and current performance

- The exported `DeliveryInbox`, `Inbox`, `InboxStorage`, and `RemoteInbox`
  retention-clock methods were removed. Local delivery reads its concrete
  Inbox storage clock through a server-internal accessor; remote delivery uses
  client wall time. The ahead/behind/exact-boundary test passes.
- Forward delivery tracks successful duplicate and expired-delivered removals
  only within the current bounded page. The last surviving row remains the
  cursor, or the preceding surviving cursor is retained when the page is
  wholly removed. Real remote tests cover a productive full page, an equal-time
  successor, a duplicate last row, a fully removed page with and without a
  prior survivor, and the direct adapter's unrelated absent-cursor rejection.
  Exact and ambiguous remote cursor checks remain unchanged.
- `RepositoryStand.preparedRecord` clones the validated deferred `EntityRecord`
  and replaces its packed authoritative ID. Aggregate, Projection, and Process
  Manager commit helpers no longer carry original state/version/lifecycle only
  to repack them. A delayed Stand-read test mutates the caller's state,
  Version, and lifecycle before completion, then verifies the prepared record,
  authoritative ID, and subscriber snapshot. Existing family failure and
  notification-cancellation tests passed in the focused selection.
- The in-memory provider snapshots the affected Entity ID, current record,
  state-history records, diagnostic Events, and delivery Events before the
  queue or Event Store lock. Staging keys and staged writes use those same
  snapshots. Deterministic queued and in-flight mutations preserve current and
  history data; affected-only staging and rollback tests also pass.
- The opt-in benchmark prints raw timings and then asserts **each** of its five
  measured 1,000-recipient runs is below 1,000 ms. Ordinary test runs skip it.
  Its final run fails this acceptance assertion as intended.

The current native direct-key encoder removes the intermediate normalized tree
for key creation while leaving comparison normalization unchanged. It evaluates
object getters in lexical key order, then uses native `Object.fromEntries` and
`Object.entries` to emit JavaScript's numeric-name enumeration order. The
test-local old-key oracle uses private Symbol tags for bigint and bytes, so
ordinary `kind`/`payload` objects remain ordinary objects. Exact strings match
for more than 500 deterministic primitive, numeric, byte, bigint, nested, sparse-array,
prototype, `__proto__`, array-index-boundary, and collision-shaped cases.
Getter evaluation order and public read/CAS/delete behavior also pass.

Before measuring this encoder, `tsc -p packages/storage/tsconfig.json` and
`tsc -p packages/server/tsconfig.json` emitted the retained source successfully.
From `packages/server`, `import.meta.resolve` confirmed the benchmark's storage
and server packages resolve to their respective `dist/index.js` files. After
the encoder edit, storage was emitted again. All rows below use the same
no-coverage, single-worker benchmark with fresh contexts and exact handler
counts; milliseconds are raw.

| Source-built stage                    |     Warm-up |        100 |        500 | Five measured 1,000-recipient runs                              |
| ------------------------------------- | ----------: | ---------: | ---------: | --------------------------------------------------------------- |
| Retained source before native encoder | 1181.543000 | 106.124125 | 534.383584 | 1093.796833, 1078.325792, 1080.462542, 1070.253917, 1067.278666 |
| Native encoder, first run             | 1162.916167 | 103.325500 | 518.590000 | 1066.560875, 1051.207000, 1052.988625, 1050.481125, 1050.301459 |
| Native encoder, repeat                | 1166.205583 | 103.578625 | 523.766833 | 1062.488333, 1101.001166, 1054.563167, 1044.582584, 1045.180041 |
| Final emitted runtime, first run      | 1330.207833 | 125.160500 | 603.248584 | 1260.758875, 1202.098541, 1148.048583, 1142.442625, 1169.156750 |
| Final emitted runtime, repeat         | 1287.111667 | 110.897083 | 632.077750 | 1274.827750, 1252.204000, 1254.258834, 1237.553084, 1217.450875 |

The first two native-encoder rows show a modest source-built improvement over
the adjacent baseline, but one run overlaps its range. The final emitted
runtime rows were slower across warm-up and smaller workloads as well; a local
process snapshot showed high Chrome renderer and WindowServer CPU activity.
These rows do not isolate the encoder's effect, and every row fails the
one-second target. The encoder is retained for exact-key equivalence and the
adjacent measured reduction, without claiming a target pass or a fixed gain.

The combined focused source-test selection passed 541 tests with the ordinary
benchmark skipped. Its selected changed-source coverage measured 94.88%
storage-memory statements and 90.93% branches, including 95.65%/92.77% for
the commit file and 94.56%/90.29% for tenant records. The combined command
exited nonzero on global coverage thresholds: all selected files together
reached 89.93% statements and 83.28% branches, below 90%. Server delivery,
Inbox storage, repository, and remote adapter source coverage are recorded in
that command's output; this bounded selection is not release coverage. The
new first-page removal test subsequently passed in a 24/24 remote selection.
All changed TypeScript files passed ESLint, Prettier, repository typecheck,
cleanup, and TSDoc checks; after the last test and comment corrections, the
affected ESLint, Prettier, typecheck, TSDoc, and diff checks also passed. No
full release suite, Docker, Git
mutation, version edit, or publication was performed by this implementer.

## Tenant-snapshot correction and CI preflight

`MemoryEntityCommitStorage.commit` now captures the selected tenant and diagnostic
context before acquiring the Event Store lock or entering the Entity queue. The
same captured context selects the current backend, history slices, delivery
records, and lock. The commit handle keeps its original tenant key independently
of mutable caller input. Compatibility checks also reject an Entity input whose
actual tenant differs from the commit context. Existing record and Entity-ID
snapshots remain in place; no generated-schema configuration policy changed.

The queued-mutation regression first failed: after caller TenantId A changed to
B during a staged write, tenant A lacked a retained history row. It now passes
with both versions of current/history and the delivery Event in A, B empty, and
subsequent commits through the drifted handle rejected. The complete focused
memory-commit file passed 25/25 tests. Focused V8 coverage of the changed source
passed: 95.79% statements (114/119), 93.02% branches (80/86), 100% functions
(32/32), and 96.26% lines (103/107).

Protobuf generation and `pnpm typecheck:build:generated` emitted all workspace
package outputs successfully. Emitted declarations for `DeliveryInbox`, `Inbox`,
`InboxStorage`, and `RemoteInbox` contain no `retentionTime` method;
`SpecScanner.scan(entityType)` and `EntityCommitStorage.commit(input)` retain
their original public signatures. Tooling typecheck, full ESLint, cleanup,
TSDoc, copyright, formatting, documentation audience/snippets, Proto lint and
generated-cleanliness, logging/dependency checks, release-readiness, and
`git diff --check` passed. The API-docs gate initially found a stale expected
`EntityCommitResult` export in its checker; main corrected the checker while
this slice ran, after which `pnpm docs:api:check` passed with 29 documented and
29 declared storage-provider exports. Its focused Vitest file passed 5/5 tests.
The changed memory source/test also passed a final targeted ESLint and Prettier
check. The full release coverage suite remains for main; no new performance
experiment was run in this correction batch.

## First independent review correction: performance and live Datastore evidence

The reviewed head `153ebbd8a` failed the unchanged, one-worker, source-built
benchmark with five 1,000-recipient posts of **1234.013500, 1245.568875,
1215.341083, 1186.454458, and 1219.917834 ms**. Each run still checked every
final state and exactly one handler call per recipient before the speed
assertion. The required reduction is at least 186.454458 ms for that best run,
and 245.568875 ms for the slowest.

To localize current cost without changing work, I forced emitting builds of
core, storage, and server, then ran the benchmark's existing worker-only
`node:inspector/promises` diagnostic mode with
`SPINE_ENTITY_DELIVERY_PROFILE_DIR=/tmp/entity-delivery-worker-round2-20261001`.
Raw warm-up/100/500 measurements were 1228.496959/107.619292/536.793750 ms;
the five measured posts were **1172.164583, 1125.688333, 1128.224417,
1117.244583, and 1101.100459 ms**. The unchanged under-one-second assertion
failed. Profiling perturbs timing, so these numbers are diagnostic rather than
an acceptance comparison.

The five saved in-post profiles contain 3,773 samples weighted to 5,642.403 ms.
Inclusive weights include validation `validate` 1,408.3 ms,
`createRootRegistry` 980.8 ms, Protobuf `getOption` 825.6 ms, storage
`compareAndSet` 649.1 ms, and Inbox `selectBounded` 346.7 ms. Inclusive weights
overlap. Among self weights, `nestedTypes` was 544.8 ms, `createZeroMessage`
402.5 ms, registry `add` 367.0 ms, `createExtensionContainer` 339.5 ms, and
garbage collection 263.2 ms. The in-post validation call stacks include System
Event packing, handler diagnostics, EventBus acceptance, causal origin packing,
prepared Entity state packing, and replay validation. These are distinct
required checks or values; the current profile does not prove an equivalent
single-use prepared value that can remove the 186–246 ms acceptance gap.

The installed `@spine-event-engine/validation` implementation calls
`ValidationEngine.createRootRegistry(schema)` on every public
`validate(schema, message)` invocation. Its declaration accepts only schema and
message; it exposes no prepared-registry argument. The registry cost alone is
about 196.2 ms per measured post, overlapping other validation frames.
Eliminating that repeated work while preserving validation would require a
supported dependency contract or a separately approved internal validation
architecture. I made **no runtime performance edit**: prior small optimizations
already failed to meet the target, and neither removing validation nor changing
the benchmark, workload, storage CAS, or published API is authorized. The P1
one-second requirement remains open; no target pass is claimed.

The official pinned JVM checkout was confirmed at
`ea3067b137938ac0beb6920c39d11e300976fcc9`; its `Delivery.runDelivery`
and `InboxPage` continuation methods were read. This correction changed no
runtime delivery code or paging behavior.

The Datastore live trace at `/tmp/entity-live-provider-datastore-trace-report.txt`
shows the first, sequential, replay, and concurrent commits, current read, and
all state appends through version 129 completed. The 30-second timeout began
after `states.trim("task", 1)` started. The `trim` loop and its provider
`queryProviderPage`/`deleteProviderEntries` method bodies are unchanged
from base `9e1147298`. That proves no direct source change in those methods;
it does **not** prove a base run with the same data also stalls. The trace does
not separate the trim query from the bulk delete. No Datastore source or test
was changed and no emulator was started in this correction.

The smallest separate live proof of the changed commit behavior is an additive
emulator test that commits one current Entity plus retained state, diagnostic
Event, and delivery Event; repeats the identical commit; replaces current state
without expected-state CAS; then reads current and the four physical families
and verifies their bytes and row counts. It can reuse the existing unique
project/context and `finally` cleanup pattern. Keep the original combined
history-trim test intact. After performance measurements stop, main can run
that focused live test once. To classify the trim stall itself, instrument the
provider page query and delete separately and compare the same 129-row scenario
against base in a disposable emulator; source equality alone is insufficient.

The stale `packages/server/REFERENCE.md` paragraph now describes the concrete
Inbox's configured clock and remote client wall time, and says
`DeliveryInbox` has no clock method. Focused delivery/inbox tests passed 57/57.
Core, storage, and server emitting typechecks passed. Changed-file Prettier,
TSDoc, cleanup, documentation-audience, and `git diff --check` passed. There
was no changed runtime source in this correction, so changed-source coverage
and runtime ESLint are not applicable. No full suite, Docker, Git mutation,
version edit, dependency patch, or publication was performed here.

## Round-one live Datastore commit proof and bounded trim diagnosis

Using only the disposable `spine-entity-commit-round1` container, I ran the
cached `gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators` image
(`cloud-sdk 578.0.0`) on host port `127.0.0.1:18081`, with project
`spine-entity-commit-round1`. The new additive test in
`packages/storage-datastore/test/datastore-emulator.test.ts` uses generated
ProjectState, ProjectCreated, and ProjectId fixtures and unique project cleanup. It commits
current, state history, diagnostic Event history, and delivery Event together;
replays identical input; and commits a new current record without an expected
state. It compares complete Protobuf bytes on public readback, checks one
physical row in each of the four tenant-A families, and checks empty public
reads and zero physical rows in the corresponding tenant-B families. Its first
red run exposed only a Buffer-versus-Uint8Array assertion mismatch in the
test; replacing object equality with full Protobuf-byte equality made the
focused live command green:

`DATASTORE_EMULATOR_HOST=127.0.0.1:18081 DATASTORE_PROJECT_ID=spine-entity-commit-round1 pnpm exec vitest --config vitest.infrastructure.config.ts run packages/storage-datastore/test/datastore-emulator.test.ts -t 'commits and replays all Entity families within one tenant' --maxWorkers=1`

Result: **1 passed, 5 skipped**, 109 ms test time on the final run. The old
combined trim test remains unchanged.

For the trim diagnosis, temporary setup at `/tmp/entity-round1-trim.setup.ts`
wrapped the existing provider page query and delete and stopped after eight
pages. The original combined test reached trim and, on each of eight pages,
`queryProviderPage` returned **128 entries with `hasMore=true`**;
`deleteProviderEntries` accepted **127 keys and completed** before the next
query. A temporary append-only diagnostic test, subsequently removed, appended
the same **129 state rows** without any Entity commit and reproduced the exact
eight-page **128-query/127-delete** sequence. The bounded stop intentionally
failed these diagnostic runs; logs are
`/tmp/entity-round1-trim-pages.log` and
`/tmp/entity-round1-trim-append-only.log`. An unbounded instrumented run of the
original test timed out at its unchanged 30-second limit after more than
12,000 query/delete boundary log lines (`/tmp/entity-round1-trim-current.log`).
The operation is a repeating page/delete loop, not one stalled Datastore call.

The `StateHistory.append`, `StateHistory.trim`, `immutable`,
`DatastoreRecordStorage.queryProviderPage`, and
`DatastoreRecordStorage.deleteProviderEntries` executable bodies match base
`9e1147298`; the record-storage file has no diff at all. The append-only
reproduction also excludes the changed Entity commit transaction from this
failure path. This precisely scopes the observed stall to the unchanged
history/provider path, but does not claim that the full old commit test was
run at the base revision. No unrelated trim fix was added solely to clear it.

Focused final checks passed: changed-test ESLint, Prettier diff, tooling
`tsc --noEmit -p tsconfig.eslint.json`, `pnpm lint:cleanup`,
`pnpm lint:tsdoc`, and `git diff --check`. This slice changed only the live
test and this report. No performance/dependency code, full suite, version, Git,
or publication action was performed.

### Final domain-fixture correction

Review found that the initial additive test still used the older StringValue
state and payload-free Event helpers. The final test now packs a generated
`ProjectStateSchema` as Entity state, `ProjectCreatedSchema` as each Event
payload, and `ProjectIdSchema` as the Entity and producer identifier. The
physical current/history family names derive from `ProjectStateSchema.typeName`.
The older baseline test and its helpers are unchanged. The same byte-exact
readbacks, replay, new current without an expected-state guard, four row counts,
and tenant-B absence assertions remain. The first rerun failed before test
execution because the new ID helper name collided with the existing emulator
project ID constant; renaming the helper resolved the parse error.

Final live command, against the disposable `spine-entity-commit-round1-final`
Datastore-mode emulator on `127.0.0.1:18081`:

`DATASTORE_EMULATOR_HOST=127.0.0.1:18081 DATASTORE_PROJECT_ID=spine-entity-commit-round1-final pnpm exec vitest --config vitest.infrastructure.config.ts run packages/storage-datastore/test/datastore-emulator.test.ts -t 'commits and replays all Entity families within one tenant' --maxWorkers=1`

Result: **1 passed, 5 skipped**, 555 ms test time. Changed-test ESLint,
test and reference Prettier diffs, tooling `tsc --noEmit -p tsconfig.eslint.json`,
cleanup, TSDoc, and `git diff --check` all passed. The corrected server
reference now describes the configured local Inbox clock and remote wall time
without the unnecessary public-method sentence. No runtime or dependency
implementation changed.
