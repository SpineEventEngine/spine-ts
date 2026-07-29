# T-0080E: Remediate production storage and delivery adapters

## Status

Planned.

## Parent And Dependencies

- Parent: T-0080.
- Depends on: T-0080D.
- Required by: T-0080N and T-0080O.

## Objective

Remediate authored APIs and behavior ownership in the Datastore/RDBMS storage
adapters and standalone delivery server without changing persistence, lifecycle,
or delivery semantics.

## Classification

High-risk when exported contracts, persistence code, resource lifecycle, or
delivery behavior is moved; otherwise standard.

## Human-Imposed Requirements Ledger

- Complete concise TSDoc, third-person callable summaries, and parameter/result
  coverage apply to owned public APIs.
- Authored names have no more than four semantic components.
- Standalone behavior belongs to cohesive types/objects or has an exact
  necessity disposition.
- Use Spine/JVM-familiar concepts and avoid invented wrappers, utilities, and
  error-detail hierarchies.
- Runtime persistence, connection, shutdown, and delivery behavior must remain
  equivalent.
- Generated output is not edited and Spine JVM is not built.

## Ownership

- `packages/storage-datastore`, `packages/storage-rdbms`, and
  `packages/delivery-server`, including owned tests/docs/quality partitions.
- Exact downstream import fixes for their exported names, serialized before
  another owner edits the consumer.

## Acceptance Criteria

1. Owned authored sources have zero TSDoc/name debt and exact dispositions for
   every remaining standalone function.
2. Public names/docs are concise and match actual adapter/server behavior.
3. Refactors preserve query translation, transactions, type serialization,
   connection ownership, server start/close, and failure cleanup.
4. No generic `Utils`/facade is introduced merely to collect former functions.
5. Focused persistence, adapter, delivery-server lifecycle, and public-export
   tests remain green.
6. Shared/root updates are serialized; this slice does not opportunistically
   modify another active production/example lane.

## Exclusions

- No schema migration, new datastore/RDBMS feature, delivery topology, retry
  policy, or deployment work.
- No server-framework or delivery-client cleanup.
- No final shared generation/API manifest closure.

## Verification And Review

- Focused package tests, typecheck, package TypeDoc/export audit, lint/format,
  relevant checker partitions, and `git diff --check`.
- Style/maintainability, documentation, and TypeScript/API-doc lanes are
  relevant.
- Performance/reliability is relevant for persistence, connection, server
  lifecycle, cleanup, and delivery paths.
