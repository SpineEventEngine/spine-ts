# T-0070D Review Record

Status: Ready for affected targeted re-review — correction batch applied; acceptance pending review/emulator evidence

## Scope

Datastore implementation of the frozen current/state/event-history SPI,
provider-native bounded maintenance, durable compatibility identity, retry and
concurrency behavior, lifecycle, tests, and package documentation.

## Planned Concern Dispositions

| Concern                          | Status  | Reason                                       |
| -------------------------------- | ------- | -------------------------------------------- |
| Style and maintainability        | Pending | Provider implementation changes production.  |
| Documentation completeness       | Pending | README and TypeDoc behavior claims change.   |
| TypeScript and API compatibility | Pending | Provider factory/internal SPI usage changes. |
| Performance and reliability      | Pending | Persistence/concurrency/bounds are central.  |
| Final security                   | N/A     | No new external trust boundary is planned.   |

## Mechanical Gate — 2026-07-24

- Generated typecheck and tooling typecheck pass.
- Datastore package suite passes 40 tests; 8 existing opt-in emulator/cloud
  tests skip because no external Datastore endpoint is selected.
- Repository ESLint and cleanup enforcement, formatting, TypeDoc/API,
  generated-output cleanliness, release readiness, and diff hygiene pass.
- The implementation is ready for one complete specialist review wave.

## Review-Wave Assignments

| Existing role                      | Bounded concern                                                   | Expected configured profile |
| ---------------------------------- | ----------------------------------------------------------------- | --------------------------- |
| `style_maintainability_reviewer`   | Datastore module depth, naming, duplication, test maintainability | `gpt-5.6-terra`, high       |
| `documentation_reviewer`           | Datastore configuration/history/maintenance claims and snippets   | `gpt-5.6-luna`, medium      |
| `typescript_api_docs_reviewer`     | Factory/internal SPI declarations, exports, dependency/API shape  | `gpt-5.6-terra`, high       |
| `performance_reliability_reviewer` | Durable identity, paging, retry, concurrency, retention, close    | `gpt-5.6-terra`, high       |

The Desktop surface selects immutable existing-role profiles. Each dispatch
names the fixed role explicitly; actual runtime self-introspection is recorded
when available, otherwise the immutable profile and limitation are the
evidence. Reviewers are read-only, may not spawn children, and return all
confirmed findings in one wave.

## TypeScript/API Result

- Actual runtime self-introspection was unavailable. The accepted immutable
  existing-role profile is `typescript_api_docs_reviewer`,
  `gpt-5.6-terra` / high, matching the recorded dispatch.
- P2: root-exported `DatastoreStorageFactory.createEntityStorage()` is described
  as provider-only but emits the internal input SPI and a private-module return
  type to every package consumer without a documented supported contract.
  Either expose a deliberate documented internal adapter seam or document the
  root method as supported, including lifecycle, binding, paging, retention,
  and partial-failure guarantees.
- The direct Proto dependency/lockfile, internal storage export map, declaration
  compatibility, and Protobuf contract are otherwise clean.
- Disposition: include this finding in the complete implementation correction
  batch after all review lanes return.

## Performance/Reliability Result

- Actual runtime self-introspection was unavailable. The accepted immutable
  existing-role profile is `performance_reliability_reviewer`,
  `gpt-5.6-terra` / high, matching the recorded dispatch.
- P0: state trim carries its retained-row counter across a post-delete restart;
  with 129 rows and `keepMostRecent = 1`, it can delete both final rows after
  deleting the first 127.
- P1: durable fingerprint binding is an unguarded provider `get` then `save`;
  independent clients/processes can race incompatible first bindings.
- P1: immutable retry and append/trim serialization rely on a process-local,
  client-identity `WeakMap`, so distinct clients/processes can interleave or
  persist divergent rows.
- P1: dynamically generated Datastore kinds use multi-property sort queries
  that require composite indexes the adapter cannot declare or deploy
  generically.
- P1: bounded reads and `stateAt` continue paging through the complete history
  after the requested answer is known, hiding an unbounded provider scan behind
  finite depth.
- P1: current-record signed-64 version validation occurs after durable-binding
  provider work, not before every RPC.
- P2: maintenance reads full entity payloads rather than provider key-only
  pages.
- P2: closing one handle closes the shared client/scope gate and therefore
  sibling handles/factories.
- Disposition: all findings are accepted into the complete implementation
  correction batch. The P0/P1 set blocks acceptance.

## Style/Maintainability Result

- Actual runtime self-introspection was unavailable. The accepted immutable
  existing-role profile is `style_maintainability_reviewer`,
  `gpt-5.6-terra` / high, matching the recorded dispatch.
- P2: the adapter duplicates canonical physical-scope encoding with bytes that
  differ from the shared authoritative helper (`single` and different segment
  structure versus `single-tenant` and shared separators). Reuse one
  authoritative internal encoder or make the representation byte-identical
  under a single helper.
- P2: entity-history tests and their conditional query fake are embedded in the
  legacy factory fixture, expanding it to 1,667 lines and violating the
  documented source/test mirroring rule. Move history behavior and its focused
  fixture to `test/datastore/entity-history.test.ts`.
- No other structure, naming, simplicity, cohesion, or method-size finding was
  confirmed. Disposition: both P2 findings join the complete correction batch.

## Documentation Dispatch Limitation

- The dispatch surface rejected an explicit `gpt-5.6-luna` model override
  because only Sol/Terra are accepted as generic overrides. The existing
  `documentation_reviewer` role is itself immutably configured as
  `gpt-5.6-luna` / medium, so it is dispatched by fixed role without an
  override. This is recorded honestly rather than substituting a different
  profile.

## Documentation Result

- Actual runtime self-introspection was unavailable. The accepted immutable
  existing-role profile is `documentation_reviewer`,
  `gpt-5.6-luna` / medium.
- P1: the Datastore README omits the new entity-history workflow, finite
  paging/depth rules, immutable newest-first reads, retention operations,
  retry/divergence behavior, lifecycle, non-atomic current/history writes,
  partial-failure semantics, and absence of a remote history route.
- P2: the root-emitted `createEntityStorage()` TypeDoc calls the method
  provider-only without defining its supported/unsupported contract or
  lifecycle and storage guarantees.
- P1: the user guide claims bounded/resumable concurrency-safe truncate
  behavior that the Datastore event-truncate implementation does not currently
  guarantee.
- Disposition: fix public claims only after the accepted reliability redesign
  establishes the actual provider behavior.

## Complete Wave Disposition

- The wave contains one P0, multiple P1, and multiple P2 findings. All are
  accepted; none is waived.
- Because the P0/P1 findings concern durable first binding, provider
  transactions, composite-index feasibility, stable bounded reads, and
  cross-client serialization, the correction requires a bounded persistence
  design before returning one batch to implementation.

## Remediation continuation — 2026-07-24

- The retained-trim P0 regression has focused RED/GREEN evidence and the
  assigned local suite passes. The static index deployment asset and provider
  seam documentation have also been added.
- The P1 transactional fixed-layout redesign has not yet been implemented.
  Specifically, durable first binding, independent-client serialization,
  fixed deployable kinds, key-only bounded maintenance, and per-handle sibling
  lifecycle are still unresolved. The full review wave must not be reopened or
  accepted until those runtime changes and the emulator gate exist.

## Targeted TypeScript/API Re-review — 2026-07-24

- Actual runtime self-introspection was unavailable. The accepted immutable
  existing-role profile is `typescript_api_docs_reviewer`,
  `gpt-5.6-terra` / high, matching the explicit dispatch.
- Clean: no confirmed findings.
- The prior P2 is resolved. `createEntityStorage()` returns the documented
  structural `DatastoreEntityStorageHandle`; the concrete adapter is not
  exported. The internal history SPI export map, direct Proto dependency,
  lockfile entry, and root package exports are correct.

## Targeted Performance/Reliability Re-review — 2026-07-24

- Actual runtime self-introspection was unavailable. The accepted immutable
  existing-role profile is `performance_reliability_reviewer`,
  `gpt-5.6-terra` / high, matching the explicit dispatch.
- P0: a current-record write unconditionally saves the shared entity root with
  zero history count/revision, corrupting history bookkeeping after or during
  history maintenance.
- P1: event `backward(..., startingFromVersion)` does not exclude events at the
  supplied version because its lower bound does not cover the complete version
  prefix.
- P1: a failed durable-binding promise remains cached for the handle lifetime,
  preventing recovery after a transient provider failure.
- P1: the durable fingerprint is indexed by default and is not prevalidated;
  the fixed layout requires unindexed metadata and bounded pre-RPC values.
- P1: the real-client emulator scenario is useful smoke evidence but does not
  yet cover the recorded high-risk matrix: incompatible concurrent first
  binding, append-vs-trim contention, close/retry, large finite reads, and the
  `stateAt` static-index query shape.
- The original retained-trim, atomic binding, cross-client serialization,
  dynamic-kind/index, unbounded state-read, signed-64 timing, key-only
  maintenance, and sibling-close findings are resolved. The new P0/P1 set
  blocks acceptance and joins the consolidated correction batch.

## Targeted Style/Maintainability Re-review — 2026-07-24

- Actual runtime self-introspection was unavailable. The accepted immutable
  existing-role profile is `style_maintainability_reviewer`,
  `gpt-5.6-terra` / high, matching the explicit dispatch.
- P2: remove unused private `query()` and `cutUpperBound()` helpers from the
  dense physical-layout adapter.
- P2: remove obsolete `RED:` prefixes from now-passing focused test names;
  red/green history belongs in the work log rather than the durable test names.
- The original canonical-scope and focused test-layout findings are resolved.
  No other style or maintainability finding was confirmed.

## Targeted Documentation Re-review — 2026-07-24

- Actual runtime self-introspection was unavailable. The accepted immutable
  existing-role profile is `documentation_reviewer`,
  `gpt-5.6-luna` / medium. The dispatch surface again could not express Luna
  as a generic override, so the fixed role configuration is the metadata
  evidence.
- P1: the corrected provider prose has no end-user TypeScript workflow showing
  the required `createEntityStorage()` input and practical use of `current`,
  `states`, `events`, `trim`, and `truncate`.
- All other prior documentation findings are resolved. The fixed kinds/index
  deployment, handle lifecycle and client ownership, finite newest-first
  reads, bounded maintenance, truncate high-water, retry/divergence,
  current/history non-atomicity, and emulator/cloud evidence claims match the
  implementation.

## Final Documentation Re-review — 2026-07-24

- Actual runtime self-introspection remained unavailable. The accepted fixed
  `documentation_reviewer` profile is `gpt-5.6-luna` / medium; the generic
  dispatch override limitation remains recorded.
- Clean: no documentation finding remains.
- The practical TypeScript workflow is accurate and typeable, covers
  `current`, `states`, `events`, `trim`, and `truncate`, and the README, user
  guide, and TypeDoc claims match the provider's finite-read, bounded
  maintenance, retry/divergence, lifecycle, and emulator/cloud behavior.

## Final Style/Maintainability Re-review — 2026-07-24

- Actual runtime self-introspection remained unavailable. The accepted
  explicit `style_maintainability_reviewer` profile is
  `gpt-5.6-terra` / high.
- Clean: the dead helpers and obsolete `RED:` labels are removed, and no new
  structure, naming, duplication, line-length, or fixture finding remains.

## Final Performance/Reliability Re-review — 2026-07-24

- Actual runtime self-introspection remained unavailable. The accepted
  explicit `performance_reliability_reviewer` profile is
  `gpt-5.6-terra` / high.
- The corrected current-write root preservation, exclusive event
  continuation, rejected-binding cache clearing, and bounded/unindexed
  fingerprint paths are clean.
- P1: the required real-client emulator matrix remains incomplete. Add
  independent append-vs-trim contention, divergent event-ID retry,
  close/retry, large bounded reads, and `$spineStateAt` fixed-index-shape
  coverage, then rerun the emulator and reliability re-review.
- The frozen Datastore contract deliberately permits an eligible concurrent
  append whose cut key is at/before the captured truncate high-water to be
  observed and deleted; no insertion-order cutoff finding is retained.

## Emulator Evidence Re-review — 2026-07-24

- Actual runtime self-introspection remained unavailable. The accepted
  explicit `performance_reliability_reviewer` profile is
  `gpt-5.6-terra` / high.
- Independent clients, divergent global event-ID retry, independent-handle
  close/sibling usability, and the 129-row bounded read are covered.
- P1: `Promise.all` starts append and trim together but does not force or
  observe overlapping provider transactions or a conflict retry; serial
  execution could pass the same assertion.
- P1: the emulator `stateAt` result assertion does not capture and prove the
  required `$spineStateAt` fixed-index query shape.
- The evidence addition is test-only and introduced no production finding.

## Emulator Evidence Closure Re-review — 2026-07-24

- Actual runtime self-introspection remained unavailable. The accepted
  explicit `performance_reliability_reviewer` profile is
  `gpt-5.6-terra` / high.
- The independent-client commit barrier is deterministic and its retry/final
  assertions distinguish provider contention from serial execution.
- P2: the captured `$spineStateAt` query is asserted through inspected string
  fragments rather than its exact structure. Assert the ancestor and
  `$spineStateAt >=` filters, ascending `$spineStateAt` order, and limit one
  structurally while still forwarding the query to the real emulator.
- No production finding remains in this evidence slice.

## Final Reliability Acceptance — 2026-07-24

- Actual runtime self-introspection remained unavailable. The accepted
  explicit `performance_reliability_reviewer` profile is
  `gpt-5.6-terra` / high.
- Clean: no reliability finding remains.
- The emulator structurally proves the exact one-query `$spineStateAt` shape
  while forwarding the query unchanged, and the two-client commit barrier
  proves real contention and trim retry rather than serial-only execution.
- The outside-sandbox real-client emulator suite passed 8/8 in 10.45 seconds.

## P2 Correction Submitted — 2026-07-24

- Existing role/function: bounded `implementer`, explicitly dispatched as
  `gpt-5.6-terra` / `medium`. Runtime self-introspection remains unavailable;
  the explicit immutable profile is the available metadata evidence.
- The P2 assertion has been corrected in
  `packages/storage-datastore/test/datastore-emulator.test.ts`: it captures
  the actual `Query` object and forwards it unchanged to the real client,
  then structurally verifies the fixed state-order kind, both required
  filters, ascending state-time order, and limit one. No `util.inspect()`
  string evidence remains.
- Deterministic validation passed (skipped-without-config emulator-file load,
  Prettier, diff hygiene, and generated/build/tooling typechecks). A configured
  external emulator rerun and affected reliability disposition remain pending;
  this record is not acceptance or merge evidence.

## Coverage-Gate Test Correction Submitted — 2026-07-24

- Existing role/function: bounded `implementer`, explicitly dispatched as
  `gpt-5.6-terra` / `medium`. Runtime self-introspection remains unavailable;
  the explicit immutable profile is the available metadata evidence.
- The coverage-only test additions exercise validation before RPC, multitenant
  query scoping, empty reads/maintenance, marker integrity, required paging
  cursors, transaction-conflict retry, and retry-safe binding/append behavior.
  No production implementation changed.
- Focused V8 evidence is 33/33 tests and 227/256 entity-history branch
  outcomes (88.67%), up from the reported 205/256 (80.07%): +22 outcomes.
  Tooling typecheck, ESLint, Prettier, and diff hygiene pass. A fresh full
  coverage run with observable final counters remains pending because the
  unrestricted execution surface returned success without preserving its
  Vitest summary/report artifact; this is not acceptance or merge evidence.
