# T-0061: Public DeliveryBuilder and Delivery

Status: Accepted for integration

Baseline: `3f284a4a`

## Objective

Promote the existing durable delivery core into a small, documented public
`DeliveryBuilder` and `Delivery` API. The builder must assemble the current
storage, shard-fencing, paging, worker, and environment seams without copying
deprecated JVM accessors or introducing the production scheduler/supervisor
owned by T-0062.

## Classification

High-risk. This packet changes a public API over persistence, shard leases,
failure isolation, paging, cancellation, and process-wide environment defaults.
T-0052 already completed and accepted the Wave 1 architecture split. The local
Spine JVM `DeliveryBuilder`, `DeliveryStrategy`, `UniformAcrossAllShards`, and
`DeliveryMonitor` sources were rechecked before implementation; no duplicate
requirements split is warranted unless implementation uncovers a genuine
contract conflict.

## Accepted Wave Contract

- `DeliveryBuilder` configures a storage context/factory, sharded work registry,
  shard strategy, monitor, positive page/batch bounds, and finite local
  scheduling behavior through idiomatic TypeScript methods.
- Omitted facilities resolve from `ServerEnvironment.instance()` where that
  singleton already owns the corresponding default. The default strategy is
  one shard, the monitor continues until idle, and all default bounds are
  finite.
- `Delivery` is the public immutable owner built from one resolved snapshot;
  later builder or environment configuration changes cannot mutate it.
- The public run boundary observes a started shard, every completed finite
  page/batch, normal already-owned pickup, completion, and failure in stable
  order. Monitor cancellation stops further paging, releases the session, and
  returns deterministic immutable evidence rather than abandoning work.
- Shard pickup stays exclusive. An already-owned shard is a normal observable
  skipped result, not an exception and not a session mutation.
- Paging repeats through the existing admitted-epoch/keyset machinery until
  exhausted, stopped by the monitor, or failed within the configured bound.
- Lease renewal/fencing, exact-row claims, bounded attempt history, failure
  isolation, and `finally` release behavior remain intact.
- Builder reuse is deterministic: each `build()` resolves and snapshots the
  current builder values without sharing mutable per-run state between built
  deliveries.
- T-0061 adds no catch-up pipeline API, production scheduler, supervisor,
  remote delivery client/server topology, deprecated getter/`has...` aliases,
  Java executor/channel types, or compatibility aliases.

## Required Verification

- RED/GREEN tests for builder defaults and overrides, validation and immutable
  resolution, singleton environment storage/node defaults, and builder reuse.
- Contract tests for exclusive concurrent pickup, already-owned observation,
  repeated paging, monitor cancellation, completion/failure ordering, lease
  loss, endpoint failure isolation, and release after every terminal path.
- Compile-time/public export and TypeDoc checks; package documentation and the
  end-user guide must contain current code snippets using only public APIs.
- Run focused server checks followed by the canonical generated repository
  verification before acceptance.
- Style/maintainability, TypeScript/API, documentation, and
  performance/reliability concerns are all required. Final security remains the
  Wave 1 T-0067 release gate because this packet adds no network trust boundary.

## Human-Imposed Requirements Ledger

- Deliver behavioral and conceptual JVM feature parity using idiomatic
  TypeScript; do not copy APIs blindly or invent over-engineered abstractions.
- There is no deprecation cycle: remove or replace wrong internal/public shapes
  needed by this packet rather than retaining aliases for nonexistent users.
- Implement `Environment`, singleton `ServerEnvironment`, and `Delivery` with
  JVM feature parity in Wave 1; T-0061 is the public builder/delivery slice.
- Delivery-server compatibility, the in-memory simple server only, and
  multi-machine topology remain Wave 1 but belong to T-0063 through T-0066.
- Redis and Hazelcast are excluded. Admin UI/TUI is Wave 4. Live TS/JVM
  compatibility tests are Wave 3.
- Only Node is supported for now.
- Continue autonomously, report feature-level progress at least every 30
  minutes, and push origin immediately after every commit.
- Preserve unrelated user files and never read or modify
  `human-review-1-jul.md`.

## Ownership

One existing `implementer`, explicitly `gpt-5.6-terra` / `medium`, owns the
server delivery production/test/docs slice and narrowly necessary singleton
environment integration. It follows RED/GREEN, may simplify overlapping
delivery internals when required, and may not commit, push, merge, install
dependencies, edit review dispositions, or spawn children. The orchestrator
owns records, review aggregation, gates, commits, pushes, merge, and post-merge
verification.
