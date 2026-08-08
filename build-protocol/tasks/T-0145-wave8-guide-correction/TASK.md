# T-0145: Wave 8 Guide Correction

Status: In progress from completed Wave 8 commit `1abb4217`.

## Objective

Audit every active user-facing guide, package README/REFERENCE, architecture/API
guide, and example guide for stale pre-Wave-8 storage, delivery, validation, or
persistence claims; correct the complete batch and add deterministic regression
coverage for the missed retired delivery prose.

## Classification

Standard documentation correction. Public guidance changes, but production,
serialized, dependency, and runtime contracts do not.

## Acceptance

- Active guides describe the current `RecordSpec`/`StorageGroup`, per-family
  MySQL table and Datastore kind layouts, provider customization, direct durable
  records, complete `WorkerId` shard fencing, delivered-row deduplication,
  `DeliveryMonitor`, and the current validation package.
- No active guide presents removed attempts, quarantine, receipts, markers,
  claims, fingerprints, revoked-session storage, `withBatchSize`, `onPage`, or
  the retired observer hooks as current API.
- Beginner storage guidance shows how Proto source/record/group identity maps to
  MySQL tables and Datastore kinds, then how `(column)` values are materialized
  and targeted by queries.
- Documentation audience, snippets, TypeDoc/API, release-readiness links,
  formatting, diff checks, and focused deterministic tests pass.
- Documentation and TypeScript/API review concerns converge; reliability and
  style are N/A unless the correction changes behavioral or tooling code.

## Ownership

- One existing `implementer`, explicitly configured as
  `gpt-5.6-terra` / `medium`, owns active documentation and any focused
  documentation-regression test changes. It must not spawn subagents.
- The orchestrator owns read-only inventory, verification, review aggregation,
  integration, and remote synchronization.
