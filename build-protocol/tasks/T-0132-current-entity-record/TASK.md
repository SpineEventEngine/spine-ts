# T-0132: Current EntityRecord Storage

Status: Complete on the Wave 8 integration train

## Objective

Stores every current Entity state in the Spine JVM `EntityRecord` envelope and
derives its record specification from the Entity class. Removes caller-built
current-state descriptors and alternative current-state records.

## Classification

High-risk because this task introduces a JVM wire record, changes repository
persistence and restoration, and defines provider-facing query columns.

## Baseline And Ownership

- Baseline: reviewed integration-train commit `84c321db`.
- Branch: `task/T-0132-current-entity-record`.
- Worktree: `.worktrees/T-0132-current-entity-record`.
- Production ownership: Entity record/scanning code in storage and
  `packages/server/src/{entity,repository,context}/**`; the exact frozen JVM
  `spine/server/entity/entity.proto` source and required Proto manifest/exports
  are included because the repository does not yet contain `EntityRecord`.
- Supporting ownership: the bounded handler metadata/generated-registry paths
  needed only to attach a hidden, immutable state schema to the Entity class.
  This is class-owned metadata, not a registry or an end-user static field.
- Test ownership: mirrored storage/server/Proto contract tests.

## Acceptance

1. The copied `spine.server.entity.EntityRecord`, `LifecycleFlags`,
   `EntityRecordChange`, and `EntityStateValidationError` contract is byte-for-
   byte the current Spine JVM source at analyzed commit
   `0779b5fa42ca5cebd0d2935fc3a3489ab47846dc`; no JVM build or modification is
   allowed.
2. `SpecScanner` accepts only an Entity class and derives the Entity state
   schema, first-field ID schema/kind and extractor, JVM `EntityRecord` type,
   lifecycle/version columns, and eligible `(column)` fields. It must not take
   caller-supplied schemas and must not use a separate metadata registry.
3. Any deterministic build-generated class metadata needed because TypeScript
   erases generic schemas is owned by the Entity class itself; end users do not
   write storage descriptors or registration boilerplate.
4. Repository current-state writes pack ID and state into `Any`, store a
   `core.Version` and `LifecycleFlags`, and restore the same Entity state,
   version, and lifecycle flags.
5. Multiple state columns unpack one stored state at most once per record
   materialization. Provider queries receive the materialized lifecycle,
   version, and state columns.
6. Two Entity state types share the `EntityRecord` record type but remain
   physically separate by their source type.
7. Remove caller-built current descriptors, metadata registries,
   compatibility hashes, JSON-in-`Any`, and alternative current-state record
   shapes without aliases.
8. Migrate only direct Entity-current consumers assigned to this task. Other
   integration-train compile failures remain inventoried for their later tasks.

Replacing the exported alternative `EntityRecord<I, S>` shape is expected to
break Datastore and RDBMS implementations until T-0134/T-0135. That is not a
reason to retain a compatibility type or broaden this task into provider
layout work. Storage core/server focused builds must pass; later-provider
failures are recorded as the integration-train handoff.

## Implementation Assignment

- Owner: existing implementer role.
- Expected profile: `gpt-5.6-terra` / `medium`, explicitly selected in the
  dispatch through the immutable implementer role configuration.
- Required method: RED-first frozen-Proto, scanner, pack/restore, single-unpack,
  source-isolation, and query-column tests before production changes.
- The owner must not spawn subagents, commit, push, merge, build JVM code,
  access the migration remote, or modify later provider/delivery/example tasks.

## Review And Verification

- All four canonical concerns are required.
- Run focused storage/server/Proto typecheck and coverage. The shared task
  profile must advance beyond every T-0132-owned legacy compile failure and may
  stop only on the recorded consumers owned by later train tasks.

## Human-Imposed Requirements Ledger

- Preserve the frozen Spine JVM `EntityRecord` Proto byte-for-byte; do not build
  or modify JVM sources.
- Derive current-record storage only from Entity-class metadata and retain no
  legacy descriptor or record-shape compatibility aliases.
- Keep direct Entity-current work bounded to T-0132; later provider, delivery,
  and integration-train consumers remain assigned to their recorded tasks.
- Use focused behavior-first tests, append durable evidence, and do not commit,
  push, merge, spawn subagents, or access migration remotes for this task.
