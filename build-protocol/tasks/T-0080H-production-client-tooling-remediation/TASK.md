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
