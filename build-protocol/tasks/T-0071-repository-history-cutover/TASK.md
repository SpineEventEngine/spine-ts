# T-0071: Repository Cutover, Histories, and Dispatch Guard

Status: Complete

## Objective

Cut Aggregate, Projection, and Process Manager repositories over to the shared
latest-state/history storage foundation; remove Aggregate event reconstruction;
and implement the frozen state/event history and double-dispatch behavior from
the approved Wave 2 plan.

## Classification

High-risk. This task changes repository persistence, restart semantics,
batched durability ordering, public/protected TypeScript contracts, and
best-effort duplicate-dispatch behavior.

## Human-Imposed Requirements Ledger

- Preserve behavioral and conceptual Spine JVM parity with idiomatic,
  non-over-engineered TypeScript.
- No compatibility aliases or deprecation cycle are required.
- State history applies to every entity kind, is repository-configured, and
  defaults off. Its runtime switch exists but must be documented as not
  designed for routine runtime use.
- Aggregate event history is unconditional; Process Manager event history is
  opt-in and defaults off; Projection event history does not exist; rejection
  events are excluded.
- History reads are protected, asynchronous, immutable, newest first, and use
  the exact frozen signatures in the Wave 2 plan. History is not a remote API.
- The double-dispatch guard is opt-in, defaults to depth 100, and is the same
  bounded best-effort facility as Spine JVM, not cross-machine atomic
  deduplication.
- Remove Aggregate snapshots, event reconstruction/replay/tail loading,
  persistence-driven appliers, obsolete exports/errors, aliases, and tests.
- Change any API without migration compatibility when required.
- Preserve unrelated files and never modify `human-review-1-jul.md`.
- Push `origin` immediately after every commit.

## Ownership and Ordered Slices

One bounded implementation owner owns the overlapping repository/runtime paths
for all three slices. The owner may not spawn children, commit, push, or merge.

1. Aggregate storage reshape: shared current records, no reconstruction,
   diagnostic event journal, restart tests, examples/fixtures migration.
2. Projection/Process Manager current-state parity: `Stand` delegates to shared
   records with durable version/lifecycle while inbox replay and Projection
   catch-up remain intact.
3. Histories/guard: repository configuration and runtime switch, protected
   reads, maintenance types, exact durability ordering, caching, unconditional
   Aggregate and opt-in Process Manager event journals, and the double-dispatch
   guard/configuration checks.

## Acceptance Criteria

- No Aggregate snapshot/reconstruction/replay path, public export, alias,
  error, fixture, or test remains; Aggregate restart uses only the current
  record.
- All three entity kinds persist current state/version/lifecycle through the
  shared record seam; inbox replay and Projection catch-up are unchanged.
- Every successful logical store appends state history according to the exact
  immediate/batched non-atomic semantics, including intermediate batched
  states and failure boundaries.
- Protected history reads validate depth before storage, return fresh
  top-level-frozen clones/newest-first arrays, implement complete-version
  caching/short-read exhaustion/discontinuity clearing, and expose the exact
  maintenance declarations.
- Event history and rejection exclusion match the frozen per-kind policy.
- The double-dispatch guard validates configuration before side effects,
  observes same-instance/same-batch completed dispatches, and documents/tests
  its deliberate multi-machine and failure/retry limits.
- Positive/negative declaration fixtures prove the public/protected contracts.
- Focused repository/entity/example/provider-backed restart/failure tests,
  generated typecheck, API/docs, release checks, and full coverage pass.

## Assignment

- Existing role: `implementer`.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Both fields must be explicit in dispatch. Runtime self-introspection is
  recorded if exposed; otherwise the immutable configured profile and
  limitation are the metadata evidence.

## Review and Verification

Run deterministic mechanical checks after every slice. After all slices, run
one complete relevant review wave:

- style/maintainability: repository/runtime depth, obsolete-path removal,
  naming, cohesion, test layout;
- documentation: configuration, history reads/maintenance, durability, guard
  limitations, snippets;
- TypeScript/API: protected signatures, maintenance exports, declaration
  compatibility, obsolete export removal;
- performance/reliability: persistence ordering, restart, caching, concurrency,
  retries/failures, guard behavior.

Security is N/A here unless implementation introduces a new trust boundary;
the final security disposition remains a Wave 2 closure concern.
