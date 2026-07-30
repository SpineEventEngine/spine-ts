# T-0080H: Remediate remaining clients, testing, and Proto tooling

## Status

Planned.

## Parent And Dependencies

- Parent: T-0080.
- Depends on: T-0080E, T-0080F, and T-0080G.
- Stabilizes production APIs for every example-remediation slice.

## Objective

Complete authored API, name, and behavior-ownership remediation in
`client-node`, `delivery-client`, `testing`, and `proto-tools` after their
production dependencies stabilize.

## Classification

High-risk when public client/tooling contracts or generated-registry inputs
change; otherwise standard.

## Human-Imposed Requirements Ledger

- Public authored declarations/members have complete concise TSDoc.
- Callable summaries begin with a third-person verb; parameters and non-void
  results are documented.
- Authored names have no more than four semantic components.
- Standalone functions require cohesive ownership or exact necessity
  dispositions.
- Generated output remains reproducible and untracked.
- Client, delivery, testing, and Proto generation behavior remain equivalent.
- No generated edit and no Spine JVM build.

## Ownership

- `packages/client-node`, `packages/delivery-client`, `packages/testing`, and
  `packages/proto-tools`, with owned tests/docs/quality partitions.
- Exact downstream example/import repairs for changed exports, serialized before
  example semantic owners start.

## Acceptance Criteria

1. Owned authored source has zero TSDoc/name debt and exact standalone
   dispositions.
2. Public names/docs remain consistent with the stabilized server and
   client-web contracts.
3. Client request/subscription/cancellation, delivery-client protocol,
   runner-neutral testing, Proto config/manifest, handler analysis, and
   generation behavior remain equivalent.
4. Proto tooling keeps source/path confinement, reproducible package manifests,
   and ignored generated output.
5. Renames update generators, tests, docs, expected exports, and downstream
   example imports without retaining pre-release aliases solely for
   compatibility.
6. Focused client, delivery-client, testing, Proto-tools, and generation tests
   remain green.

## Exclusions

- No new client operation, delivery-server behavior, generator feature,
  manifest format, or test framework.
- No semantic example cleanup beyond exact reference repairs.
- No final all-repository regeneration or full coverage gate.

## Verification And Review

- Focused package/generator tests, generated build typecheck, package
  TypeDoc/export checks, lint/format, checker partitions, generated cleanliness,
  and `git diff --check`.
- Style/maintainability, documentation, and TypeScript/API-doc lanes are
  relevant.
- Performance/reliability is relevant for client/delivery lifecycle or
  generation resource behavior; otherwise each unaffected sub-area gets a
  concrete N/A.

## Milestone Planning Assignment

- Existing role: requirements splitter.
- Expected/configured model: `gpt-5.6-sol`.
- Expected/configured reasoning: high.
- Both fields are explicit. This milestone-boundary planning is required because
  the slice spans public client/delivery contracts, testing seams, and
  reproducible Proto generation.
- Initial exact partitions contain 440 TSDoc rows (client-node 71,
  delivery-client 228, Proto tools 108, testing 33), 169 standalone rows
  (32/61/61/15), and two delivery-client semantic names.
- The strengthened combined checker also reports 13 stale constructor/function
  rows in H-owned packages; planning must reconcile observed source rather than
  trust the pre-expansion ledger.
- The splitter is read-only and must return dependency-ordered, disjoint
  implementation batches, frozen behavior, focused gates, and review relevance.
  Runtime metadata or its limitation will be recorded before acceptance.

## Accepted Bounded Plan

- The existing requirements splitter completed under explicit
  `gpt-5.6-sol` / high. Runtime self-introspection was unavailable with no
  visible mismatch; no architectural blocker or human decision remains.
- Exact inventory correction: 415 TSDoc rows are active and 25 are stale
  ledger entries, totaling 440. All 169 standalone rows have cohesive owner
  paths; none is currently justified as a necessity.
- Three isolated write tracks may run in parallel without editing shared H
  ledgers, root API expectations, or shared guides:
  1. **H1 client-node:** `EntityQuery.eq/all/either/...`, define-only generated
     Entity-column ownership, packaged `EntityColumnGenerator`, exact
     query/cache/packing/bound semantics.
  2. **H2 delivery-client:** wire/types, client/observation lifecycle, then
     remote adapters, preserving read-only retries, exactly-once mutation
     attempts, ACK/reconnect/cancellation, paging, quarantine, and
     reconciliation.
  3. **H3 Proto tooling:** config/manifest/model graph, generation/claims/atomic
     publication, then CLI, preserving path/symlink confinement, graph/process
     bounds, liveness ownership, sibling staging, rollback, and bundled Buf.
- **H4 testing** follows H1 integration and keeps the public BlackBox API while
  moving internal seams/normalization/startup/cleanup into cohesive owners.
- **H5 reconciliation** serially updates exact imports/snippets/guides and all H
  ledgers to zero. Shared API-export expectations remain T-0080O-owned; H
  records the expected delta without editing that script.
- Package writers return resolved declaration identities instead of editing the
  three shared H debt JSON files. Generated output remains ignored and is never
  hand-edited.
- Each track runs its package type/build/tests plus lifecycle/generation
  acceptance and scoped quality gates. Final H runs combined four-package
  verification and one complete style, documentation, API, and reliability
  review wave. Repository-wide coverage remains T-0080O-owned.

## Parallel Implementation Assignments

- **H1 client-node:** existing implementer, branch
  `task/T-0080H1-client-node`, isolated worktree
  `.worktrees/T-0080H1-client-node`, explicitly configured
  `gpt-5.6-terra` / medium.
- **H2 delivery-client:** existing implementer, branch
  `task/T-0080H2-delivery-client`, isolated worktree
  `.worktrees/T-0080H2-delivery-client`, explicitly configured
  `gpt-5.6-terra` / medium.
- **H3 Proto tooling:** existing implementer, branch
  `task/T-0080H3-proto-tools`, isolated worktree
  `.worktrees/T-0080H3-proto-tools`, explicitly configured
  `gpt-5.6-terra` / medium.
- Every model/reasoning field is explicit. Runtime metadata or its limitation
  is required before acceptance. Writers may not spawn subagents, edit shared H
  ledgers/logs/guides/API expectations, commit, or push. They return exact
  resolved identities and complete package verification evidence.
