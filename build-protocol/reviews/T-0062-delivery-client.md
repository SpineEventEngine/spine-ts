# T-0062 Review Record

Status: Accepted; all required lanes clean after correction and focused closure

## Scope

Public `@spine-ts/delivery-client`, its remote adapters, tests, documentation,
and minimum package/proto/server integration seams, compared with pushed
baseline `dee92556` and the accepted T-0062 packet.

## Canonical Concern Dispositions

| Concern                          | Status              | Reason                                                                                           |
| -------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| Style and maintainability        | Required; pending   | New public package and adapter boundaries.                                                       |
| Documentation completeness       | Required; pending   | New end-user configuration, lifecycle, errors, and reconciliation workflow.                      |
| TypeScript and API compatibility | Required; pending   | New public package, types, declarations, and stable generated-code boundary.                     |
| Performance and reliability      | Required; pending   | Retry safety, cancellation, bounded resources, channel ownership, and unknown mutation outcomes. |
| Final security                   | N/A for this packet | Deferred to T-0067 unless an earlier security-critical blocker is identified.                    |

## Mechanical Gate

- Independent canonical coverage passed 101 test files and 2,174 tests.
- Global branch coverage: 90.13% (6,804/7,549); delivery-client: 91.11%
  (410/450).
- Repository typecheck, lint, cleanup enforcement, formatting, focused real
  HTTP/2 gRPC integration, generated docs/API inventory, and diff hygiene passed
  in the recorded implementation slices. Full final verification will be rerun
  after review disposition/corrections.

## Completion Gap — Test Semantic Split and Coverage

- The confirmed mixed-concern test finding is resolved: the former 1,671-line
  `delivery-client.test.ts` was deleted after its 53 actual behavior blocks
  were moved (not copied) to five semantic suites, each below 700 lines, with
  one shared fixture module. The prior small smoke duplicates were replaced by
  their full owned behavior blocks.
- Test-only split defects (one default response import and copied unused
  imports) were corrected. Focused semantic/owned tests passed 57/57, focused
  real HTTP/2 gRPC passed 1/1 with approved loopback permission, and the server
  delivery-builder check passed 28/28. Tooling/client/server no-emit,
  generated lint/cleanup, docs/API, Prettier, and diff hygiene passed.
- Retained canonical coverage after the final behavior additions is global
  6,824/7,576 branches (90.0739%) and delivery-client 430/477 (90.1468%). No
  threshold, exclusion, or source configuration changed. This resolves the
  previously missing retained-lcov gate, with only a five-branch global margin.
- Runtime self-introspection remains unavailable. Accepted immutable configured
  metadata for this bounded completion owner is existing `implementer`,
  `gpt-5.6-terra` / `medium`; no visible fallback or mismatch occurred.

## Review Wave Dispatch Metadata

All reviews are read-only, compare pushed baseline `dee92556`, use an existing
configured project role, and may not spawn children or edit files. Expected
model/reasoning fields are explicit in each dispatch:

| Concern                          | Existing role                      | Expected profile                | Status                                 |
| -------------------------------- | ---------------------------------- | ------------------------------- | -------------------------------------- |
| Style and maintainability        | `style_maintainability_reviewer`   | `gpt-5.6-terra` / `high`        | Complete; 3 P2 findings                |
| Documentation completeness       | `documentation_reviewer`           | fixed `gpt-5.6-luna` / `medium` | Complete; 2 P2 findings                |
| TypeScript and API compatibility | `typescript_api_docs_reviewer`     | `gpt-5.6-terra` / `high`        | Dispatched after slot became available |
| Performance and reliability      | `performance_reliability_reviewer` | `gpt-5.6-terra` / `high`        | Dispatched after slot became available |

Runtime metadata will be recorded before accepting each result. If the surface
does not expose self-introspection, the immutable configured role/profile and
that limitation will be recorded honestly; redispatch occurs only for an
omitted field, wrong role, visible mismatch, or actual inherited fallback.

The dispatch surface rejected a direct `gpt-5.6-luna` model override because
`documentation_reviewer` is an immutable role already fixed to
`gpt-5.6-luna` / `medium`. The expected role/profile remains explicit in the
assignment text and table; the fixed role was dispatched without an unsupported
override. This surface limitation is recorded rather than misreporting an
explicit tool field.

## Completed Lane Metadata And Findings

### Style and maintainability

Runtime self-introspection was unavailable. Accepted immutable configured
metadata: existing `style_maintainability_reviewer`, `gpt-5.6-terra` / `high`,
with no visible fallback.

Confirmed P2 findings:

1. `remote-adapters.ts` duplicates codec-owned page-size and shard-snapshot
   helpers, creating drift risk.
2. `delivery-client.test.ts` is a 1,618-line mixed-concern suite spanning the
   client, codec, stream, adapters, and builder; split by semantic ownership.
3. `IMPLEMENTATION_REPORT.md` retains obsolete claims that adapters are pending
   and the port contract remains blocked.

### Documentation completeness

Runtime self-introspection was unavailable. Accepted immutable configured
metadata: existing `documentation_reviewer`, fixed `gpt-5.6-luna` / `medium`,
with no visible fallback.

Confirmed P2 findings:

1. Package README omits that decoded wire payloads are restricted to frozen
   Command/Event envelopes and other oneofs raise `DeliveryProtocolError`.
2. Package README omits that `connectTo()` accepts only an absolute HTTP(S)
   origin with pathname `/`, and custom routing requires `usingTransport()`.

### TypeScript and API compatibility

Runtime self-introspection was unavailable. Accepted immutable configured
metadata: existing `typescript_api_docs_reviewer`, `gpt-5.6-terra` / `high`,
with no visible fallback.

Confirmed findings:

1. P1: Admin observations lack worker/session identity, so an observation cannot
   unconditionally clear unknown pickup/release quarantine; doing so can permit
   a later release of another worker's shard.
2. P2: public `DeliveryClient.validate()` leaks through declarations despite
   being adapter-internal and marked only with `@internal` prose.
3. P2: advertised immutable snapshots are shallow; mutable `Date` and nested
   `Uint8Array` values can alter observed/exact-snapshot data.
4. P2: server delivery-port members and adapter reconciliation lack critical
   TypeDoc, and README omits nonrenewable remote fencing and the absence of
   worker-conditional release.

### Performance and reliability

Runtime self-introspection was unavailable. Accepted immutable configured
metadata: existing `performance_reliability_reviewer`, `gpt-5.6-terra` /
`high`, with no visible fallback. Its independent focused run passed 81/81.

Confirmed findings:

1. P1: bounded unfiltered wire pages are status-filtered locally and a raw-page
   cursor index is applied to the filtered array, allowing skipped or permanently
   starved pending messages.
2. P1: unknown-removal quarantine is an unbounded in-memory map holding full
   messages and is lost across adapter/process restart, permitting callback
   replay if the remote row remains.
3. P1: read-side validation errors are retried and eventually expose raw remote
   `ConnectError` diagnostics instead of a sanitized non-retryable protocol error.
4. P2: the advertised 4 MiB RPC ceiling is not enforced across every unary
   request/response family when a supplied transport is used.

## Consolidated Correction Preparation

All four lanes are collected; no correction was made early. One demonstrated
architecture block requires the existing requirements-splitter before the
single implementation batch: restart-safe quarantine needs a bounded durable
state seam that the frozen wire and an in-memory adapter cannot provide alone,
and the solution must not overengineer or silently weaken the no-replay
contract. The splitter also resolves lossless status-filtered paging within the
frozen timestamp-only cursor limitation.

- Existing role: `requirements_splitter`.
- Explicit expected profile: `gpt-5.6-sol` / `high`.
- Read-only ownership: the two P1 contract resolutions and acceptance-test
  shape; no edits, children, commits, pushes, or merges.
- Runtime metadata or the unavailable-introspection limitation will be recorded
  before accepting the resolution.

## Architecture Resolution

Runtime self-introspection was unavailable. Accepted immutable configured
metadata: existing `requirements_splitter`, `gpt-5.6-sol` / `high`, with no
visible fallback. No frozen Protobuf change or human blocker remains.

1. `RemoteInbox` must require a caller-owned durable, capacity-bounded
   `RemovalQuarantine`; no in-memory default may imply restart safety. Persist
   compact exact ID/phase/SHA-256 fingerprint records before callback admission
   and before removal. `REMOVING` recovery reconciles/retries removal without
   callback; ambiguous recovered `ADMITTED` remains fail-closed for operator
   resolution. Store capacity/conflict/availability failures are sanitized
   `DeliveryQuarantineError` values and perform no callback/removal.
2. Status-filtered reads scan raw pages, slice exact raw continuations before
   filtering, and stop only at the requested match count or proven short-page
   exhaustion. Missing/non-progressing cursors, full-page final timestamp ties,
   or the `1000 + localLimit` raw-row budget fail closed with
   `DeliveryPagingError`.
3. Admin `PICKED` never clears unknown shard quarantine. Valid `NOT_PICKED`
   invalidates every stale local session before clearing quarantine for a fresh
   pickup. Stale session release performs zero RPC. The frozen wire limitation
   is documented.

## Consolidated Correction Dispatch

- Existing role: `implementer`.
- Explicit expected profile: `gpt-5.6-terra` / `medium`.
- Ownership: all confirmed review corrections in `packages/delivery-client`,
  minimum server delivery-port TypeDoc, T-0062 records, and exact API inventory;
  one writer owns the full batch. It may not commit, push, merge, install,
  weaken gates, touch unrelated files, or spawn children.
- Required corrections: implement all three resolved invariants; sanitize and
  correctly classify read RPC errors; enforce byte/count bounds on every unary
  family; remove the public validation leak; make returned snapshots genuinely
  defensive/immutable at public boundaries; deduplicate codec/adapter helpers;
  split the mixed-concern test monolith; correct stale implementation records;
  and complete README/TypeDoc lifecycle, URL, payload, fencing, and release
  limitations.
- Required evidence: RED/GREEN for every behavior defect; focused delivery and
  real gRPC tests; declarations/API inventory; client/server type/build; lint,
  formatting, diff hygiene, retained coverage at or above 90%; no threshold or
  exclusion changes. Runtime metadata or its honest limitation must be recorded
  before acceptance.

## Consolidated Correction Result And Completion Redispatch

The existing `implementer` completed the core behavior/API/docs corrections.
Reported green evidence: 56 focused tests, real HTTP/2 gRPC 1/1, client/server
no-emit checks, exact TypeDoc/API inventory with 23 delivery-client exports,
lint/build/cleanup, Prettier, and diff hygiene. Runtime self-introspection was
unavailable; immutable configured metadata was `implementer`,
`gpt-5.6-terra` / `medium`, with no visible mismatch.

Acceptance is withheld because two confirmed review items and one gate remain:

1. The 1,600-line mixed-concern test monolith was not split by semantic module.
2. Defensive deep immutability of public Date/byte/nested snapshots was not
   independently completed with mutation regressions.
3. The coverage invocation did not preserve inspectable retained lcov evidence.

A fresh existing `implementer` owns only those exact completion gaps, import-only
test/shared-fixture adjustments, resulting API inventory/docs if the immutable
shape changes, and T-0062 records. Explicit expected profile is
`gpt-5.6-terra` / `medium`. It may not commit, push, merge, install, weaken
gates, touch unrelated files, or spawn children. Required evidence is semantic
test modules, deep-mutation RED/GREEN, focused and real-gRPC behavior, type/lint/
format/diff, and retained global branch coverage at or above 90%.

The first completion owner established deep-immutability RED/GREEN, detached
payload bytes, immutable date behavior, green `typecheck:tooling`, and 63/63
non-network tests, but twice failed to materially move existing test ownership:
the mixed-concern file grew to 1,667 lines. That result is not accepted and the
ineffective turn was stopped.

A fresh existing `implementer` is redispatched solely for the mechanical,
behavior-preserving semantic move plus final coverage evidence. Explicit
expected profile is `gpt-5.6-terra` / `medium`. Ownership is limited to
delivery-client tests/shared fixtures, import-only corrections, and T-0062
records; production code is frozen except for a directly exposed split
regression. It may not commit, push, merge, install, weaken gates, touch
unrelated files, or spawn children. Existing describe blocks must be moved, not
duplicated; no mixed-concern file may remain above 700 lines.

## Correction Completion And Independent Verification

- The original 1,671-line test monolith is deleted. All 53 behavior blocks are
  moved into semantic suites of 577, 49, 401, 376, and 185 lines with a
  195-line shared fixture; no mixed-concern suite exceeds 700 lines.
- Defensive immutable Date and detached-byte regressions pass. The core review
  corrections and required docs/API records remain in place.
- Independent full `pnpm --config.verify-deps-before-run=false verify` passed:
  105 test files, 2,178 tests, global branches 6,824/7,576 (90.07%), exact 23
  delivery-client exports, typecheck, lint, cleanup, formatting, generated/proto
  drift, docs, and release readiness.
- Completion-owner runtime self-introspection was unavailable. Accepted
  immutable configured metadata: existing `implementer`, `gpt-5.6-terra` /
  `medium`, with no visible mismatch.

## Affected-Lane Re-review Dispatch

All four lanes are substantively affected by behavior/API/test/docs corrections.
Each review is read-only against baseline `dee92556`, may not edit or spawn
children, and has the expected profile explicitly set or, for the immutable
documentation role, explicitly recorded:

| Concern                 | Existing role                      | Expected profile                | Status                         |
| ----------------------- | ---------------------------------- | ------------------------------- | ------------------------------ |
| Style/maintainability   | `style_maintainability_reviewer`   | `gpt-5.6-terra` / `high`        | Dispatched                     |
| TypeScript/API          | `typescript_api_docs_reviewer`     | `gpt-5.6-terra` / `high`        | Dispatched                     |
| Performance/reliability | `performance_reliability_reviewer` | `gpt-5.6-terra` / `high`        | Dispatched                     |
| Documentation           | `documentation_reviewer`           | fixed `gpt-5.6-luna` / `medium` | Queued for next execution slot |

Runtime metadata or the immutable configured profile plus introspection
limitation will be recorded before accepting each result.

## Affected-Lane Re-review Results

All four lanes completed. Runtime self-introspection was unavailable in every
lane; accepted immutable configured profiles were style/API/reliability
reviewers on `gpt-5.6-terra` / `high` and documentation reviewer on fixed
`gpt-5.6-luna` / `medium`, with no visible mismatch.

Resolved and clean: helper deduplication, semantic test ownership, removed
public validation seam, new quarantine exports/API inventory, no generated RPC
leaks, prior README URL/payload/quarantine/paging/fencing guidance, and server
port TypeDoc.

Final confirmed batch:

1. P1: builder permits mismatched local/remote inbox and registry session kinds,
   producing a legal configuration that silently skips delivery; fail fast or
   couple the ports.
2. P1: concurrent release of the same remote session can dispatch twice and the
   second non-worker-conditional RPC can release a later owner; invalidate or
   serialize before the first await and retain quarantine on ambiguity.
3. P2: public results are detached but caller-mutable `Date`/byte snapshots;
   runtime/docs must not claim they are themselves immutable, while mutation
   must never affect internal/exact-snapshot state.
4. P2: enforce response collection counts for pages, Admin snapshots, and
   released-expired session arrays in addition to byte ceilings.
5. P2: bound pending observation `next()` waiters, not only buffered values.
6. P2: delete empty per-shard session-map entries after release/invalidation.
7. P2: add the critical public `RemoteWorkRegistry.reconcile()` TypeDoc.
8. P2: remove/archive obsolete current blocker claims and deleted-file inventory
   in `IMPLEMENTATION_REPORT.md`.
9. P2: make the README quarantine integration snippet self-contained or clearly
   label/provide its durable-store placeholder.

## Final Narrow Correction Dispatch

- Existing role: `implementer`.
- Explicit expected profile: `gpt-5.6-terra` / `medium`.
- Ownership: only files needed for the nine findings, focused tests/docs/API
  inventory/records. One writer; no children, commits, pushes, merges, installs,
  unrelated edits, or gate weakening.
- Prefer honest detached caller-mutable snapshot wording over an overengineered
  JavaScript immutability facade, while proving mutations cannot affect internal
  state. No deprecation cycle is required.
- Required evidence: RED/GREEN for behavior findings, focused and real-gRPC
  suites, type/API/docs/lint/format/diff, retained coverage >=90%, then targeted
  affected-lane re-review and final full verification.

## Final Closure Re-review And Exact Patch Dispatch

Independent canonical coverage after the narrow corrections passed 105 test
files and 2,185 tests with 6,837/7,593 branches (90.04%). Focused API and
reliability closure reviews used their existing immutable configured
`gpt-5.6-terra` / `high` profiles; runtime introspection remained unavailable.

Resolved: response collection counts, bounded observation waiters, concurrent
double-release prevention, empty shard-map cleanup, required `sessionKind`
members, reconcile TypeDoc, exact 23-export inventory, and generated-type
encapsulation.

Exact remaining findings:

1. P1: compare resolved builder ports including defaults; one-sided EXCLUSIVE
   custom ports still pair with a default LEASED counterpart and silently skip.
2. P1: quarantine the shard before release RPC dispatch. The current gap permits
   an overlapping pickup whose valid session is then quarantined when the prior
   release response becomes unknown.
3. P2: replace three stale public “immutable” TypeDoc claims with accurate
   detached caller-mutable wording.

A fresh existing `implementer` owns only these exact fixes, focused regressions,
and T-0062 records. Expected profile is explicitly `gpt-5.6-terra` / `medium`.
No children, commits, pushes, merges, installs, unrelated edits, or gate
weakening. Required evidence: both one-sided builder RED/GREEN, controlled
release/pickup/lost-response RED/GREEN, public TypeDoc check, focused/type/lint/
format/diff, retained coverage, then final API/reliability closure review.

## Exact Patch Closure Results And Final State-Machine Dispatch

- Independent coverage after the exact patch passed 105 files, 2,187 tests,
  and 6,835/7,590 branches (90.05%).
- API closure is clean: resolved/default pairing, mandatory markers, detached
  wording, exact 23-export inventory, and no generated leaks.
- Documentation closure is clean: report, durable-store placeholder, snapshot
  wording, reconcile/session-kind docs.
- Reliability confirms all prior findings clean except one final P1: the same
  shard quarantine bit represents both in-flight release and reconcilable
  unknown outcome. `reconcile(NOT_PICKED)` can clear it while release is still
  awaiting, permit pickup, then the delayed non-worker-conditional release can
  release the new owner.

A fresh existing `implementer` owns only a release-state distinction and its
controlled interleaving regression, import-only test changes, and records.
Explicit expected profile is `gpt-5.6-terra` / `medium`. `reconcile()` must
never clear in-flight release state; only a settled unknown outcome may be
reconciled. No children, commits, pushes, merges, installs, unrelated edits, or
gate weakening. Required focused/type/lint/format/diff/coverage evidence and one
final reliability closure check.

## Final Acceptance

- Style/maintainability: clean after semantic test split, helper deduplication,
  coherent implementation report, and final state-machine inspection.
- Documentation: clean after URL/payload/quarantine/paging/fencing/session-kind
  guidance, runnable durable-store placeholder, truthful snapshot wording, and
  current implementation report.
- TypeScript/API: clean after required session-kind markers, resolved/default
  builder pairing, removed validation leak, detached snapshot contract, exact
  23-export inventory, and generated-boundary check.
- Performance/reliability: clean after lossless/fail-closed paging, durable
  bounded quarantine, read error sanitization, full byte/count bounds, bounded
  observation waiters, safe release states, and the controlled held/lost-release
  interleaving regression. Final focused closure passed 23 tests.
- Final independent full verification passed 105 files, 2,189 tests, and global
  branch coverage 6,837/7,592 (90.05%), plus all generated/docs/release gates.

## Final Release-State Correction Result

- Assignment acceptance metadata: existing `implementer`, explicitly
  configured `gpt-5.6-terra` / `medium`. Runtime self-introspection is not
  exposed by this surface; no fallback or profile mismatch was visible.
- The controlled interleaving regression is GREEN: a `NOT_PICKED` observation
  during a held release cannot admit another pickup or dispatch its RPC.
  Successful settlement clears the guard; an unknown settlement retains a
  reconcilable quarantine until a subsequent valid `NOT_PICKED` observation.
- Focused remote adapter, registry, and Admin-observation tests passed 35/35.
  Client/registry/adapter validation subsequently passed 43/43, package
  no-emit TypeScript, generated lint/cleanup, assigned-file formatting, and
  diff hygiene. Canonical coverage is blocked only by sandbox listener/IPC
  policy and must be reproduced on the approved loopback-capable surface.
  The final reliability closure review remains pending.
