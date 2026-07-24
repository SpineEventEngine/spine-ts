# T-0072 Upstream Delta Audit

Date: 2026-07-24

## Scope

This audit covers the Wave 2 generic entity-query surface against the frozen
Spine JVM sources already recorded by the Wave 2 plan. It is a disposition
record, not evidence of live TS/JVM interoperability, which remains Wave 3.

## Disposition

| JVM-facing concern        | TypeScript disposition                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Queryable entity families | Aggregate, Projection, and Process Manager state schemas generate `EntityColumn` definitions and execute through one current-record query seam. |
| Current state authority   | Durable current records own state, version, archived, and deleted values; no query index is authoritative.                                      |
| History                   | No remote history query is introduced. Local state/event history remains the existing provider-owned diagnostic seam.                           |
| Query wire contract       | `spine.client.Query` is unchanged and remains current-state-only.                                                                               |
| Legacy public names       | Replaced atomically; no compatibility alias or migration reader is retained.                                                                    |
| Provider execution        | Memory, Datastore, and MySQL use bounded candidates, decoded-state ID validation, and shared evaluation.                                        |
| Deferred work             | Package publishing, deployment, and live JVM compatibility are Wave 3; human administration is Wave 4.                                          |

## Evidence

- Client/codegen tests exercise declared columns for all three entity families
  from one descriptor source and deterministic generated companion output.
- Server routing and Stand tests exercise durable current state rather than a
  `RecordStorage` candidate index.
- Provider conformance covers current-state cloning, lifecycle metadata,
  bounded materialization, and restart-compatible scoped storage.

No new upstream product delta was identified that changes the accepted Wave 2
scope.
