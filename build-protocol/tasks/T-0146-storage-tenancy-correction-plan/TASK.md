# T-0146: Storage Tenancy Correction Plan

Status: Complete; implementation not started.

## Objective

Compare Spine TS storage scoping and revision columns with the current local
Spine JVM JDBC, Datastore, and core storage sources. Produce a behavior-first
plan that removes invented `_scope` and `_revision` persistence, uses each
provider's approved tenant-isolation mechanism, and does not partition records
by Bounded Context.

## Classification

High-risk architecture and persistence correction plan. This task changes no
runtime code, schema, dependency, or JVM source. A later implementation task
must own migrations and serialized/provider compatibility explicitly.

## Acceptance

- Cite exact JVM source evidence for JDBC tenant routing and Datastore namespace
  routing.
- Establish whether Spine JVM stores any Bounded Context discriminator or
  `_revision`-equivalent private column.
- Inventory every Spine TS production dependency on `_scope`, `_revision`, and
  context-derived physical identity.
- Separate removal of invented persistence from any still-required atomicity or
  compare-and-set behavior.
- Define staged implementation, compatibility, test, documentation, and review
  work without modifying production code in this planning task.
- Freeze JVM physical interoperability for IDs, declared columns, and query
  operands, including one schema-aware write/query mapping per provider.
- Replace TS-only binary/tagged message-ID encodings and generic message-column
  stringification in the implementation plan with JVM-compatible mappings and
  cross-runtime golden tests.
