# T-0041 Review Log

Status: Wave 7 correction contract assigned for implementation

Baseline: `39f2c6f7`

Branch: `task/T-0041-final-project-security-gate`

## Review Contract

Use the full Human-Imposed Requirements Ledger, committed threat model,
security findings report, dependency audit evidence, current task/work status,
and a literal immutable review package. Ignore historical superseded text
unless current records or changed public docs claim it active.

Every security finding must include severity, attacker prerequisites, impacted
asset/trust boundary, exact repository evidence, existing controls, residual
risk, and the smallest correction. Do not elevate absent deployment-owned TLS,
auth, rate limiting, or production hardening into framework vulnerabilities
without evidence that the framework claims or bypasses those controls.

## Required Security Review

- Dedicated existing `security_reviewer`, explicit `gpt-5.6-terra` / high,
  only after the initial threat model, findings log, and dependency audit are
  committed.
- Scope: all public packages, Protobuf/generated boundaries, server/gRPC,
  storage/delivery, query/subscription, tenant routing, handler analyzer and
  generated registry loading, transport/ZeroMQ, testing utilities, example,
  docs, build scripts, and dependencies.
- Repeat after every accepted security-boundary fix until clean or a human
  explicitly accepts a documented residual risk.

## Canonical Concern Dispositions

- Style/maintainability: relevant to threat-model/report structure and any
  security fix; use existing Terra High reviewer.
- Documentation completeness: relevant to trust assumptions, mitigations,
  residual risks, and public docs corrected by findings; use existing Luna
  Medium reviewer.
- TypeScript/API docs: relevant to public trust/type/runtime claims and any
  changed contract; use existing Terra High reviewer.
- Performance/reliability: relevant to DoS, bounds, persistence, concurrency,
  lifecycle, and resource cleanup; use existing Terra High reviewer.
- Run the four concerns after security artifacts/fixes stabilize. Record a
  concrete N/A only for a wave whose changed behavior cannot affect that
  concern.

## Pre-Review Lint

Before every review wave, check synchronized status, duplicate policy values,
public/internal leakage, future-policy overclaim, secret/redaction hygiene,
tracked generated output, dependency-audit freshness, and diff integrity.

## Completed Architecture Assignment

- Existing `requirements_splitter`, expected explicit `gpt-5.6-sol` /
  high, project-wide read-only security architecture split, no subagents or Git
  mutation.
- The splitter does not replace the dedicated final security reviewer.
- Splitter agent `019f62cb-d7fa-72b3-b0e9-d1ba22ff48c4`: explicit dispatch
  and immutable actual runtime profile `gpt-5.6-sol` / high, no subagents or
  Git mutation.
- Result accepted: ten trust boundaries, stable `TM-001` through `TM-012`
  hypotheses, dependency-audit classification, focus paths, and bounded review
  sequence. No final finding was adjudicated and no further architecture
  escalation was requested.
- Agent closed after acceptance.

## Pending Artifact Author

- Existing `implementer`, expected explicit `gpt-5.6-terra` / medium, bounded
  to the two security artifacts and durable evidence entries, with no
  production-code changes, subagents, or Git mutation.
- The dedicated `security_reviewer` remains pending until the artifact commit
  and focused mechanical checks are complete.

## Security Fix Implementation Evidence

- Existing `implementer`, expected/actual immutable `gpt-5.6-terra` / medium,
  resumed the accepted three-slice TDD sequence at `869a225d`, without
  subagents or Git mutation.
- Slice 1 RED begins with public constructor validation for both SF-007 message
  bounds. Exact command/result evidence follows in this section as each cycle
  completes.
- Slice 1 validation RED command: `pnpm
--config.verify-deps-before-run=false exec vitest run
packages/server/test/server/server.test.ts -t 'rejects invalid network message
bounds'`; exit 1, exactly 1 failed/21 skipped, expected throw absent. The
  whole-file sandbox `listen EPERM` attempt is excluded from behavior evidence.
- Slice 1 validation GREEN: the same command exited 0 with 1 passed/21 skipped.
- The next tracer is a real uncompressed command above a 512-byte public
  `readMaxBytes` bound; forwarding is temporarily absent to establish RED.
- Slice 1 uncompressed native RED: the focused services test exited 1 with 1
  failed/98 skipped because the oversized command resolved successfully. The
  preceding sandbox `listen EPERM` result is classified as environment-only.
- Slice 1 uncompressed native GREEN: same focused command exited 0 with 1
  passed/98 skipped. Compressed request and response-bound regressions were
  added next. Response forwarding native RED exited 1 with 1 failed/100 skipped
  because the oversized query response resolved successfully.
- Configured-bound native GREEN exited 0 with 3 passed/98 skipped. The exact
  4,194,304-byte default request-bound tracer is next; default behavior RED is
  confirmed natively: exit 1, 1 failed/101 skipped because the oversized
  payload resolved. The finite default is restored; GREEN is pending.
- Slice 1 default native GREEN exited 0 with 1 passed/101 skipped. SF-007 is
  implemented with public validation/TSDoc, direct Connect forwarding,
  configured compressed/uncompressed request and response tests, exact default
  behavior, and docs/security-artifact updates. Security re-review is pending.
- Slice 2 capacity RED exited 1 with 2 failed/102 skipped for the focused
  validation/concurrent-persistence command; the identical GREEN exited 0 with
  2 passed/102 skipped after the validated default-100 option and private ID
  reservation set were added.
- Slice 2 query RED exited 1 with 2 failed/104 skipped: implicit queries lacked
  a storage limit and a 1,001-row tenant returned all rows. The identical GREEN
  exited 0 with 2 passed/104 skipped after absent/zero wire limits began
  carrying the common 1,000-row storage cap.
- Focused rollback/release coverage exited 0 with 8 passed/103 skipped;
  recovery/CAS/queue/activation coverage exited 0 with 5 passed/109 skipped.
  Evidence covers pending, inactive, active, and recovery reservations,
  persistence/remember cleanup, observable delete failure after release,
  duplicate activation retention, capacity-before-CAS, unconsumed recovery on
  exhaustion, CAS loss/error release, queue overflow, and activation failure.
  SF-008/SF-009 are implemented pending re-review; SF-010 remains.
- Slice 2 full-file native verification passed 114/114; the preceding sandbox
  run's 19 loopback `listen EPERM` failures are environment-only.
- Slice 3 lexical/ownership/mode RED exited 1 with 4 failed/20 skipped; the
  identical GREEN exited 0 with 4 passed/20 skipped. A separate recheck RED
  exited 1 with 1 failed/26 skipped because mocked native connect was reached;
  restoring the immediate recheck yielded 1 passed/26 skipped.
- Native canonical alias/replacement coverage passed 3/3, the full ZeroMQ
  transport file passed 27/27, and the focused adapter/smoke/transport/
  cross-process set passed 4 files/40 tests after short macOS `/tmp` aliases
  replaced overlong test socket paths. Build typechecking passed.
- SF-010 now uses canonical one-component creation, exact POSIX owner/mode,
  prepared identity, and immediate native-boundary rechecks. The documented
  pathname post-check substitution residual remains deployment-owned. All four
  findings are implemented, but dedicated security re-review and task closure
  remain pending.
- Final focused runtime verification passed: the Server/SpineServices command
  exited 0 with 2 files/136 tests, and the native ZeroMQ adapter/smoke/
  transport/cross-process command exited 0 with 4 files/40 tests.
- `typecheck:generated` initially exited 2 on two test-only typing defects; after
  optional-state handling and a narrowed test-storage cast, the identical
  command exited 0 for both `tsc -b` and tooling `tsc --noEmit`.
- `docs:check` exited 0, verified 25 copied proto checksums, and verified 100
  proto, 28 core, 205 server, 19 storage, 17 transport, and 3 testing exports.
  Focused ESLint, Prettier check, and `git diff --check` all exited 0. Generated
  output remains ignored. These checks do not substitute for pending canonical
  review, final security re-review, full verification, or task closure.

## Coordinator Artifact Verification - Finding Batch 1

- `TM-002` through `TM-011` were assigned to different hypotheses than the
  accepted splitter result. Stable IDs must preserve this order: tenant
  identity binding, tenant propagation/isolation, malformed schema/`Any`,
  exposed intake, subscriptions, delivery retry/retention, local IPC,
  generated-module execution, dependencies, sensitive diagnostics, lifecycle
  cleanup, and regex/analyzer work.
- The scope says consumers own all persistence, but the accepted boundary says
  consumers own production persistence adapters/deployment while framework
  storage and tenant behavior remain in scope.
- The compact threat table does not yet expose each hypothesis's asset,
  investigation/status, and realistic prerequisite clearly enough to satisfy
  the accepted artifact contract.
- Return this complete batch to the same implementer context before artifact
  commit and dedicated security review.

## Finding Batch 1 Resolution

- Same implementer agent `019f62d7-31cc-7c13-a0b1-61d25dff9e23`, immutable
  actual `gpt-5.6-terra` / medium, restored the exact stable threat mapping,
  narrowed persistence ownership, and expanded required threat fields.
- Coordinator re-read the corrected artifacts and reran the focused pre-review
  lint. Prettier, docs/TypeDoc/API checks, status and policy scans, secret and
  public-leak scans, generated tracking, stable-ID scan, and diff integrity are
  clean.
- The implementer is closed. Dedicated security review may proceed from the
  committed artifact endpoint.

## Dedicated Security Reviewer Assignment

- Existing `security_reviewer`, expected explicit `gpt-5.6-terra` / high,
  read-only against the immutable review package, no subagents or Git mutation.
- Review the whole release surface through the bounded `TM-*` hypotheses and
  report concrete findings only. Historical superseded text is inactive unless
  a current task/status record or changed public doc claims it as active.
- Artifact endpoint `039aabd4`; immutable package
  `.superpowers/sdd/review-39f2c6f7..039aabd4.diff` (4 commits, 59,729 bytes).
- Reviewer agent `019f62e5-7a3b-7e50-84d3-7f7991ffe7a5` was explicitly
  dispatched as the existing `security_reviewer` with model
  `gpt-5.6-terra` and reasoning `high`; immutable role metadata confirms actual
  `gpt-5.6-terra` / high. No subagents or Git mutation are permitted.

## Dedicated Security Review Round 1

- Actual immutable profile matched dispatch: `gpt-5.6-terra` / high. Required
  security skills were applied, no subagents were spawned, no repository/Git
  mutation occurred, and the reviewer is closed.
- `SF-007` - High, high confidence, TB-01: `createHttpServer()` does not pass
  `readMaxBytes`/`writeMaxBytes`; Connect 2.1.2 defaults both to `0xffffffff`.
  A reachable caller can force excessive pre-validation buffering or
  decompression. Add finite validated limits and oversized compressed/
  uncompressed network regressions.
- `SF-008` - High, high confidence, TB-01/TB-02: every subscribe creates a UUID,
  durable record, timer, and later listener/queue, but only inactive TTL and
  per-subscription queue limits exist. Add one total-capacity reservation with
  exact rollback/release across persistence failure, expiry, cancellation, and
  stream cleanup; cover concurrent saturation.
- `SF-009` - Medium, high confidence, TB-01/TB-02: omitted query format is
  accepted and include-all produces an unbounded storage query. Apply a finite
  default or require a positive limit; cover more than 1,000 rows and tenant
  filtering.
- `SF-010` - Medium, high confidence, TB-06: IPC validation uses `stat()` and
  mode bits only. Reject final/ancestor symlinks, require effective-UID
  ownership on POSIX, recheck before bind, and test symlink/foreign-owner paths.
- `SF-001`, `SF-003`, `SF-004`, and `SF-006` remain accurate. `SF-002` is
  superseded by `SF-010`; `SF-005` is superseded in part by `SF-007` through
  `SF-009`. TM-004, TM-005, and TM-007 are confirmed; the remaining recorded
  hypotheses produced no confirmed defect. Round 1 is not clean.

## Security Fix Architecture Assignment

- Existing `requirements_splitter`, expected explicit `gpt-5.6-sol` / high,
  read-only, no subagents or Git mutation.
- Resolve public-contract/default ambiguity once, using Spine JVM/source and
  local Connect 2.1.2 evidence, before one implementer receives the full batch.
- Resumed splitter agent `019f62cb-d7fa-72b3-b0e9-d1ba22ff48c4` was explicitly
  redispatched with model `gpt-5.6-sol` and reasoning `high`; immutable actual
  profile is `gpt-5.6-sol` / high, read-only, without subagents or Git mutation.

## Accepted Security Fix Architecture

- The splitter completed and is closed. Accepted contracts are direct 4 MiB
  configurable Connect limits, default-100 idempotent subscription
  reservations, an implicit 1,000-row query safety limit with unchanged wire
  semantics, and root-to-leaf IPC link/identity checks with final POSIX
  ownership and mode enforcement.
- One existing implementer receives the complete finding batch and executes
  three sequential slices. Canonical concern review and security re-review wait
  for the full fix endpoint and focused verification.

## IPC Architecture Validation Finding

- Literal root-to-leaf link rejection conflicts with standard macOS `/var` and
  `/tmp` system symlinks and would break current IPC tests/configuration.
- Reopen only the `SF-010` path algorithm with the same splitter before
  implementation. Do not weaken final-directory ownership/mode/non-link checks
  or claim complete pathname-race elimination.

## Corrected IPC Architecture Disposition

- Existing splitter `019f62cb-d7fa-72b3-b0e9-d1ba22ff48c4` was resumed with
  explicit expected `gpt-5.6-sol` / high; immutable runtime metadata confirms
  actual `gpt-5.6-sol` / high. It remained read-only, spawned no children, and
  is closed.
- `SF-010` now permits only immutable root-owned POSIX ancestor aliases whose
  root-owned containing directory is not group/world writable, preserving
  standard macOS `/var` and `/tmp` aliases without accepting user-replaceable
  redirects.
- Preparation pins the followed existing anchor by `dev`/`ino` and `realpath`,
  creates missing components non-recursively, rejects a final link, validates
  final effective-UID ownership plus exact `0700`, and discards the lexical
  alias. Endpoint derivation and cleanup use only the canonical path.
- Each native bind/connect receives an immediate canonical-path, final-object,
  ownership, mode, and identity recheck. Non-POSIX behavior and the residual
  pathname race are documented without overclaiming portable guarantees.

## Coordinator Fix-Endpoint Finding

- SF-010 implementation currently rechecks a missing suffix component only on
  the `mkdir()` `EEXIST` path. A successful creation advances without the
  architecture-required immediate `lstat()` non-link/directory verification.
- Return this confirmed contract gap to the existing implementer with expected
  explicit immutable `gpt-5.6-terra` / medium. Canonical concern review and
  dedicated security re-review remain blocked on the corrected committed
  endpoint.

## Coordinator Fix-Endpoint Acceptance

- Existing implementer returned with actual immutable
  `gpt-5.6-terra` / medium, the required immediate successful-create check,
  focused RED/GREEN evidence, and no subagents or Git mutation; it is closed.
- Coordinator native affected verification passed 6 files/177 tests.
  Build/tooling typechecks, docs generation and exact API counts, focused
  ESLint/Prettier, status/public-leak/duplicate-policy/overclaim scans,
  generated-output tracking, and diff integrity all passed.
- Review basis may now advance to the committed complete-fix endpoint. Run all
  four canonical concerns as one wave before any fixes, then rerun the dedicated
  project security reviewer against the post-canonical endpoint.

## Canonical Review Wave Assignment

Review package: `.superpowers/sdd/review-39f2c6f7..5714e97c.diff` (9 commits,
208,732 bytes).

- Existing `style_maintainability_reviewer`, expected explicit
  `gpt-5.6-terra` / high: changed-code clarity, ownership, duplication,
  lifecycle readability, and maintainability only.
- Existing `documentation_reviewer`, expected explicit `gpt-5.6-luna` /
  medium: current user/package/security documentation completeness, accuracy,
  residual-risk honesty, links, and status wording only.
- Existing `typescript_api_docs_reviewer`, expected explicit
  `gpt-5.6-terra` / high: public TypeScript contract compatibility, declaration
  shape, TSDoc/API export accuracy, runtime/type agreement, and accidental
  internal leakage only.
- Existing `performance_reliability_reviewer`, expected explicit
  `gpt-5.6-terra` / high: resource caps, reservation lifecycle, concurrency,
  persistence/CAS cleanup, query limiting, IPC identity races, and shutdown
  behavior only.
- Every lane is read-only, may not spawn subagents or mutate Git, reviews the
  immutable package plus current task/security records, and ignores historical
  superseded text unless a current status/brief or changed public document
  claims it as active. Return concrete defects with severity, exact evidence,
  impact, and smallest correction; do not seek stylistic disagreement.

## Coordinator IPC Correction Evidence

- Existing implementer `019f62d7-31cc-7c13-a0b1-61d25dff9e23`, immutable
  actual `gpt-5.6-terra` / medium, used one package-private filesystem seam and
  changed no public interface or Git state.
- Focused RED exited 1 with 1 failed/27 skipped: replacing a successfully
  created first suffix with a symlink led to the later canonical-path error,
  proving immediate verification was absent.
- The minimal correction performs the same `lstat()` non-link/directory check
  after both successful `mkdir()` and `EEXIST`, before advancing. Focused GREEN
  exited 0 with 1 passed/27 skipped; full native signal-transport regression
  exited 0 with 1 file/28 tests.
- SF-010 is restored to implemented pending dedicated security re-review.
  Canonical review, full verification, integration, and task closure remain
  pending.

## Canonical Review Wave Result

- TypeScript/API docs: CLEAN, agent
  `019f6326-9fae-7561-b033-cb126e2a8b3f`, actual immutable Terra High.
- Documentation: profile-valid redispatch agent
  `019f6329-25b0-7242-85da-177f5e01deca`, actual immutable Luna Medium, CLEAN.
  Coordinator confirmed two valid low findings from the rejected first result:
  stale threat-model provenance/status and ambiguous positive-limit wording.
- Style/maintainability: agent `019f6329-fbff-7fe3-be34-825e15f837f4`, actual
  immutable Terra High, three findings: split the 81-line IPC preparation,
  cover request/publisher replacement rechecks, and shorten overlong local
  identifiers.
- Performance/reliability: agent `019f6328-bdca-7a00-9ce0-9c7151aee82d`,
  actual immutable Terra High, two findings: same-ID concurrent recovery may
  release another activation's reservation, and close may finish before a
  paused request resumes and connects.
- The complete seven-item batch returns to existing implementer
  `019f62d7-31cc-7c13-a0b1-61d25dff9e23`, expected explicit immutable
  `gpt-5.6-terra` / medium. No partial-wave fixes, subagents, or Git mutation;
  dedicated security re-review waits for the corrected canonical endpoint.

## Canonical Fix Coordinator Acceptance

- Existing implementer returned with actual immutable
  `gpt-5.6-terra` / medium, all seven findings addressed, and is closed without
  subagents or Git mutation.
- Fresh native affected verification passed 2 files/144 tests. Build/tooling
  typechecks, docs generation/API counts, focused ESLint/Prettier, status and
  targeted wording/naming scans, generated tracking, and diff integrity passed.
- Commit and package this endpoint, then repeat all four canonical concerns as
  one complete wave before dedicated project security re-review.

## Canonical Review Wave 2 Assignment

Package: `.superpowers/sdd/review-39f2c6f7..19728018.diff` (12 commits, 236,186
bytes).

- `style_maintainability_reviewer`: explicit immutable Terra High; verify the
  prior method-size, naming, coverage, and maintainability corrections plus the
  complete changed surface.
- `documentation_reviewer`: explicit immutable Luna Medium; verify provenance,
  zero/positive-limit wording, current status, and all changed public/security
  claims.
- `typescript_api_docs_reviewer`: explicit immutable Terra High; verify public
  declarations/runtime agreement, exports, TSDoc, and internal seam isolation.
- `performance_reliability_reviewer`: explicit immutable Terra High; verify
  reservation ownership, request-close coordination, finite bounds, IPC races,
  persistence, and cleanup.
- Every lane is read-only, has no subagents or Git mutation, ignores historical
  superseded text unless current records/docs claim it active, and must attest
  its immutable role profile. Aggregate the full wave before fixes.

## Canonical Review Wave 2 Result

- Style/maintainability: CLEAN; agent
  `019f633d-911a-75e3-b87f-bf42a589a6db`, actual immutable Terra High.
- Documentation: one low stale-provenance finding; agent
  `019f633d-8995-7b41-b811-4fcae0beeeed`, actual immutable Luna Medium.
- TypeScript/API docs: one medium per-instance-vs-process-wide claim mismatch;
  agent `019f633d-8d8c-76c1-a270-dd17692f4252`, actual immutable Terra High.
- Performance/reliability: one high cancel-versus-recovery ownership/revival
  race; agent `019f633f-0ce6-7322-abcd-8cd8f3dea9c0`, actual immutable Terra
  High.
- Return the complete three-item batch to existing implementer
  `019f62d7-31cc-7c13-a0b1-61d25dff9e23`, expected explicit immutable Terra
  Medium. Require owner-scoped release, cancellation observed during paused CAS,
  no post-cancel remember, no capacity bypass, synchronized docs/provenance,
  and focused evidence before a new package. All reviewers are closed.

## Canonical Wave 2 Fix Acceptance

- Existing implementer returned with actual immutable
  `gpt-5.6-terra` / medium, all three findings addressed, and is closed without
  subagents or Git mutation.
- Fresh native service verification passed 117/117. Typechecks, docs/API,
  focused lint/format, status/provenance/per-instance scans, generated tracking,
  and diff integrity passed.
- Commit and package this endpoint, then repeat all four canonical concerns as
  one wave before dedicated security re-review.

## Canonical Review Wave 3 Assignment

Package: `.superpowers/sdd/review-39f2c6f7..ffd8549e.diff` (15 commits, 260,743
bytes).

- Style/maintainability: explicit immutable Terra High; complete changed-code
  ownership, readability, naming, test, and coordination-state review.
- Documentation: explicit immutable Luna Medium; current provenance, scope,
  defaults, status, links, and residual-risk claims.
- TypeScript/API docs: explicit immutable Terra High; declarations/runtime,
  exports, TSDoc/TypeDoc, and private coordination/test seams.
- Performance/reliability: explicit immutable Terra High; owner-token
  reservation, cancel/recovery settlement, finite bounds, persistence/CAS,
  request-close, IPC, and cleanup.
- Read-only, no subagents/Git mutation, explicit profile attestation, historical
  superseded-text exclusion, and complete-wave aggregation are required.

## Canonical Review Wave 3 Result

- Documentation: two low provenance/path findings; agent
  `019f6354-2428-7b11-af1d-46180b16e05c`, actual immutable Luna Medium.
- TypeScript/API docs: one low missing query-cap class TSDoc finding; agent
  `019f6354-1c3f-7201-ae11-aced62f14e6d`, actual immutable Terra High.
- Style/maintainability: one high resident-cancel recovery-revival race and one
  low oversized recovery-method finding; agent
  `019f6354-2086-7c13-8614-6967eba71850`, actual immutable Terra High.
- Performance/reliability: independently confirmed the same high race; agent
  `019f6356-685b-7ab1-913d-3166033fdea6`, actual immutable Terra High.
- Return the deduplicated four-item batch to existing implementer
  `019f62d7-31cc-7c13-a0b1-61d25dff9e23`, expected explicit immutable Terra
  Medium: removal tombstone before release/removal, held through delete;
  recovery waits/refuses; deterministic delayed-delete race; per-store method
  extraction; class TSDoc and security provenance/path fixes. All reviewers are
  closed; dedicated security re-review remains pending.

## Canonical Wave 3 Fix Acceptance

- Existing implementer returned with actual immutable
  `gpt-5.6-terra` / medium, all findings addressed, and is closed without
  subagents or Git mutation.
- Fresh native service verification passed 120/120. Typechecks, docs/API,
  focused lint/format, status/provenance/path/TSDoc scans, generated tracking,
  and diff integrity passed.
- Commit and package the corrected endpoint, then repeat all four canonical
  concerns before dedicated security re-review.

## Canonical Review Wave 4 Assignment

Package: `.superpowers/sdd/review-39f2c6f7..5a165d07.diff` (18 commits, 288,174
bytes).

- Style/maintainability Terra High: ownership state, removal/recovery helper
  clarity, naming, method size, and deterministic tests.
- Documentation Luna Medium: fixed runtime basis/package, evidence paths,
  per-instance/default/query/status/residual claims and links.
- TypeScript/API Terra High: public TSDoc/declarations/exports/runtime agreement
  and private coordination/test seams.
- Performance/reliability Terra High: both cancellation orderings, removal and
  recovery settlement/failure, token/tombstone leaks, finite bounds,
  persistence/CAS, request-close, IPC and cleanup.
- Explicit immutable profile attestation, read-only/no subagents/Git mutation,
  superseded-history exclusion, and full-wave aggregation are required.

## Canonical Review Wave 4 Result

- Style/maintainability: CLEAN; agent
  `019f6367-ae14-7f93-b09c-f8629e98e664`, actual immutable Terra High.
- TypeScript/API docs: CLEAN; agent
  `019f6367-b226-7a83-b3b6-1d49c24d0a7e`, actual immutable Terra High.
- Documentation: two low provenance/status findings; agent
  `019f6367-b61a-7c52-b67a-af00b5711d4b`, actual immutable Luna Medium.
- Performance/reliability: two high findings; agent
  `019f6369-9854-73f2-8bbb-31f3a390de96`, actual immutable Terra High:
  cross-instance recovery is not fenced by local removal, and unknown-ID
  removals are unbounded.
- All reviewers are closed. Existing requirements splitter
  `019f62cb-d7fa-72b3-b0e9-d1ba22ff48c4`, expected explicit immutable Sol High,
  must define the smallest persisted fence/bounded-removal contract before one
  Terra Medium implementation batch. Dedicated security re-review remains
  pending.

## Wave 4 Architecture And Fix Disposition

- Existing requirements splitter `019f62cb-d7fa-72b3-b0e9-d1ba22ff48c4`
  completed with actual immutable Sol High, matching its explicit expected
  profile, and is closed without writes or subagents.
- D-0087 accepts an exact persisted inactive-to-claim-to-marker-to-absence CAS
  lifecycle. Remote-owned claims produce truthful `Aborted` cancellation;
  existing inactive records remain compatible and no public/generated contract
  changes.
- Distinct non-local removals receive a separate per-instance bound equal to
  `subscriptionLimit`; overflow rejects before storage and same-ID operations
  remain shared.
- Return the complete accepted batch to existing implementer
  `019f62d7-31cc-7c13-a0b1-61d25dff9e23`, expected explicit immutable Terra
  Medium. Require deterministic two-instance RED/GREEN plus cleanup, capacity,
  compatibility, docs, security-artifact, and provenance corrections before a
  fresh immutable package. Canonical and dedicated security re-review remain
  pending.

## Wave 4 Implementer Applicability Gate

- Before code actions, implementer `019f62d7-31cc-7c13-a0b1-61d25dff9e23`
  confirmed actual immutable Desktop runtime `gpt-5.6-terra` / medium, matching
  the explicit assignment. No subagents or Git-state mutation are authorized.
- Session inventory, expected-skill manifest, complete bounded installed-skill
  entrypoint listing, and readable installed lock were checked. Applicable
  TDD/testing, TypeScript, Node backend, security, receiving-review, and final
  verification guidance was fully read, including referenced testing material.
- No exact Connect/Node security reference exists. Deployment-owned generic
  policy is not converted into framework scope. Existing recorded Spine JVM
  evidence was reconfirmed only as a guardrail; D-0087 remains the complete
  accepted behavior and excludes lease/liveness/reclamation expansion.

## Wave 4 Implementer Result

- Existing implementer `019f62d7-31cc-7c13-a0b1-61d25dff9e23` reports actual
  immutable `gpt-5.6-terra` / medium, matching dispatch, with no subagents or
  Git-state mutation.
- D-0087 exact inactive/owner-claim/cancel-marker CAS lifecycle and separate
  bounded unknown-removal pool are implemented without public/generated API,
  storage interface, package-root export, manifest, or lockfile changes.
- Recorded RED/GREEN covers codec absence, both cross-instance CAS orderings,
  unknown-removal storage-failure normalization/release, and recovered local
  registration rollback. Additional deterministic green coverage exercises
  both same-instance orderings, concurrent inactive cancellation, marker
  failure/fencing/retry, capacity retention, and legacy inactive compatibility.
- Native `spine-services.test.ts` passes 130/130. Generated/tooling typecheck,
  docs, focused lint/format, provenance/export/policy/generated scans, and diff
  integrity are green and recorded in the work/task logs.
- Wave 4 implementation is ready for a fresh canonical review package and then
  dedicated security re-review. Neither review nor T-0041 is complete.

## Canonical Wave 3 Fix Evidence

- Existing implementer `019f62d7-31cc-7c13-a0b1-61d25dff9e23`, actual
  immutable `gpt-5.6-terra` / medium, implemented all four deduplicated findings
  without subagents or Git mutation.
- Resident cancel/recovery RED exited 1 with 1 failed/117 skipped because
  activation reached CAS during paused durable deletion. The identical command
  is GREEN with 1 passed/117 skipped after synchronously installing a shared
  per-ID removal operation before local release and retaining it through delete
  settlement.
- The after-read recovery gate passed 1/1 (118 skipped). Concurrent resident
  cancellation with injected delete failure passed 1/1 (119 skipped), proving
  one shared delete, observable errors for both callers, tombstone cleanup, and
  reusable capacity.
- Recovery now has a bounded outer iterator plus explicit per-store and consume
  stages. The existing recovery-owner cancellation remains intact. Public query
  cap TSDoc, fixed `ffd8549e` runtime package provenance, and the package README
  evidence path are corrected. Canonical and dedicated security re-review and
  T-0041 closure remain pending.
- Focused lifecycle verification passed 21/21 and full native SpineServices
  passed 120/120. The final combined three-case run passed 3/3. Generated/tooling
  typechecks, docs/API checks, focused ESLint, seven-file Prettier, fixed-status
  and provenance/path/TSDoc scans, generated tracking, and diff integrity are
  green. Docs verified 25 Proto checksums and API counts
  `100/28/205/19/17/3`; one intermediate ESLint brace-style failure was
  corrected before the green rerun.

## Canonical Review Fix Batch Evidence

- Existing implementer `019f62d7-31cc-7c13-a0b1-61d25dff9e23`, actual
  immutable `gpt-5.6-terra` / medium, resolved all seven deduplicated findings
  without subagents or Git mutation.
- Behavior RED/GREEN was observed for both reliability defects: same-ID
  recovery changed from 1 failed/114 skipped to 1 passed/114 skipped, and the
  paused request-close race changed from 1 failed/28 skipped to 1 passed/28
  skipped. Intermediate recovery harness timeouts were superseded by the final
  bounded deterministic test.
- Focused regression evidence is green for four recovery paths (4 passed/111
  skipped) and request-close plus all four native replacement paths (2
  passed/27 skipped). Full native affected files are green: SpineServices
  115/115 and signal transport 29/29. The initial sandboxed server run's 19
  `listen EPERM` failures were environment-only and superseded by the native
  pass.
- Generated build/tooling typechecks, focused ESLint, ten-file Prettier check,
  docs generation/API validation, and `git diff --check` all exit 0. The docs
  check verified 25 copied Proto checksums and API counts
  `100/28/205/19/17/3`; generated outputs remain ignored.
- The corrected endpoint is ready for canonical and dedicated security
  re-review. No review is marked complete here, and T-0041 remains open.

## Canonical Wave 2 Fix Evidence

- Existing implementer `019f62d7-31cc-7c13-a0b1-61d25dff9e23`, actual
  immutable `gpt-5.6-terra` / medium, resolved the complete three-item batch
  without subagents or Git mutation.
- Paused-CAS cancellation changed from 1 failed/115 skipped to 1 passed/115
  skipped. One intermediate timeout was test-ordering-only and is superseded by
  the final deterministic schedule. The cleanup-failure case passed 1/1 and the
  focused lifecycle regression set passed 18/18.
- Owner tokens preserve the Set-backed capacity bound; canceled recovery waits
  through CAS and durable deletion before owner release, cannot remember after
  the final cancellation check, and removes token/cancellation state on success
  or observable deletion failure.
- Per-instance scope wording and stable log-owned provenance are synchronized.
  Full native SpineServices passed 117/117; typecheck, docs/API validation,
  focused ESLint, Prettier, targeted wording/provenance scans, and diff integrity
  are green.
- Canonical re-review and dedicated security re-review remain pending. This log
  does not mark the wave, security gate, or T-0041 complete.

## Wave 4 Coordinator Pre-Review Finding

- Fresh coordinator verification reproduced 9 focused and 130 full native
  service passes plus green type/docs/lint/format/diff checks.
- Pre-review source inspection nevertheless found one D-0087 failure-path gap:
  a failed known-local cancellation forgets its exact owner claim and releases
  capacity even when no marker was installed, so retry sees the surviving claim
  as foreign.
- Return this one confirmed finding to the existing Terra Medium implementer.
  Require RED/GREEN for local owner/capacity retention through pre-marker
  storage failure, successful same-ID retry cleanup, and exact-once release.
  Canonical review package generation waits for that correction.

## Wave 4 Coordinator Retry Acceptance

- Existing Terra Medium implementer is closed with matching immutable runtime
  metadata. Coordinator retry tests passed 3/3 and the full native service file
  passed 133/133; type/docs/lint/format/diff checks are green.
- The D-0087 owner-retention finding is accepted as fixed. Public and generated
  surfaces remain unchanged and current docs preserve the stale-claim residual.
- Pre-review lint has one mechanical fix before packaging: replace duplicated
  cancellation `Aborted` message literals with shared private constants used by
  both error factories and conflict classification. Canonical and security
  review remain pending.

## Wave 4 Pre-Review Lint Fix Assignment

- Existing implementer `019f62d7-31cc-7c13-a0b1-61d25dff9e23`, expected
  explicit immutable Terra Medium, owns the private message-constant cleanup.
  It must preserve exact errors and rerun focused mechanical evidence before a
  new package. Canonical/security review remains pending.

## Wave 4 Pre-Review Lint Acceptance

- Existing implementer returned with matching immutable Terra Medium metadata
  and is closed. Coordinator conflict tests passed 2/2; typecheck, lint,
  formatting, literal-deduplication, and diff checks are green.
- The pre-review lint pass is clean. Generate a fresh immutable package from
  baseline `39f2c6f7` and dispatch all four canonical concerns as wave 5 before
  dedicated security re-review.

## Canonical Review Wave 5 Assignment

Package: `.superpowers/sdd/review-39f2c6f7..b4274b06.diff` (25 commits, 401,247
bytes).

- `style_maintainability_reviewer`: explicit immutable Terra High; review
  state-machine readability, ownership, method size, naming, duplication, and
  behavior-focused test maintainability.
- `documentation_reviewer`: explicit immutable Luna Medium; review current
  status/provenance, public cancellation behavior, finite bounds, compatibility,
  stale-claim/malformed-row residuals, and excluded future policy.
- `typescript_api_docs_reviewer`: explicit immutable Terra High; review public
  runtime/declarations/TSDoc/TypeDoc agreement, package-private state isolation,
  stable Connect errors, and wire compatibility.
- `performance_reliability_reviewer`: explicit immutable Terra High; review
  every activation/cancel CAS ordering, failure/retry ownership, cleanup,
  capacity, malformed/stale states, adapter atomicity, and deterministic tests.
- All lanes are read-only, no subagents/Git mutation, exact profile attestation,
  mandatory skill check, current-state scope, and full-wave aggregation before
  fixes. Dedicated security re-review follows only after canonical closure.

## Canonical Wave 5 Style Redispatch

- Style agent `019f63af-3c54-7b30-b0ba-32123ff926a9` is closed and invalid for
  acceptance because actual runtime model/reasoning metadata was unavailable.
  Its timing-based test observation is not yet an accepted wave finding.
- Redispatch the same role with explicit immutable Terra High and require a
  fresh independent result plus actual profile attestation. Keep the other
  three lane results and aggregate all valid lanes before action.

## Canonical Review Wave 5 Result

- Runtime attribution: the orchestrator-visible multi-agent schema fixes each
  existing role's immutable actual profile, and explicit dispatch matched it.
  Style/API/reliability are Terra High; docs is Luna Medium. The child-local
  metadata visibility warning is superseded by this system runtime evidence.
  The no-review second style redispatch is excluded. Every agent is closed.
- Style: P1 deterministic coverage gap at the two 25 ms negative-CAS races.
- Documentation: P2 stale threat-model line anchors; P2 missing public
  cancellation `INTERNAL`/same-ID retry workflow.
- TypeScript/API: P1 permissive Base64 plus absent embedded-ID equality can
  decode malformed inactive rows, delete them despite inert docs, or emit an
  update carrying a different subscription ID.
- Performance/reliability: P1 commit-then-reject initial persistence plus
  cleanup failure releases capacity and can leave unbounded durable rows whose
  generated IDs were never returned.
- Return the complete deduplicated five-item batch to existing implementer
  `019f62d7-31cc-7c13-a0b1-61d25dff9e23`, expected explicit immutable Terra
  Medium. Require deterministic RED/GREEN, focused/full service verification,
  current docs/security anchors, and a fresh package. Dedicated security review
  remains pending.

## Canonical Wave 5 Fix Result

- Existing implementer `019f62d7-31cc-7c13-a0b1-61d25dff9e23`, actual
  immutable `gpt-5.6-terra` / medium, reproduced the ambiguous-persistence
  finding without subagents or Git mutation. The focused command for `retains
ambiguous persistence until inactive cleanup settles` exited 1 with 1
  failed/133 skipped because no `ResourceExhausted` error was raised after the
  committed write rejected and immediate cleanup read failed.
- After the minimal retention fix, the identical command exited 0 with 1
  passed/133 skipped. The original subscribe error remains observable; the
  unreturned record is inert and capacity-held until its inactive timer settles
  exact persistent cancellation. This is implementer evidence only; the rest
  of wave 5 had not yet been applied; coordinator/canonical/security
  verification remained pending.
- Strict-codec RED exited 1 with 1 failed/134 skipped because a noncanonical
  payload reached claim CAS. The identical GREEN exited 0 with 1 passed/134
  skipped after canonical Base64 plus exact embedded-ID validation; combined
  direct/recovery codec evidence passed 2/2 with 133 skipped.
- Both timing-based removal-gate tests passed before and after conversion (2/2,
  133 skipped). They now use explicit pre-read/post-read storage barriers and a
  deterministic microtask pending assertion; neither relies on 25 ms elapsed
  time to establish absence of claim CAS.
- Public cancellation failure/retry wording, SF-008 evidence, wave 5
  provenance, and current tenant anchors are updated. Status is wave 5 fixes
  implemented; coordinator verification, canonical review, dedicated security
  re-review, and T-0041 closure remain pending.
- The final five-finding focused set passed 5/5 with 130 skipped. The broader
  lifecycle set encountered sandbox-only loopback `EPERM` after 41 passes, then
  passed natively with 42/42 and 93 skipped. Final native affected-file
  verification passed 135/135.
- Generated/tooling typecheck and docs checks exited 0; docs verified 25 Proto
  checksums and public counts `100/28/205/19/17/3`. Focused ESLint and Prettier
  exit 0 after two test-fixture-only lint corrections. Coordinator
  verification and both review gates remain pending.
- Final status/provenance/anchor/residual scans matched the documented scope;
  public-export, retired-race, generated, manifest/lock, and package-root scans
  found no drift. `git diff --check` exited 0. This remains implementer evidence,
  not canonical or security acceptance.

## Wave 4 Coordinator Retry RED

- Existing implementer `019f62d7-31cc-7c13-a0b1-61d25dff9e23`, actual
  immutable `gpt-5.6-terra` / medium, reproduced the finding before production
  edits. The focused command exited 1 with 1 failed/130 skipped because a
  distinct subscription was admitted after exact `Internal` cancellation
  failure instead of preserving the owner reservation.

## Wave 4 Coordinator Retry Fix Result

- Existing implementer `019f62d7-31cc-7c13-a0b1-61d25dff9e23`, actual
  immutable `gpt-5.6-terra` / medium, retained known-local owner/reservation
  state through failed settlement and releases it only after successful exact
  cancellation. No subagents or Git-state mutation were used.
- Original focused GREEN passed 1/1 (130 skipped); the three-path invariant set
  passed 3/3 (130 skipped); the relevant lifecycle set passed 35/35 (98
  skipped); and full native SpineServices passed 133/133.
- Coordinator re-verification and canonical/dedicated security review remain
  pending. This record does not mark T-0041 complete.

## Wave 4 Pre-Review Lint Fix Result

- Existing implementer `019f62d7-31cc-7c13-a0b1-61d25dff9e23`, actual
  immutable `gpt-5.6-terra` / medium, completed the private two-constant cleanup
  without subagents or Git-state mutation.
- Both exact cancellation conflict tests passed before and after the refactor:
  2 passed/131 skipped. No behavior or public/documented contract changed.
- Coordinator verification and canonical/dedicated security review remain
  pending; T-0041 is not complete.
- Generated/tooling typecheck, focused ESLint/Prettier, exact-literal scan, final
  2-test rerun, and diff integrity are green. Only source and three durable logs
  changed.

## Wave 5 Coordinator Verification

- The coordinator accepts all five fixes after direct diff inspection. The
  ambiguous-write path no longer releases capacity before durable deletion is
  established; strict decoding binds canonical bytes and embedded ID before
  recovery mutation; both negative-CAS tests use deterministic gates; and the
  public/security documentation matches the implemented failure contract.
- Fresh native focused verification passed 5/5 with 130 skipped and fresh
  native full affected-file verification passed 135/135.
- Generated typecheck, docs generation/check, focused ESLint, ten-file
  Prettier, pre-review status/public-policy scans, and `git diff --check` all
  exited 0. No public root, manifest, lockfile, or generated tracked output
  changed.
- Freeze the fix endpoint in one commit, generate a literal-baseline/literal-
  endpoint package, and dispatch canonical wave 6. Dedicated security review
  remains pending; no completion disposition is recorded here.

## Canonical Review Wave 6 Assignment

- Immutable endpoint `113934d2`; package
  `.superpowers/sdd/review-39f2c6f7..113934d2.diff` from baseline `39f2c6f7`
  contains 29 commits and 439,772 bytes.
- Style/maintainability: existing `style_maintainability_reviewer`, explicit
  immutable `gpt-5.6-terra` / high; changed-code structure, deterministic test
  quality, duplication, and current code standards only.
- Documentation: existing `documentation_reviewer`, explicit immutable
  `gpt-5.6-luna` / medium; current public behavior, user workflow, exclusions,
  threat/security claims, and source-anchor accuracy only.
- TypeScript/API docs: existing `typescript_api_docs_reviewer`, explicit
  immutable `gpt-5.6-terra` / high; public/export/type/runtime contract,
  compatibility, Protobuf, TypeDoc, and internal leakage only.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicit immutable `gpt-5.6-terra` / high; bounds, persistence ambiguity,
  cancellation/recovery concurrency, cleanup, lifecycle, and deterministic
  evidence only.
- All prompts require ledger inspection, read-only/no subagents/no Git
  mutation, concrete file/line findings, and the superseded-history exclusion.
  Aggregate the complete wave before fixes; dedicated security review remains
  pending.

## Canonical Review Wave 6 Result

- Runtime profile gate passed for all explicit dispatches. Style agent
  `019f63cf-f179-7bd1-8c33-30ddeba05379` was immutable Terra High; docs agent
  `019f63cf-eaa8-7132-b83a-929936409252` was immutable Luna Medium; API agent
  `019f63cf-ee39-7672-b539-3405844fae99` and reliability agent
  `019f63d2-24ea-7570-b5e3-50ba4e2a1a95` were immutable Terra High. Every
  reviewer is closed.
- Style/maintainability: P1 combined timer-registration plus durable-cleanup
  failure can leave an unreturned closed record with no cleanup path and a
  permanently held reservation.
- Documentation: Low stale threat-model provenance omits committed endpoint
  `113934d2`; all requested public cancellation/setup/codec wording and anchors
  otherwise match.
- TypeScript/API: Medium stale query-limit wording in API and architecture docs;
  absent/zero wire limits use the implicit 1,000-row cap, while only positive
  limits require ordering. Public exports, Protobuf/type URLs, strict decoder,
  and internal boundaries otherwise remain coherent.
- Performance/reliability: clean after bounds, persistence, CAS ordering,
  cleanup, malformed-row, and transport-lifecycle tracing.
- Return the complete three-item batch to one fresh existing `implementer`,
  explicit immutable Terra Medium, because the prior context is closed.
  Require deterministic TDD for the P1, focused/full affected verification,
  exact docs/provenance correction, and fresh canonical re-review. Dedicated
  security review remains pending.

## Canonical Review Wave 6 Fix Evidence

- Existing implementer, explicit immutable `gpt-5.6-terra` / medium, resolved
  the complete batch in the assigned worktree with no subagents or Git mutation.
- The deterministic combined timer/persistence RED exited 1 with the expected
  timeout before a fallback existed. The identical GREEN exited 0 with 1
  passed/135 skipped. A private one-shot microtask now owns one exact
  cancellation attempt only when retained inactive-timer registration fails;
  it preserves the originating Subscribe error, keeps closed state inert and
  capacity-held until durable cancellation succeeds, and cannot spin.
- API/architecture query-limit wording now matches runtime behavior, and threat
  model provenance records `113934d2` while canonical and dedicated security
  review remain pending. `typecheck:generated`, `docs:check`, focused ESLint,
  exact-file Prettier, provenance/generated-output scans, and `git diff --check`
  are green. Full SpineServices verification requires coordinator native rerun:
  117 tests passed and 19 real-gRPC tests were sandbox-blocked at
  `listen EPERM: operation not permitted 127.0.0.1`.

## Wave 6 Coordinator Verification

- Coordinator inspection accepts the finite one-shot fallback, deterministic
  combined-failure evidence, exact query-limit wording, and immutable threat
  provenance correction.
- Fresh native focused verification passed 1/1 with 135 skipped; fresh native
  full affected verification passed 136/136. Generated/tooling typecheck,
  docs/API generation, focused ESLint, exact formatting, pre-review scans, and
  diff integrity all exited 0.
- Commit the accepted batch and generate a literal endpoint package for
  canonical Wave 7. Dedicated security review remains pending; no T-0041
  completion is claimed.

## Canonical Review Wave 7 Assignment

- Immutable endpoint `6f45be80`; package
  `.superpowers/sdd/review-39f2c6f7..6f45be80.diff` from baseline `39f2c6f7`
  contains 32 commits and 474,837 bytes.
- Style/maintainability: existing role, explicit immutable Terra High; private
  fallback structure and deterministic test quality.
- Documentation: existing role, explicit immutable Luna Medium; current public
  query/setup/cancel behavior, security provenance, anchors, and exclusions.
- TypeScript/API: existing role, explicit immutable Terra High; public/type/
  runtime contract, compatibility, exports, Protobuf, and TypeDoc boundaries.
- Performance/reliability: existing role, explicit immutable Terra High;
  one-shot cleanup ordering, capacity retention/release, persistence ambiguity,
  CAS concurrency, bounds, and no-spin evidence.
- All reviewers are read-only, inspect the ledger, use exact current package
  evidence, ignore superseded history unless currently claimed, and report
  concrete findings or clean. Aggregate the complete wave before fixes;
  dedicated security review remains pending.

## Canonical Review Wave 7 Result

- Immutable runtime evidence and explicit dispatch matched for every closed
  reviewer: style Terra High `019f63e2-6f10-7522-b963-afe45db0c852`, docs Luna
  Medium `019f63e2-6bf0-7b62-9bfb-933f733d1a98`, API Terra High
  `019f63e2-723b-76e0-887b-9fbca2ac27d1`, and reliability Terra High
  `019f63e4-1ac9-7213-917b-02076c8f6bee`.
- Style: P1 add bounded liveness and failed-fallback/no-repeat coverage.
- Documentation: Low update both security artifacts from stale endpoint/
  uncommitted wording to substantive endpoint `6f45be80`; all other current
  workflow, exclusion, and anchor claims are clean.
- TypeScript/API: clean across query-limit, public bounds, exports, Protobuf,
  internal states, and TypeDoc.
- Performance/reliability: P1 ambiguous claim CAS can persist an owner then
  discard its only local token; P1 the one-shot timerless fallback has no later
  path after transient failure; P1 `requestTimeoutMs=-1` can keep a sent request
  and `close()` pending indefinitely.
- The fallback style/reliability observations are one accepted contract,
  yielding four deduplicated items including provenance. Assign the existing
  requirements splitter, explicit immutable Sol High, for a read-only bounded
  correction design before one Terra Medium implementation batch. Dedicated
  security review remains pending.

## Wave 7 Requirements Split Result

- Splitter `019f63ea-f80b-7291-bf00-4f6f704b119b`, actual immutable Sol High,
  completed read-only and is closed.
- Claim CAS: one exact reconciliation read; adopt only the proposed claim,
  release only after exact prior inactive proves no commit, use existing
  lost/canceled outcomes for changed/absent state, and retain an explicit
  outcome-unknown owner/reservation when reconciliation cannot establish state.
- Failed setup: one private runner, two sequential exact cleanup attempts, no
  recursive queue/timer/repeat, success release, exhausted bounded inert
  retention. Add bounded success-after-first-failure and exhausted/no-third-
  attempt regressions.
- ZeroMQ: new D-0088, default 2,000, explicit request timeout integer range
  1..2,147,483,647, exact synchronous `TypeError` before I/O, boundary table,
  and sent-unanswered-request plus close liveness evidence. Do not change
  `receiveTimeoutMs` or add active cancellation.
- Provenance: both security artifacts identify `6f45be80` as substantive
  evidence. Assign one fresh existing implementer, explicit immutable Terra
  Medium, for the complete batch. All four canonical lanes rerun afterward;
  dedicated security review remains pending.
