# T-0230 Review Record

Status: Accepted corrections implemented; affected re-review ready

Initial review endpoint: `c09c961d6bf75e2cb90fb36fa2dc2c2e0882dd15`
Correction endpoint: `34ca4b669c78612bb158bba6635524e2c00341ed`
Baseline: `6fffcd6102b3eff94b0f77eb6db2fbf2e02ba172`

## Planned Review Concerns

| Concern                          | Existing role                      | Model           | Reasoning | Scope                                                                                                                                                                                                                                             | Disposition                                |
| -------------------------------- | ---------------------------------- | --------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Style and maintainability        | `style_maintainability_reviewer`   | `gpt-5.6-terra` | high      | Package structure, simplicity, method size, duplication, tests                                                                                                                                                                                    | Corrections implemented; re-review pending |
| Documentation completeness       | `documentation_reviewer`           | `gpt-5.6-luna`  | medium    | README, reference, storage guide, release and operational claims                                                                                                                                                                                  | Corrections implemented; re-review pending |
| TypeScript and API documentation | `typescript_api_docs_reviewer`     | `gpt-5.6-terra` | high      | Public exports, types, TSDoc, compatibility, external consumer                                                                                                                                                                                    | Corrections implemented; re-review pending |
| Performance and reliability      | `performance_reliability_reviewer` | `gpt-5.6-terra` | high      | SQL bounds, transactions, locks, histories, retries, lifecycle                                                                                                                                                                                    | Corrections implemented; re-review pending |
| Security release readiness       | N/A                                | —               | —         | Dedicated security review is reserved for final project/release readiness by the current protocol; SQL binding, credential handling, TLS, tenant/schema isolation, and dependency policy remain mandatory mechanical and specialist-review inputs | N/A with concrete reason                   |

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
