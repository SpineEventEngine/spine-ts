# T-0230 Review Record

Status: Final affected re-review complete; last correction batch implemented

Initial review endpoint: `c09c961d6bf75e2cb90fb36fa2dc2c2e0882dd15`
Correction endpoint: `34ca4b669c78612bb158bba6635524e2c00341ed`
Final correction endpoint: `ac6ef3245ad7713c5f08eaf81ea4cacb7bdd9bb0`
Baseline: `6fffcd6102b3eff94b0f77eb6db2fbf2e02ba172`

## Planned Review Concerns

| Concern                          | Existing role                      | Model           | Reasoning | Scope                                                                                                                                                                                                                                             | Disposition                   |
| -------------------------------- | ---------------------------------- | --------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Style and maintainability        | `style_maintainability_reviewer`   | `gpt-5.6-terra` | high      | Package structure, simplicity, method size, duplication, tests                                                                                                                                                                                    | Complete; 3 findings accepted |
| Documentation completeness       | `documentation_reviewer`           | `gpt-5.6-luna`  | medium    | README, reference, storage guide, release and operational claims                                                                                                                                                                                  | Complete; 3 findings accepted |
| TypeScript and API documentation | `typescript_api_docs_reviewer`     | `gpt-5.6-terra` | high      | Public exports, types, TSDoc, compatibility, external consumer                                                                                                                                                                                    | Complete; 1 finding accepted  |
| Performance and reliability      | `performance_reliability_reviewer` | `gpt-5.6-terra` | high      | SQL bounds, transactions, locks, histories, retries, lifecycle                                                                                                                                                                                    | Complete; 1 finding accepted  |
| Security release readiness       | N/A                                | —               | —         | Dedicated security review is reserved for final project/release readiness by the current protocol; SQL binding, credential handling, TLS, tenant/schema isolation, and dependency policy remain mandatory mechanical and specialist-review inputs | N/A with concrete reason      |

All relevant reviewers will receive the complete Human-Imposed Requirements
Ledger from `TASK.md`, the immutable review endpoint, concern-specific paths,
and the rule that superseded historical text is not a finding unless current
task records or changed documentation claim it as active behavior. Reviewers
must not spawn children. Runtime metadata acceptance follows the explicit
dispatch fields and immutable existing-role profiles when self-introspection is
unavailable.

## Mechanical Preflight

- The immutable review endpoint and `origin/add-postgresql-storage` match, and
  the checkout is clean.
- Dependency-aware build, tooling typecheck, scoped ESLint, cleanup and method
  limits, TSDoc, copyright, formatting, diff hygiene, documentation audience,
  TypeDoc/API, snippets, Proto lint/current-generated checks, logging
  containment, production-dependency policy, and release-readiness checks pass.
- The PostgreSQL package suite passes 140 tests with 93.89% statements, 90.01%
  branches, 93.43% functions, and 96.62% lines.
- The affected server/release/tooling suite passes 234 tests in 13 files. It
  packs the workspace packages and compiles a clean external TypeScript
  consumer against the PostgreSQL tarball.
- PostgreSQL 16 and 18 live acceptance remains externally blocked because the
  required database URLs have not been supplied. Ordinary verification neither
  starts Docker nor substitutes an in-memory implementation.

## Specialist Review Wave

Each reviewer received the immutable endpoint, complete requirements ledger,
concern-specific scope, read-only rule, and child-agent prohibition. Every
dispatch explicitly selected the existing role's required profile. The review
surface does not report runtime self-introspection, so the immutable configured
role/profile is the available metadata; no visible mismatch occurred.

### Accepted correction batch

1. Make the three-argument `setTableName(sourceType, recordType, name)` overload
   register and resolve the grouped family instead of silently changing the
   ungrouped source family.
2. Replace lowercase-only ASCII table-name handling with the single binding
   JVM-compatible physical-name renderer and its mixed-case, reserved, custom,
   non-ASCII, case-only, and 63-byte golden matrix. Use it for registration,
   collision checks, DDL, DML, and inspection.
3. Make the structural `createEntityStorage` seam private in TypeScript, as in
   the MySQL factory, so it is callable by the runtime probe without appearing
   as supported public factory API.
4. Centralize the PostgreSQL deadlock/serialization classifier while retaining
   caller-specific retry and error behavior.
5. Make state and event backward history include the requested starting version
   and prove the returned behavior, not only SQL text.
6. Apply `NOT NULL DEFAULT false`, `NOT NULL DEFAULT false`, and
   `NOT NULL DEFAULT 0` to ungrouped current `EntityRecord` columns `archived`,
   `deleted`, and `version`, including DDL and catalog-validation evidence.
7. Retry the complete `writeAll` transaction once, on a fresh client, only for
   `40P01` or `40001`; a second failure must stop.
8. Treat failed or false session advisory unlocks as cleanup failures. Preserve
   an earlier operation error, but discard rather than pool a possibly locked
   client when cleanup alone fails, and expose only a sanitized provider error.
9. Remove raw driver errors from public operation-error cause chains while
   preserving already-classified provider errors and internal retry decisions.
10. Freeze a state-trim boundary once and delete older keys in stable 128-key
    keyset pages instead of repeating `OFFSET keep` for every page.
11. Add PostgreSQL to the user storage guide with discovery links, database-per-
    tenant guidance, native-collation caveat, and query bounds.
12. Document exact epoch-nanosecond `Timestamp` and numeric `Version` mappings,
    plus the corrected physical-name rules and collision/63-byte behavior.

The grouped-name report appeared in both style and API review and is one
correction. The physical-name documentation follows the corrected renderer; it
must not describe the rejected lowercase-only implementation. No reported
finding was rejected or deferred. Live PostgreSQL 16/18 evidence remains a
separate external verification gap, not part of this code correction batch.

## Correction Evidence

- All twelve accepted corrections are implemented. Follow-up preflight findings
  corrected private-seam test typing, session-unlock discard/error precedence,
  unsafe `finally` control flow, test-helper TSDoc, and coverage of the new
  branches without changing thresholds or exclusions.
- Dependency-aware build, tooling typecheck, scoped ESLint, cleanup/method
  limits, TSDoc, copyright, repository formatting, diff hygiene, documentation
  audience, TypeDoc/API, snippets, Proto lint/current-generated checks, logging
  containment, production dependencies, and release readiness pass.
- Exact PostgreSQL coverage passes 151 tests: 94.30% statements (`961/1019`),
  90.30% branches (`540/598`), 95.09% functions (`310/326`), and 96.67% lines
  (`844/873`).
- The affected server/release/tooling suite passes 234 tests in 13 files,
  including real package tarballs, clean dependency installation, and external
  TypeScript compilation against the PostgreSQL package.
- Re-review is restricted to the four concerns substantively changed by the
  correction batch. Reviewers receive the initial endpoint, correction
  endpoint, exact accepted findings, and current files. No code changes may
  begin until the complete affected wave is collected.

## Affected Re-review Disposition

All four affected reviewers completed against the frozen correction endpoint.
The same explicit immutable role profiles were used; reviews were read-only and
had no child agents. The wave confirms the inclusive history, Entity defaults,
whole-batch retry, shared classifier, session-lock discard/error precedence,
sanitized public errors, private Entity seam, grouped routing implementation,
root declarations, dependency declarations, and most documentation corrections.

The final accepted batch is:

1. Correct the trim boundary off-by-one. The boundary selected at `OFFSET keep`
   is the first obsolete state, so keyset deletion must include that complete
   `(version, created, ID)` key. Prove exact retained counts for zero, a partial
   page, and multiple pages.
2. Add an end-to-end public-builder grouped-name regression: the configured
   `(sourceType, recordType, group)` family uses its custom table while the
   ungrouped source remains distinct.
3. Implement and pin the complete binding JVM physical-name matrix. Official
   `jdbc-storage` commit `c747908403764eb9` delegates to QueryDSL 5.1.0:
   ordinary ASCII identifiers are emitted unquoted and PostgreSQL folds their
   ASCII capitals; PostgreSQL reserved words and names containing characters
   illegal in a plain identifier are quoted and preserve spelling. TS may quote
   the resulting physical name in SQL, but must reproduce that stored spelling
   before collision checks. Add reserved, non-ASCII/case, custom, exact 63-byte,
   case-only, and over-limit/collision cases through resolver and DDL-facing
   behavior. Reject unsafe or over-limit names before access.
4. Include PostgreSQL in the user guide's main move-to-durable-storage sentence,
   without dropping MySQL or Datastore.
5. Document the exact normalized PostgreSQL matrix: IDs, five comparisons,
   nested `all`/`either`, declared-column ordering, mask, finite limit, and that
   normalized plans have no offset while `RecordQuery.offset` remains separate.
6. Keep README/reference name claims aligned with the corrected binding renderer;
   do not narrow the documentation to the rejected lowercase-only behavior.

The grouped test finding appeared in style and API review, and the trim finding
appeared in style and reliability review; each is one correction. No affected-
wave finding is rejected. Missing live PostgreSQL URLs remains the external
verification gap.

## Final Correction Evidence

- State trim now deletes the first obsolete boundary key inclusively. Fixture-
  level tests run the production path and prove exact retention for zero,
  partial-page, and 300-row multi-page cases; the boundary query runs once and
  later pages use keyset continuation.
- A public-builder regression proves that the three-argument grouped custom
  name reaches grouped DDL while the ungrouped source family remains distinct.
- Physical-name goldens cover generated/custom plain-name folding, reserved and
  non-ASCII preserved spelling, grouped DDL-facing resolution, ordinary case-
  only collision, exact 63-byte acceptance, over-limit/difference-after-limit
  rejection, and invalid values.
- The user guide includes PostgreSQL in its durable-storage workflow, and the
  PostgreSQL reference documents the exact normalized-query matrix and accurate
  JVM-compatible name behavior.
- Final cheap preflight passes 157 PostgreSQL tests with 94.31% statements
  (`962/1020`), 90.39% branches (`546/604`), 95.10% functions (`311/327`), and
  96.68% lines (`846/875`). Build, tooling typecheck, lint, cleanup, TSDoc,
  copyright, formatting, docs/API/snippets, Proto, dependency, logging, and
  release-readiness gates pass. The 234-test package/release suite also passes,
  including packed external-consumer compilation.
- The last re-review is restricted to these corrected concerns. A clean wave
  advances directly to the single final `verify:release` run.

## Final Affected Re-review Disposition

All four final reviewers completed against the frozen endpoint with the same
explicit immutable role profiles, read-only scope, and child-agent prohibition.
The API lane is clean and confirms grouped routing, private/public declarations,
root exports, dependencies, error types, and packed-consumer compatibility. The
final accepted correction batch is:

1. Replace the handwritten PostgreSQL reserved-word approximation with the
   exact QueryDSL 5.1.0 PostgreSQL keyword list used by the binding JVM commit.
   Add positive and negative goldens such as binding keyword `Cross` and plain
   non-keyword `New`.
2. Make the grouped-name regression assert the two specific `CREATE TABLE`
   statements, so later DML cannot satisfy a DDL claim accidentally.
3. Advance state-trim keyset pages. Keep the frozen first-obsolete high-water
   key, but after each full page bind the last `(version, created, ID)` as a
   strict continuation cursor. Prove page two uses a different tuple while
   exact zero/partial/multi-page retention remains correct.
4. Add PostgreSQL to the root README provider inventory.
5. Update release-publishing documentation from 18 to 19 public packages and
   include `@spine-event-engine/storage-postgres` in trusted-publisher setup.
6. Update architecture documentation that still says only Datastore/MySQL are
   durable providers, including PostgreSQL's database-per-tenant rule.
7. Replace the stale API-docs “MySQL-first” inventory wording with explicit
   MySQL and PostgreSQL provider coverage.

The proposed automatic/strictly verified history indexes are rejected for this
milestone. `TASK.md` explicitly assigns indexes to applications and says Spine
manages only record-family tables. The accepted bounded-maintenance contract
limits transferred keys and page size; it did not approve a provider-managed
index schema. No live query-plan evidence demonstrates a defect. A future index
contract would require a separately approved storage-layout milestone.

## Last-Correction Review Gate

- Frozen endpoint: `5e3c0631e`.
- Exact PostgreSQL coverage: 157 tests; 94.34% statements (`968/1026`), 90.47%
  branches (`551/609`), 95.12% functions (`312/328`), and 96.70% lines
  (`851/880`).
- Build, tooling typecheck, scoped lint, cleanup/callable limits, TSDoc,
  copyright, formatting, diff hygiene, documentation, TypeDoc/API, snippets,
  Proto, logging, dependency, and release-readiness gates pass.
- Packaging/release verification passes 234 tests in 13 files, including all 19
  tarballs and clean external TypeScript consumption of the PostgreSQL package.
- Reopened concerns and explicit profiles: style/maintainability,
  `gpt-5.6-terra` / `high`; performance/reliability, `gpt-5.6-terra` / `high`;
  documentation, `gpt-5.6-luna` / `medium`. Reviews are read-only, independent,
  receive no prior review conclusions, and cannot spawn children.
- TypeScript/API is N/A for this final delta: its preceding review was clean,
  and the accepted corrections changed internal renderer data, trim paging,
  assertions, and documentation inventories without changing any public type,
  export, declaration, error contract, or package boundary.

## Last-Correction Review Disposition

The full independent wave completed against the frozen endpoint before any
correction. Style and reliability accept the advancing trim cursor. The
accepted correction batch is:

1. Replace the approximate reserved-word set with the exact QueryDSL 5.1
   PostgreSQL keyword resource used by the binding JVM. Add positive and
   negative goldens that catch both omitted and extra words.
2. Make the grouped three-argument registration regression filter and assert
   the two specific `CREATE TABLE IF NOT EXISTS` targets. Later writes must not
   be able to satisfy this DDL claim.
3. Protect partial acquisition of the family and per-Entity session advisory
   locks. Track acquired locks, release them in reverse order, and discard a
   client after uncertain cleanup while preserving the original acquisition
   error. Add an induced second-lock failure regression.
4. Change the two remaining release-runbook claims from 18 packages to 19 and
   replace the architecture phrase “either adapter” now that three durable
   adapters are listed.

No other finding is accepted or deferred. The TypeScript/API lane remains N/A
for this delta for the reason recorded above. PostgreSQL 16/18 live acceptance
remains an external evidence gap because database URLs were not supplied.

## Last-Correction Implementation Evidence

- The authoritative keyword source was independently verified from Maven
  Central's `com.querydsl:querydsl-sql:5.1.0` source jar:
  `keywords/postgresql`, which `Keywords.POSTGRESQL` loads for
  `PostgreSQLTemplates`. The complete resource replaces the handwritten
  approximation. Goldens cover binding keyword `Collation` and non-keyword
  `Between`, alongside existing `Cross`, `New`, folding, collision, and byte
  boundary cases.
- The grouped three-argument builder regression now filters only `CREATE TABLE
IF NOT EXISTS` statements and requires `"spine"."groupedtable"` and
  `"spine"."google_protobuf_stringvalue"`; DML cannot satisfy the assertion.
- State trim records successful session acquisitions, releases only recorded
  locks in reverse order, and uses the established cleanup/disposal path. An
  induced per-Entity acquisition failure plus failed unlock proves that the
  family lock is released, the client is discarded, and the public result is
  the sanitized original operation error rather than cleanup details.
- `docs/release-publishing.md` now consistently states 19 packages, and the
  storage architecture refers to any durable adapter. Targeted tests pass
  `75/75`; changed-file ESLint, package typecheck, TSDoc, cleanup, Prettier,
  and diff hygiene pass. Live PostgreSQL 16/18 verification remains unavailable
  without supplied connection URLs.

## Last-Correction Affected Re-review Gate

- Frozen pushed endpoint: `75167a0aa`.
- Independent PostgreSQL package coverage passes 158 tests with 94.36%
  statements (`972/1030`), 90.47% branches (`551/609`), 95.13% functions
  (`313/329`), and 96.71% lines (`855/884`).
- Style/maintainability and performance/reliability reopen independently at
  explicit `gpt-5.6-terra` / `high`, read-only and without prior review memory
  or child agents. The documentation corrections are deterministic replacements
  of the exact reviewed phrases and therefore do not reopen that lane.

## Last-Correction Affected Re-review Disposition

Both affected reviews completed before correction. The production correction
is accepted: the exact 100-keyword QueryDSL resource matches independently,
partial acquisition cleans only acquired locks, cleanup uncertainty discards
the client without replacing the original sanitized operation failure, and the
advancing trim cursor is unchanged and correct.

Two test-only findings are accepted:

1. Replace grouped DDL subset matching with an exact two-target assertion, so
   extra or duplicate `CREATE TABLE IF NOT EXISTS` statements fail the test.
2. Add a successful two-lock trim assertion that the exclusive Entity unlock
   precedes the shared family unlock. Keep the partial-acquisition/discard test
   as its distinct case.

## Final Convergence Evidence

- The two accepted test findings are corrected without production or public API
  changes. The DDL test requires the exact two targets; lock tests separately
  prove successful reverse release and partial-acquisition discard behavior.
  Explicit guards also satisfy the tooling typechecker without weakening the
  runtime assertions.
- Final cheap preflight passes generated build, tooling typecheck, all static,
  documentation, Proto, dependency, and release-readiness gates. PostgreSQL
  coverage passes 159 tests at 94.36% statements, 90.47% branches, 95.13%
  functions, and 96.71% lines.
- Packaging/release verification passes 234 tests in 13 files, including all 19
  package tarballs, clean installation, and external TypeScript compilation.
- All relevant review concerns now have accepted dispositions. The only
  remaining local gate is the single final `pnpm verify:release` profile. Live
  PostgreSQL 16/18 acceptance still requires externally supplied database URLs.

## Last-Correction Test-Hardening Evidence

- The grouped builder regression now uses exact ordered equality for the two
  `CREATE TABLE IF NOT EXISTS` qualified targets; missing, extra, duplicate, or
  reordered DDL fails.
- A distinct successful state-trim regression requires the exclusive Entity
  session unlock before the shared family unlock. The partial-acquisition,
  cleanup-failure, discard, and sanitized-error regression remains separate.
- This batch changes tests and T-0230 records only; production code and public
  contracts are unchanged. Focused history/record tests pass `69/69`; scoped
  lint, TSDoc, cleanup, formatting, and diff checks are recorded with the
  pushed commit. The live PostgreSQL URL limitation remains unchanged.

## Last-Correction Tooling-Typecheck Repair

- Cheap preflight at `24e88d103` found TS2532 in two test-only indexed-access
  paths. Explicit runtime guards now fail clearly if the configured lock error
  or expected multi-page calls are absent, before test code reads the values.
- `pnpm typecheck:tooling` and focused Entity-history tests pass after this
  correction. No production or public-contract file changed; scoped static
  evidence accompanies the pushed test-only commit.

## Final Release-Verification Test Repair

- The single final `verify:release` run at `824f45485` had one failure and
  `4,884` passes: MessageBoard manifest expectations remained at snapshot.12
  after `6fab47c6d` updated its manifest dependencies to snapshot.13.
- Five stale expected Spine package versions in the startup contract now match
  `2.0.0-snapshot.13`; the Connect RPC and local-start assertions are unchanged.
  The exact startup contract and release-policy/package-artifact tests pass
  `31/31`. This is a test-only correction with no production or public-contract
  change; tooling/static evidence accompanies the pushed commit.
