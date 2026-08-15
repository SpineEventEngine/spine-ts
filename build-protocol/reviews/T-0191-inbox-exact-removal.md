# T-0191 Review Record

Status: ACCEPTED

Planned lanes: TypeScript/API (optional source compatibility), style/
maintainability (one cleanup seam), performance/reliability (atomic fencing,
bounded provider behavior), and documentation (accurate TSDoc). Final security
is deferred to T-0194; exact destructive fencing and tenant/group containment
are retained as required inputs.

## Convergence Packet

- TypeScript/API: applicable because `DeliveryInbox.removeDelivered` is an
  optional public structural-port member. The current patch changes only its
  TSDoc summary; source compatibility and behavior are frozen.
- Style/maintainability: applicable to the narrow internal cleanup capability
  and three provider coordinators. TSDoc enforcement is clean.
- Performance/reliability: applicable to existing provider-owned atomic
  fencing and bounded deletion. No runtime code changed in this convergence
  pass; review input is the frozen implementation plus 97.39% changed-line and
  92.00% changed-branch current-source coverage.
- Documentation: applicable. All 42 reported TSDoc findings are resolved by
  `node scripts/check-tsdoc.mjs` without future claims or reader documentation.
- Security: deferred to the Wave closure gate. The review input remains exact
  destructive fencing plus tenant/group containment; no closure result is
  claimed here.
- The canonical non-live selection has 40 deterministic passes and two
  expected service-gated skips. Separate serialized direct-source runs passed
  the exact-removal matrix against MySQL 8.4.10 and the Datastore emulator;
  those provider results stand separately from the skipped non-live cases.
- Final profile disposition: the no-coverage profile passes its build, tooling,
  cleanup, and TSDoc gates but stops at seven in-scope T-0191/T-0192
  malformed/missing provider/test headers. Exact template correction and a
  captured canonical rerun are pending; no runtime repair is indicated.
- Correction disposition: all seven headers now match the canonical 2026
  template. A one-line Prettier-only change in the changed shard-registry slice
  resolves the subsequent shared format gate; a final captured profile is
  pending.
- Final profile disposition: the exact six-path no-coverage profile passed all
  shared gates and reported 40 passes plus two expected provider skips. This
  record is ready for the applicable TypeScript/API, style, performance/
  reliability, documentation, and deferred Wave-security lanes.

## Review Dispatch

- Frozen endpoint: `fcb5e4ab` plus this evidence-only correction.
- TypeScript/API: existing `typescript_api_docs_reviewer`, explicitly
  configured `gpt-5.6-terra` / high, read-only, bounded to public/source
  compatibility and API documentation.
- Style/maintainability: existing `style_maintainability_reviewer`, explicitly
  configured `gpt-5.6-terra` / high, read-only, bounded to the changed Inbox
  cleanup seam and provider implementations.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicitly configured `gpt-5.6-terra` / high, read-only, bounded to atomic
  fencing, lifecycle, persistence, and bounded-resource behavior.
- Documentation: existing `documentation_reviewer`, explicitly configured
  `gpt-5.6-luna` / medium, read-only, bounded to current-behavior TSDoc and task
  claims. Final security remains deferred to T-0194.
- Subagents may not spawn subagents. Runtime telemetry is unavailable on this
  execution surface; the immutable configured roles and profiles above are the
  acceptance record.

## Final Correction Disposition

- Supersedes the earlier option-only deadline evidence: `timeoutMs` is now an
  admission-relative non-negative budget, with an internal activity predicate
  rechecked after provider awaits and before destructive work.
- Deterministic MySQL and Datastore seams prove a positive budget that expires
  while work is blocked prevents removal; cancellation remains cooperative.
- Serialized live MySQL and Datastore two-handle runs each asserted native
  durable count `1` after stale-owner refusal and `0` after current-owner
  deletion. Both exclusive windows were released without broad cleanup.
- Canonical six-path `verify:task -- --no-coverage` is green: 58 passes and
  four expected service-gated skips. The no-coverage profile is authoritative
  here because the changed-location LCOV trace is retained separately.
- Current exact diff-scoped LCOV against accepted T-0190 endpoint `3081dcc0`
  is 114/121 changed executable lines (94.21%) and 107/116 changed branches
  (92.24%). This supersedes every earlier coverage figure below.

## Historical First Review Result

- TypeScript/API and documentation confirmed one shared P2: the new public
  option contract promises cancellation/deadline propagation while direct
  `InboxStorage.removeDelivered()` discards the options.
- Performance/reliability confirmed the same defect at P1 because an in-flight
  provider deletion can outlive shard cancellation/deadline.
- Performance/reliability also confirmed that the live provider test does not
  yet prove independent handles/two-owner fencing or physical row counts.
- Style confirmed the task brief lacks its mandatory inherited
  Human-Imposed Requirements Ledger.
- One correction batch returns to the existing `implementer`, explicitly
  configured `gpt-5.6-terra` / medium, with no subagents. Runtime telemetry is
  unavailable; the configured role/profile is immutable and recorded.

## Correction Result

- Direct removal now enforces already-aborted and expired operations and passes
  operation controls into provider coordinators; deterministic timeout,
  cancellation, rollback, and close paths are exercised.
- Live MySQL 8.4.10 and Datastore-emulator cases pass with independently opened
  handles, ownership transfer, exact preservation/deletion, and direct durable
  row counts. Provider execution remains separate from coverage accounting.
- Both task briefs now contain their applicable inherited Human-Imposed
  Requirements Ledgers.
- The then-current diff-scoped LCOV was 105/109 changed executable lines and
  103/110 changed branches; the final correction disposition supersedes it.
- The orchestrator-captured six-path `verify:task -- --no-coverage` passed all
  shared, TypeDoc/API, generated-output, release-readiness, and focused-test
  gates: 56 passed and four expected service-gated skips.
- Historical re-review endpoint: `4392d8ef` plus its evidence-only record update. Reopen
  TypeScript/API, style/maintainability, performance/reliability, and
  documentation only; final security remains T-0194.

## Re-review Result

- TypeScript/API, style, performance/reliability, and documentation independently
  confirmed that a positive `timeoutMs` is forwarded unchanged and never
  becomes an admission-relative deadline; only the zero sentinel is enforced.
- Performance/reliability confirmed that the two-owner live test reads through
  the application abstraction rather than asserting provider-native durable row
  counts, so the record overstates that part of the proof.
- All other reopened concerns are clean: optionality and exports, protected-page
  progress, false-delete ownership stop, atomic fencing, narrow provider seam,
  ledgers, and rollback/close behavior.
- One final correction batch returns to the existing `implementer`, explicitly
  configured `gpt-5.6-terra` / medium, with no subagents and unavailable runtime
  telemetry. Re-review only deadline semantics and native row-count evidence.

## Final Re-review Result

- Documentation is clean, and performance/reliability independently verified
  the current 114/121 line and 107/116 branch figures.
- P1: MySQL checks activity before the awaited delete but not after it, so the
  coordinator can commit a deletion whose deadline expired during that await.
- P2: the Datastore factories and native-count helper use different fallback
  project IDs when `DATASTORE_PROJECT_ID` is absent.
- P2: the public non-negative safe-integer timeout promise lacks admission
  validation for negative, non-integer, `NaN`, and infinite values.
- P2: identical activity types/predicates are duplicated across memory, MySQL,
  and Datastore instead of being one internal correctness policy.
- One correction batch returns to the existing `implementer`, explicitly
  configured `gpt-5.6-terra` / medium, with no subagents and unavailable runtime
  telemetry. Re-review only these four corrections.

## Final Correction Acceptance Packet

- `timeoutMs` admission rejects negative, fractional, `NaN`, and infinite
  values; zero is expired and positive safe integers become one captured
  admission-relative deadline.
- `CleanupOperation` and `cleanupOperationActive()` now define the single
  package-internal policy reused by memory, MySQL, and Datastore. The cleanup
  manifest records why this provider-neutral standalone helper is necessary.
- MySQL rechecks activity after its awaited delete and throws the internal
  expiry sentinel so the coordinator rolls back rather than committing an
  expired deletion. Deterministic tests cover that exact interleaving.
- Live MySQL passed after the transaction correction with native count `1` to
  `0`. Live Datastore passed with `DATASTORE_PROJECT_ID` unset, proving both
  factories and native counts use the same fallback project and observe `1` to
  `0`. Both windows were released without broad cleanup.
- Current exact diff-scoped LCOV is 120/128 changed executable lines (93.75%)
  and 109/119 changed branches (91.60%). The orchestrator-captured canonical
  six-path no-coverage profile exited zero with 59 passes and four expected
  service-gated skips.
- Final narrow re-review endpoint: `2b4dd42f` plus this evidence-only update.
  Reopen TypeScript/API, style/maintainability, performance/reliability, and
  documentation only for the four accepted corrections.

## Final Acceptance Review Result

- Performance/reliability is clean and independently reproduced 59 focused
  passes plus 120/128 changed lines and 109/119 changed branches.
- TypeScript/API, style, and documentation found one shared P2: MySQL retained
  a local `CleanupOperation` declaration instead of importing the canonical
  internal type. MySQL now imports that type and the duplicate is removed.
- The previously omitted unset-project Datastore command/result is now durable
  in `build-protocol/work-logs/T-0191.md`; no provider rerun is inferred from a
  documentation-only change.
- Final affected-lane re-review is limited to the shared-type import and the
  corrected evidence provenance.
- Final micro re-review is clean in TypeScript/API, style/maintainability, and
  documentation. Performance/reliability remained clean and was not reopened
  by the type-only import/evidence correction. T-0191 is accepted at
  `315b6789`; final security remains a T-0194 Wave concern.
