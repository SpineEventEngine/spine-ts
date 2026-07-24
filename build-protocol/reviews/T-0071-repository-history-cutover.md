# T-0071 Repository Cutover, Histories, and Dispatch Guard Review

Status: Initial findings corrected; targeted rereview pending

## Scope

Review the complete T-0071 diff against `main@150d2467` and the frozen
`build-protocol/planning/WAVE_2_JVM_PARITY_PLAN.md` contract. The implementation
is not accepted merely because focused mechanical checks pass.

## Assignments

| Existing role                      | Concern                                                                    | Expected profile       |
| ---------------------------------- | -------------------------------------------------------------------------- | ---------------------- |
| `style_maintainability_reviewer`   | Repository/entity/Stand depth, obsolete-path removal, cohesion, test shape | `gpt-5.6-terra`, high  |
| `documentation_reviewer`           | Configuration, histories, durability, guard limits, snippets               | `gpt-5.6-luna`, medium |
| `typescript_api_docs_reviewer`     | Exact protected/public declarations, exports, compatibility removal        | `gpt-5.6-terra`, high  |
| `performance_reliability_reviewer` | Persistence order, restart, cache, concurrency, guard, failure semantics   | `gpt-5.6-terra`, high  |

Every dispatch names its existing role and expected profile explicitly. The
Desktop surface rejects Luna as a generic model override, so the fixed
`documentation_reviewer` role is dispatched without an override; its immutable
Luna/medium profile and that limitation are the metadata evidence. Reviewers
are read-only, may not spawn children, and must return one complete finding
batch. Runtime self-introspection is recorded if exposed; otherwise the
configured role/profile and limitation are the evidence.

## Mechanical Evidence Before Review

- Generated typecheck passed.
- Targeted ESLint and Prettier passed.
- Entity/repository/Stand focused regression passed: 3 files / 184 tests.
- Aggregate removal and earlier repository/Stand focused suites passed as
  recorded in `build-protocol/work-logs/T-0071.md`.
- `git diff --check` passed.
- Full repository lint awaits back-merge of the already integrated and pushed
  T-0070R deterministic lint correction from `main@4103c4f2`.

## Performance/Reliability Result

- Actual runtime self-introspection was unavailable. The accepted explicit
  existing-role profile is `performance_reliability_reviewer`,
  `gpt-5.6-terra` / high.
- P1: the guard is repository-wide and process-local, does not consult the
  durable diagnostic journal, disappears on restart, serializes unrelated
  entities, applies to Projection, and does not enforce the Process Manager
  event-history prerequisite.
- P1: the required complete-version history cache, exclusive continuation,
  short-read exhaustion, discontinuity invalidation, and runtime state-history
  switch are absent.
- P1: repository and Stand erase and never close provider entity-storage
  handles, leaking MySQL tracked handles.
- P1: Process Manager state history uses an epoch timestamp instead of the
  command/event execution time.
- P1: Stand can pair query-index state with newer current metadata, and an
  index-write failure can create a durable current row that `clear()` never
  enumerates.
- P1: required history/guard failure, intermediate-batch, cache, runtime-switch,
  restart, and Datastore/MySQL provider-backed coverage is missing.
- All findings are accepted into the complete initial review batch and block
  acceptance.

## TypeScript/API Result

- Actual runtime self-introspection was unavailable. The accepted explicit
  existing-role profile is `typescript_api_docs_reviewer`,
  `gpt-5.6-terra` / high.
- P1: protected history declarations are not the exact frozen readonly
  contracts, `eventHistoryContains()` permits an async predicate, and
  `eventHistoryStorage()` must be named `eventStorage()`.
- P1: putting event history on base `Entity` exposes it to Projection, whose
  contract must have no event history.
- P1: the required JVM-style runtime state-history switch is absent.
- P1: guard configuration is available without a supported journal and the
  implementation does not inspect retained event history.
- P1: public `InMemoryStorageFactory.createEntityStorage()` leaks internal input
  and concrete handle types through a root-exported declaration.
- P1: required positive/negative declaration fixtures for exact signatures,
  readonly results, entity-kind availability, maintenance types, and obsolete
  export removal are missing.
- The public maintenance operation shapes, obsolete root export removal, and
  absence of a remote history API are clean. The findings join the complete
  correction batch.

## Style/Maintainability Result

- Actual runtime self-introspection was unavailable. The accepted explicit
  existing-role profile is `style_maintainability_reviewer`,
  `gpt-5.6-terra` / high.
- P1: persistence-driven Aggregate applier registration/execution and its
  alternate version/store path remain; migrate fixtures to direct
  transactional updates and delete the obsolete model.
- P1: the replacement routing fixture retains `readHistory`, `snapshot`, and
  `writeSnapshot` facade/terminology plus an unused `eventSchemas` option,
  violating the no-snapshot fixture/test gate.
- P2: Aggregate command and event execution duplicate the complete current,
  state-history, diagnostic-journal, EventStore, and asynchronous-dispatch
  persistence sequence. Extract one owned operation so ordering corrections
  cannot drift.
- Production `AggregateStorage`/`ReplayError` files and root exports are
  removed cleanly; residual fixture/applier paths block the complete obsolete
  surface disposition.

## Documentation Result

- Actual runtime self-introspection was unavailable. The accepted immutable
  existing-role profile is `documentation_reviewer`,
  `gpt-5.6-luna` / medium; generic Luna override remains unavailable.
- P1: API, server, and architecture docs still describe removed
  `AggregateStorage`, snapshots, replay, and AggregateStorage-based repository
  persistence.
- P1: the user guide still says T-0071 repository history/configuration is
  deferred and incorrectly denies the per-kind protected event-history API.
- P1: no end-user documentation/snippets cover repository configuration, exact
  protected methods, per-kind policies, maintenance, runtime-switch warning,
  cache behavior, non-atomic durability/failures, or the default-100
  journal-backed best-effort guard and its multi-machine/failure limitations.
- P2: repository policy/ordering is omitted from provider-history guidance and
  MySQL must be described as a monotonic `write_order` cutoff, not a
  strict-time cutoff.
- Datastore and RDBMS provider README guidance is otherwise accurate.

## Complete Initial Wave Disposition

- The wave contains blocking P1 findings in every concern. None is waived.
- One consolidated correction round must address the exact protected/public
  contract, per-kind availability, runtime switching, journal-backed
  per-entity guard, cache semantics, provider-handle lifecycle, PM timestamps,
  Stand authority races, obsolete applier/fixture paths, declarations,
  provider-backed/failure tests, and public documentation.

## Targeted Rereview Wave

Status: Blocking findings accepted; consolidated correction pending.

All four existing concerns were rereviewed after the initial correction batch.
The Desktop surface exposed no child runtime self-introspection. The explicit
dispatch fields and immutable configured role profiles are the metadata
evidence:

- `style_maintainability_reviewer`: `gpt-5.6-terra`, high;
- `typescript_api_docs_reviewer`: `gpt-5.6-terra`, high;
- `performance_reliability_reviewer`: `gpt-5.6-terra`, high;
- `documentation_reviewer`: fixed `gpt-5.6-luna`, medium; the surface does not
  accept Luna as a generic model override, and the role profile is the
  available evidence.

### Accepted style/maintainability findings

- P2: remove stale public “live appliers” wording.
- P2: remove the end-user task-ID fragment.
- P2: delete the routing fixture's fabricated `events: []` current-record
  facade and unused event append helper; journal assertions must use the
  journal reader.

### Accepted TypeScript/API findings

- P1: remove all remaining public Aggregate-applier TypeDoc claims.
- P1: complete positive and negative compile fixtures for `stateAt`, the
  synchronous event predicate, exact `eventStorage()` naming, Process Manager
  availability, exact maintenance shapes, and removed accessor/error names.
- P2: correct Aggregate history TypeDoc and document guard eligibility for
  Aggregate and Process Manager repositories.

### Accepted documentation findings

- P1: remove remaining replay-era Aggregate validation claims and the stale
  storage README statement that repository history is deferred.
- P2: document per-kind persistence ordering, complete-version/discontinuity
  cache behavior, post-journal retry limitations, rejection-event exclusion,
  and remove the task-ID fragment.
- P1: replace the stale API claim that Stand version metadata is process-local.

### Accepted performance/reliability findings

- P1: Stand must own and close entity-storage handles instead of erasing them
  to `.current`; add bounded no-growth coverage.
- P1: Stand query/list reads and system-column evaluation must use one
  authoritative current record so state, version, and lifecycle cannot be
  paired across revisions.
- P1: history caching must use exclusive version continuation, cache only
  complete version groups, establish exhaustion on short reads, and clear on
  discontinuous appends.
- P1: the guard must cover actual per-entity Process Manager replay, handle
  multi-target execution, bound entity/ID retention, trim durable-journal
  duplicate observations, and clear on runtime rebind.
- P1: add deterministic runtime-switch, cache, guard, Stand, provider-handle,
  restart/rebind, and failure-boundary tests over repository/Stand call paths.

No P0 findings were reported. Every P1 and P2 above is accepted into one
consolidated correction batch; no partial correction starts before this full
wave is recorded.

## Final Targeted Correction Evidence

Status: Corrections complete; final targeted rereview pending.

- Stand owns and closes scoped entity handles; current-record state, version,
  and lifecycle now drive list/query/system-column evaluation. Dedicated stale
  index and durable system-column tests are present.
- The provider-only state history read returns versioned records across
  in-memory, Datastore, and MySQL. Repository bindings unwrap states only at
  the protected API. Exclusive continuation, short-read exhaustion,
  discontinuity/backfill invalidation, and stale-read generation protection
  have direct tests.
- Aggregate and actual per-entity Process Manager execution use the bounded
  journal-backed guard. Direct duplicate, multi-target, bounded eviction,
  durable suppression, runtime rebind, before/after-journal failure, and
  unrelated-lane concurrency tests are present.
- Exact positive/negative declaration fixtures, obsolete helper/API removal,
  and every accepted public documentation correction are present.
- Fresh orchestrator evidence: generated typecheck passed; eight combined
  server/storage/provider files passed `391/391`; targeted ESLint and Prettier
  passed; `docs:check` passed with 219 expected server and 33 expected storage
  exports; stale-term scan and `git diff --check` passed.

Only the substantively affected style, TypeScript/API, documentation, and
performance/reliability concerns reopen. The final targeted reviewers must
confirm the accepted findings are resolved; no new whole-change wave starts
unless a remaining P0/P1 requires it.

## Final Reliability Rereview

Status: Three P1 corrections resolved; final targeted rereview pending.

- Actual child self-introspection was unavailable. The explicit existing-role
  dispatch and immutable configured profile are
  `performance_reliability_reviewer`, `gpt-5.6-terra` / high.
- P1 accepted: Aggregate guard placement must be per routed target and append
  the durable source marker so restart/eviction suppression works; add
  multi-target and durable-restart tests.
- P1 accepted: every guard journal probe must close its newly opened provider
  entity-storage handle on success, duplicate, and failure; add counting-handle
  Aggregate/Process Manager coverage.
- P1 accepted: event cache must not cache a partial producer-version group.
  Add a shallow-then-deep same-version regression that rereads the whole group
  before continuing.
- Stand authoritative-current/system-query and close-draining corrections are
  clean in this lane.

### Final reliability correction evidence

- Aggregate routing now applies the guard per target and appends its
  per-target source marker after successful target handling. The aggregate
  multi-target/lane-eviction regression proves both markers suppress a later
  duplicate without journaling produced Aggregate events twice.
- Guard journal reads now close their newly opened entity-storage handle in a
  `finally`. Counting-handle coverage proves guarded Aggregate and Process
  Manager probe closure on successful durable reads, plus Aggregate durable
  duplicate and thrown-read closure.
- The event cache uses a look-ahead read and caches only complete
  producer-version groups. The shallow-depth-one/deeper-read regression proves
  a two-event same-version group is reread and then returned intact.
- Mechanical evidence: focused routing/history-cache/repository/entity suites
  passed `4 files / 186 tests`; generated typecheck, targeted Prettier/ESLint,
  and `git diff --check` passed. These three P1 findings are resolved pending
  the orchestrator's final targeted rereview.

### Aggregate durable-restart regression evidence

- A two-runtime shared-storage multi-target Aggregate regression now proves
  that each first-runtime target journals one source marker and one produced
  event, while a fresh second repository/runtime/bounded context suppresses the
  source from durable markers without a second produced-event append.
- The regression exposed same-ID produced events across multiple targets.
  Binding now adds a deterministic target qualifier only for multi-target
  Aggregate routes; single-target derived IDs remain unchanged.
- Focused routing passed `1 file / 130 tests`; generated typecheck, targeted
  Prettier/ESLint, and `git diff --check` passed.

### Final reliability confirmation

- The runtime corrections for per-target Aggregate markers, guard-probe handle
  closure, and complete producer-version event-cache groups are clean.
- One P1 test gap remains: the Aggregate durable-suppression regression uses
  one runtime and a non-producing handler. Add a fresh-runtime/shared-storage
  multi-target regression with a producing handler to prove restart
  suppression and exactly-once produced-event journaling beside source
  markers.

### Final reliability disposition

- Clean: no P0-P3 findings remain.
- The fresh-runtime/shared-storage regression proves per-target durable source
  suppression and exactly-once produced-event journaling. The correction
  target-qualifies generated produced-event IDs only for multi-target routes;
  single-target IDs remain unchanged.
- Actual child self-introspection was unavailable. The explicit
  `performance_reliability_reviewer`, `gpt-5.6-terra` / high dispatch is the
  metadata evidence.

## Final TypeScript/API Disposition

- Clean: no P0-P3 findings remain.
- The final documentation-only correction states that
  `RepositoryOptions.doubleDispatchGuard` is disabled by default, uses depth
  `100` when enabled without an explicit depth, is unavailable to Projection
  repositories, and requires `processManagerEventHistory` for Process Manager
  repositories.
- The reviewer confirmed that the declared option type is unchanged and no new
  public-contract concern was introduced.
- Actual child self-introspection was unavailable. The explicit
  `typescript_api_docs_reviewer`, `gpt-5.6-terra` / high dispatch is the
  metadata evidence.

## Final Documentation Disposition

- Clean: no P0-P3 findings remain.
- The reviewer initially found one P1 contradiction in the API overview and
  server package README. Both now distinguish the absence of public
  event-history access from the protected, repository-bound Aggregate and
  Process Manager methods, and explicitly state that Projection has no event
  history.
- The generated documentation gate passed after the correction, and the same
  reviewer confirmed the narrow rereview clean.
- The Desktop surface rejected an explicit Luna model override, so dispatch
  used the immutable `documentation_reviewer` role profile:
  `gpt-5.6-luna` / medium. Actual child self-introspection was unavailable.

## Final Style/Maintainability Rereview

- P1 accepted: remove the remaining architecture claim that Stand version
  metadata is process-local and unpersisted.
- P2 accepted: replace two positional history-cache policy booleans with a
  named options object.
- P2 accepted: make the routing storage helper entity-neutral, close every
  opened handle in `finally`, and remove its unused `events.append` seam.
- Guard/journal logic and provider state-record mapping are clean in this lane.
- The Desktop collaborator pool was at its thread limit, so this existing
  reviewer role ran through the repository CLI. The CLI exposed actual runtime
  metadata: `gpt-5.6-terra`, high reasoning, read-only sandbox. The reviewer
  reported the configured `style_maintainability_reviewer` role and spawned no
  children.

### Final style disposition

- Clean: no P0-P3 findings remain.
- The architecture guide now states the durable Stand current-record
  authority, history-cache policy is expressed by named options, and the
  entity-neutral routing helper closes every opened handle and no longer
  declares an unused event-append seam.
- The remaining `events.append` forwarding method belongs to the exercised
  counting-storage decorator and is not the removed helper facade.
- The narrow CLI rereview exposed actual startup metadata:
  `gpt-5.6-terra`, high reasoning, read-only sandbox.

## Post-Gate Datastore Reliability Rereview

- Existing role: `performance_reliability_reviewer`; expected model
  `gpt-5.6-terra`; expected reasoning `high`; both were explicit in dispatch.
  Runtime self-introspection was unavailable, so the immutable configured
  profile and that limitation are the available metadata evidence.
- P1 accepted: a frozen highest key is not a true snapshot boundary because a
  later lower-version append can sort below it. Preserve pre-plan membership
  independently of version/key ordering and add a lower-version concurrent
  append regression.
- P2 accepted: closing after the new planning read but before the first chunk
  can still permit one destructive commit. Require the handle open before the
  first chunk and add a deterministic close-during-plan regression.
- No other P0-P3 findings were reported. Performance/reliability remains open
  until the two corrections and targeted rereview are clean.

### Final post-gate reliability disposition

- Clean: no P0-P3 findings remain.
- Causal marker revisions preserve true pre-plan membership for later higher-
  and lower-version appends. Bounded pages advance across skipped post-plan
  markers, root counts change only for actual deletions, and no composite
  Datastore index or unbounded membership list is required.
- The open-state gate runs after planning and before the first destructive
  chunk. Deterministic close-during-plan coverage confirms no deletion occurs.
- Planning/chunk conflicts, keep and multi-chunk behavior, missing
  marker/revision fail-closed behavior, root disappearance, bounded resources,
  and Datastore ancestor/key-query constraints are clean.
- Runtime self-introspection remained unavailable. The explicit existing
  `performance_reliability_reviewer`, `gpt-5.6-terra` / high profile is the
  available metadata evidence.

## Correction Evidence and Rereview Disposition

- The accepted initial findings have been corrected in the implementation
  context: Aggregate persistence-time reconstruction fixtures and obsolete
  paths are removed; the shared Aggregate persistence/dispatch sequence owns
  the required ordering; protected per-kind history declarations, runtime
  switch, journal-backed per-entity guard, cache, provider handle lifecycle,
  Stand authority, Process Manager timestamps, and documentation claims were
  corrected with focused coverage.
- Positive and negative declaration fixtures now cover readonly protected
  history results, Projection event-history absence, obsolete root export
  removal, and internal storage-seam non-export. Provider-focused Datastore and
  MySQL history/restart/failure/lifecycle suites are included in the evidence.
- Deterministic correction evidence: routing/entity/Stand/Datastore/MySQL
  focused suites passed 5 files / 313 tests; generated typecheck, targeted
  Prettier and ESLint, and `git diff --check` passed.
- This earlier correction checkpoint is superseded by the final dispositions
  recorded above. Style/maintainability, documentation, TypeScript/API, and
  performance/reliability are all clean with no P0-P3 findings remaining.
