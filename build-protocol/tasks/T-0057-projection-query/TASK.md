# T-0057: Projection Query DSL And Server Execution

Status: Complete — committed, pushed, and represented on canonical `main`

## Objective

Complete the Projection-only typed Query DSL, compile it to the frozen
`spine.client.Query` contract, execute that contract through the server's
Query service, and make in-memory, MySQL, and Datastore storage conform to the
single normalized policy introduced by T-0056.

## Classification

High-risk. This packet changes a public generic API, frozen-wire compilation,
server request validation, storage semantics, SQL generation, Datastore
pushdown/materialization, deterministic ordering, and result version/mask
behavior. T-0052 already completed and reviewed the required architecture and
public-contract split; no redundant requirements-splitter dispatch is needed
unless implementation reveals a genuine conflict with that accepted design.

## Human Requirements Ledger

- Provide JVM behavioral/conceptual parity through idiomatic, minimal
  TypeScript; do not copy JVM internals or over-engineer.
- Query high-level APIs can target Projections only in Wave 1. Aggregate and
  Process Manager factories wait for Wave 2 after recent state/event history.
- There is no deprecation cycle and no compatibility alias requirement.
- T-0056's normalized plan and provider-capability validation are the sole
  policy boundary. Adapters may implement mechanics but may not invent query
  policy.
- The existing MySQL and Datastore application-storage adapters are in scope;
  Redis/Hazelcast delivery storage and other delivery-server modes remain out
  of scope.
- Node.js is the only supported runtime.
- Public documentation must include actual, compilable snippets and explicit
  Projection-only/adaptor limitations.

## Ownership

- `packages/client`: typed Query DSL, generic column/value/operator
  relationships, validation, and deterministic Protobuf compilation;
- `packages/server`: Query service target/criterion validation, frozen-wire
  conversion, normalized-plan execution, response states and versions;
- `packages/storage`: full in-memory normalized-plan evaluation and shared
  adapter conformance contracts;
- `packages/storage-rdbms`: parameterized MySQL query compilation/execution;
- `packages/storage-datastore`: legal pushdown plus strictly finite
  materialization/post-filter behavior and documented overflow;
- focused generated/golden, truth-table, storage-contract, network integration,
  compile-negative, documentation, and task/review evidence.

## Acceptance Criteria

1. The typed public DSL supports IDs, nested `ALL`/`EITHER`, `=`, `>`,
   `<`, `>=`, `<=`, masks, repeated ordering, and a positive limit.
2. Schema/column/value/operator relationships are enforced at compile time and
   runtime; unknown columns, wrong value/operator pairs, invalid masks, and
   malformed authored wire messages fail with stable actionable errors.
3. A limit requires at least one ordering. Repeated ordering preserves caller
   order and appends a stable entity-ID tie-breaker. Null/missing value ordering
   follows the frozen contract consistently in every adapter.
4. DSL output round-trips through the frozen `spine.client.Query` Protobuf
   descriptors without handwritten alternate wire types.
5. High-level construction rejects Aggregate and Process Manager targets.
   Existing low-level ID paths remain available and are not promoted as public
   high-level parity.
6. Server validation converts exactly once to T-0056's normalized plan and
   invokes shared capability validation before storage work. Responses contain
   matching states, requested masks, and record versions.
7. In-memory storage evaluates the complete normalized predicate/order/mask/
   limit plan with deterministic results.
8. MySQL uses parameterized SQL for supported normalized operations, preserves
   canonical value encoding and tenant isolation, and never interpolates
   authored values or identifiers.
9. Datastore pushes down only legal operations, applies the accepted strictly
   finite candidate materialization/post-filter path, and raises its documented
   overflow error before returning a truncated semantic result.
10. A shared storage conformance suite proves equivalent supported results
    across in-memory, MySQL, and Datastore; unsupported capabilities reject
    before provider access.
11. Real Connect/gRPC QueryService integration proves nested filtering,
    repeated ordering, masks, limits, state/version responses, and protocol
    errors.
12. The user guide and package READMEs document construction, nesting, masks,
    ordering, limits, results, adapter behavior, and the Wave 2
    Aggregate/Process Manager deferral with compile-covered snippets.

## TDD And Verification

- Establish compile-time and runtime RED fixtures before implementation.
- Add golden Protobuf descriptor/round-trip tests, predicate truth tables,
  provider conformance tests, parameterization/pushdown probes, and real network
  integration.
- Run deterministic focused generation/build/typecheck/lint/cleanup/format/
  docs/release/generated-clean gates before review.
- All four specialist lanes are required: TypeScript/API, documentation,
  style/maintainability, and performance/reliability. Security is N/A only if
  review confirms no new trust boundary beyond the already validated
  QueryService input; otherwise reopen the final security concern explicitly.
- Run the full repository verification gate before commit and again after merge.

## Assignment Gate

- Existing role: `implementer`.
- One production owner for the complete packet; no child spawning.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Both fields must be explicit in dispatch.
- Runtime self-introspection is recorded if available; otherwise record the
  immutable configured role/profile and limitation honestly.
- The implementer may not commit, push, merge, or alter unrelated files.

## Baseline

- Branch/worktree: `task/T-0057-projection-query` /
  `.worktrees/T-0057-projection-query`.
- Base: pushed `main` at `eb810f48`.
- T-0056 provides typed Projection columns plus the canonical normalized query
  plan/capability validator. Current QueryService execution remains equality-
  only and non-nested; storage providers still consume their older low-level
  record query forms.
