# T-0080D: Remediate production foundations

## Status

Planned.

## Parent And Dependencies

- Parent: T-0080.
- Depends on: T-0080A-C and T-0080I.
- Stabilizes foundations for T-0080E-H.

## Objective

Bring authored source in `proto`, `core`, `storage`, and `transport` into full
TSDoc, semantic-name, and standalone-function compliance while preserving
behavior and wire compatibility.

## Classification

High-risk when an exported TypeScript name or public signature changes;
otherwise standard. The classification may only promote during implementation.

## Human-Imposed Requirements Ledger

- Exported declarations/public members have complete concise TSDoc.
- Function/method summaries start with a third-person verb; parameters and
  non-void results are documented.
- Authored TypeScript names have no more than four semantic components.
- Standalone behavior moves to a cohesive type/named object unless a specific
  necessity disposition remains.
- Prefer Spine JVM concept names and small, flat APIs; do not create utility
  dumping grounds or new error-detail hierarchies.
- Generated Protobuf and original Spine JVM contracts remain unchanged.
- Breaking pre-release TypeScript renames are allowed.
- No generated edit and no Spine JVM build.

## Ownership

- `packages/proto`, `packages/core`, `packages/storage`, and
  `packages/transport` authored source, tests, package READMEs, and partitioned
  quality records.
- Exact downstream import/reference repairs required by a changed exported
  foundation name, serialized by the orchestrator.
- No storage adapters, server, client/auth packages, or semantic example
  cleanup.

## Acceptance Criteria

1. Owned authored source has zero TSDoc and semantic-name debt.
2. Every owned standalone function is moved behind a cohesive existing/new
   named owner or has one exact necessity disposition.
3. Public renames are short, domain-familiar, reflected in root exports and
   package docs, and do not create compatibility aliases solely to preserve
   pre-release names.
4. Type URLs, copied Proto names/shapes, serialization, validation, storage
   semantics, and ZeroMQ behavior remain unchanged.
5. Refactoring does not add global mutable state, lifecycle phases, adapters,
   or speculative abstractions.
6. Affected downstream imports compile before the slice endpoint; the owner
   records every out-of-package reference edit so later owners do not revert it.
7. Focused unit/compatibility/transport/storage tests prove behavior equivalence.

## Exclusions

- No adapter implementation cleanup, server behavior, example prose, or new
  public capability.
- No copied/generated Proto rename.
- No central final generation/export reconciliation owned by T-0080O.

## Verification And Review

- Owned checker partitions, focused package tests, compatibility/type-URL tests,
  build typecheck, package TypeDoc, lint/format, and `git diff --check`.
- Style/maintainability, documentation, and TypeScript/API-doc lanes are
  relevant.
- Performance/reliability is relevant when storage/transport code moves or
  dispatch/allocation behavior could change; otherwise record a concrete N/A.
