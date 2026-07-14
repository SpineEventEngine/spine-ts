# T-0041 Review Log

Status: Security Round 1 fixes assigned

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
