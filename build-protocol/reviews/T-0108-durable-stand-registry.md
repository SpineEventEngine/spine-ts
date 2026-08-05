# T-0108 Review Record

Status: Review In Progress

## Baseline

- Baseline: `origin/main@7c5457d1`.
- Branch: `task/T-0108-durable-stand-registry`.

## Planned Concerns

- Style/maintainability: public contract depth, builder composition, and
  avoidance of Gateway-registry duplication.
- Documentation: beginner-facing registry configuration, persistence behavior,
  warnings, cleanup, and limitations.
- TypeScript/API: exported registry contract, builder method, configuration,
  declarations, TSDoc, and compatibility.
- Performance/reliability: atomic cross-node capacity, record/snapshot bounds,
  cleanup races, restart recovery, provider conformance, and close ordering.
- Security: N/A unless the implementation adds a new trust boundary or
  unbounded/unvalidated stored input.

Reviewer assignments will be recorded only after deterministic preflight at a
clean, pushed endpoint. Every dispatch will use the existing immutable role and
the protocol-prescribed explicit model/reasoning profile.

## Deterministic Preflight

At pushed endpoint `bd2e4f2d`, `verify:task --no-coverage` passed every
deterministic gate and 104 focused registry/context/environment tests. The
coverage form also passed all gates and 104 tests but measured entire large
shared source files at 68.22% lines, so it did not satisfy the global 90%
threshold. This is not used as acceptance evidence; final `verify:release`
will enforce repository-wide coverage after review convergence.

## Review Assignments

- Style/maintainability: existing `style_maintainability_reviewer`, explicit
  `gpt-5.6-terra` / `high`.
- Documentation: existing `documentation_reviewer`, immutable configured
  `gpt-5.6-luna` / `medium`. The dispatch surface does not expose Luna as a
  manual model override, so the immutable role profile plus the explicit
  assignment text is the metadata evidence.
- TypeScript/API: existing `typescript_api_docs_reviewer`, explicit
  `gpt-5.6-terra` / `high`.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicit `gpt-5.6-terra` / `high`.
- Security: N/A. The task adds no credential, transport-trust, authorization,
  executable-input, or externally selected resource boundary; it stores the
  already bounded subscription Protobuf through the existing StorageFactory.

Runtime self-introspection is unavailable. Immutable configured roles and
explicit dispatch fields/text are accepted unless the surface exposes a
visible mismatch. Reviewers receive the pushed `origin/main@7c5457d1...bd2e4f2d`
diff and must return findings only for their canonical concern.

## Review Results

- Style/maintainability: two P2 findings. Remove completed-migration result
  aliases and centralize maximum-capacity and cleanup-page policy constants.
  Mechanical diff and standalone-function ledger are clean.
- Documentation: two P2 findings. Explain the atomic-CAS provider requirement
  and unsupported-provider failure; add a beginner lifecycle example and exact
  agent-facing create/activate/delete/get/snapshot/cleanup/error behavior.
- TypeScript/API: two P1 and two P2 findings. Remove the durable class's public
  `string` ID widening, validate negative revisions consistently, expose a
  deep-readonly subscription view, and document builder ownership/exclusion in
  public TSDoc.
- Performance/reliability: two P1 findings. A second live handle can treat an
  in-progress staged create/delete as abandoned, and the codec admits missing
  or blank topic IDs. Live MySQL and Datastore conformance is still unexecuted.
- Security: N/A disposition retained; no reviewer finding changes the stated
  trust-boundary analysis.

All reviewers used the recorded existing roles and configured profiles. Runtime
self-introspection remained unavailable and no visible model/profile mismatch
was exposed.

## Correction Architecture Assignment

The live-operation recovery P1 demonstrates a distributed correctness ambiguity
in the frozen two-row protocol. Before implementation, one bounded existing
`requirements_splitter` pass is assigned explicitly `gpt-5.6-sol` / `high` to
choose the smallest provider-neutral repair that preserves exact capacity,
physical deletion, restart recovery, one definition row per subscription plus
the separate control record, and the existing public contract. It must address
fencing/ownership under arbitrary pauses, not assume a staged operation is
abandoned merely because its row is absent, and state honestly if the existing
  serialized record cannot express the required invariant. It also specifies the
  minimal MySQL/Datastore conformance execution plan without building Spine JVM.

## Correction Architecture Resolution

The first Sol/high pass established that leases alone cannot fence an arbitrarily
paused owner, but did not return a final choice after bounded prompts and was
interrupted. A fresh, narrowly constrained existing `requirements_splitter`,
again explicit `gpt-5.6-sol` / `high`, selected a permanent generation fence as
the smaller complete design. Runtime self-introspection was unavailable for both
passes; immutable role/profile plus explicit dispatch is the metadata evidence.

`StandSubscriptionRecord` gains one internal 16-byte cryptographically random
generation. It remains constant for a definition lifetime and changes on every
recreation. Revision zero is reserved for an internal pre-admission row and is
never returned or counted; admitted rows retain revisions one and above. The
internal control format is versioned and has clean, staged, and committed states
with an operation token, kind, ID, generation, expected/resulting revision and
digests as required. Every definition-row CAS, including reservation discard,
must occur while holding the matching control operation. Control revision fences
ABA on the control slot; full-row CAS includes generation and fences same-ID,
byte-equivalent recreation on the definition slot.

Create first CASes a generation-bearing revision-zero reservation, then stages
its exact admission, promotes it to revision one, commits the count increment,
and clears control. Activate stages the exact generation/revision transition,
updates the row, commits unchanged count, and clears. Delete stages the exact
generation/revision, removes the row, commits the decrement, and clears. Helpers
complete the same transitions idempotently. Snapshots fence their bounded
`limit + 1` admitted-row query through control; revision-zero rows are excluded.
Cleanup serializes discard/delete and processes at most 25 with one extra row to
derive `more`. Unexpected generation, revision, digest, count, or control state
fails closed.

The implementation must directly test paused owners/helpers around every
transition; same-ID recreation ABA; create/discard ordering; result attribution;
capacity/count; staged/committed applied-then-thrown recovery; snapshot fencing;
revision-zero exclusion/cleanup; malformed generation/control; and quiescent
50-row shape. One reusable conformance suite must run against memory, local
MySQL, and the Datastore emulator. The earlier assumption that the existing
record needed no wire change is superseded by the demonstrated P1; this is an
internal record and no migration compatibility is required.

## Architecture Evidence

The existing `requirements_splitter`, explicit `gpt-5.6-sol` / `high`, completed
the single milestone-boundary pass. Runtime self-introspection was unavailable;
the immutable role/profile and explicit dispatch are accepted with no visible
mismatch. It inspected pinned Spine JVM Stand/registry/context sources
read-only and ran no JVM build.

The frozen design uses the public registry contract and immutable result types,
one Protobuf definition row per subscription, one internal CAS control row,
physical deletion, revision-aware finite cleanup, context ownership, custom
builder injection, and environment-owned production warning recorded in the
task. No human blocker, polling/listener responsibility, provider-specific
transaction SPI, or Gateway-registry reuse remains.
