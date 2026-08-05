# Spine TS concepts and definitions not directly present in `core-jvm`

Status: analysis proposal, 2026-07-17

## Purpose

This is a reduction inventory, not a claim that every listed item is wrong.
It identifies concepts and definitions introduced by Spine TS, then classifies
whether each is a real framework invention, a JavaScript/Node adaptation, or a
release-scope decision. Only the first category needs simplification review.
The comparison target is the fresh `master` tree of
[`SpineEventEngine/core-jvm`](https://github.com/SpineEventEngine/core-jvm),
whose public repository structure contains `core`, `server`, `client`, and
testing modules. The source comparison is pinned to core-jvm commit
`9dbb668ad1df14a37683c3b1bf9f315216a3872f`; generated output and tests were
not treated as public concepts.

## Executive conclusion

Most TS-only names are implementation seams needed to make an asynchronous,
single-process Node runtime explicit. The strongest simplification candidates
are not domain concepts but duplicated lifecycle state, public-looking
delivery/reliability vocabulary, and JSON-backed compatibility records. The
following should not be removed merely because the JVM represents them through
threads, executors, Guava caches, persistence implementations, or package-
private classes.

## Inventory

| TS concept/definition                                                                                                  | Evidence in TS                                      | Classification                                                | Simplification question                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `Storage`, `StorageFactory`, `RecordStorage`, `RecordSpec`, `RecordColumn`, `RecordMask`, `RecordQuery`, `RecordEntry` | `packages/storage/src/{storage,record}`             | Adapter abstraction; partly TS invention                      | Can one record-spec/query seam cover all adapters without exposing column/mask machinery at the package root? |
| `InMemoryRecordStorage`, tenant scopes, `StorageContext`                                                               | `packages/storage/src/memory`                       | Test/default adapter adaptation                               | Keep as a reference adapter; avoid treating tenant-scoped implementation as domain API.                       |
| `EventStore` append precheck, unique-ID lock, rollback token                                                           | `packages/storage/src/event/event-store.ts`         | TS runtime policy layered over storage                        | Confirm JVM event-store atomicity before retaining both lock and rollback concepts.                           |
| `ServerEnvironment` and environment attachment/generation lifecycle                                                    | `packages/server/src/server`                        | Node lifecycle adaptation with unusually explicit state       | Consider internal consolidation while preserving observable start/stop/close ordering.                        |
| generation stop, detach, parked obligations, readiness routing, quiescence evidence                                    | `packages/server/src/delivery`, `server`            | TS concurrency/lifecycle inventions or explicit encodings     | Collapse duplicate state machines only after proving no race/ownership contract is lost.                      |
| `DeliveryLoop`, run coordinator, attempt/exhaustion/parked-record vocabulary                                           | `packages/server/src/delivery`                      | TS delivery model; likely beyond core-jvm parity              | Keep private unless a supported public delivery API requires it; remove duplicate “scheduler” terminology.    |
| generated handler analyzer and generated registry writer/discovery                                                     | `packages/server/src/handler` and `scripts`         | Build-tool adaptation to TypeScript decorators/module loading | Prefer one generated metadata contract; avoid separate analyzer/registry concepts leaking to users.           |
| bare decorator metadata (`@Assign`, `@React`, `@Subscribe`)                                                            | `packages/server/src/handler`                       | Language adaptation                                           | Retain decorators, but make metadata the only runtime concept.                                                |
| explicit `TypeRegistry`, `TypeUrls.derive`, `AnyMessages.pack` facade                                                  | `packages/core/src/index.ts`                        | TS wire-contract facade                                       | Consolidate helper names if all callers use one registry/packing boundary.                                    |
| `Entity`, `EntityTransaction`, transition-validation facade                                                            | `packages/server/src/entity`                        | TS public API decomposition                                   | Compare with JVM aggregate/entity abstractions; avoid parallel validation entry points.                       |
| `Repository` default first-declared-field routing                                                                      | `packages/server/src/repository`                    | TS routing policy / possible invention                        | Verify whether JVM routing is schema-driven; if so, move this to explicit compatibility policy.               |
| `EventBus` in-process multicast and follow-up dispatch                                                                 | `packages/server/src/bus`                           | Node event-loop adaptation                                    | Retain only if it is the required local delivery boundary; otherwise merge with runtime dispatcher.           |
| `Runtime`, `RuntimeRouting`, `SignalIntake`, callback-bound transport                                                  | `packages/server/src/runtime`                       | Node/gRPC/IPC adaptation                                      | Hide these behind one server runtime port; they are not domain concepts.                                      |
| local ZeroMQ signal transport, endpoint files, socket identity/mode checks                                             | `packages/transport/src/zeromq`                     | Same-host Node transport adaptation                           | Keep adapter-local; no transport topology concept should enter core/server APIs.                              |
| internal `StandSubscriptionRecord` Protobuf definitions and local listener reconciliation                              | `packages/server/src/stand/subscription-records.ts` | TS persistence and Node listener adaptation                   | Keep internal; durable definitions do not make active streams portable.                                       |
| `BlackBox` and testing-only local server assembly                                                                      | `packages/testing`                                  | Test ergonomics adaptation                                    | Keep outside runtime packages; expose public-client behavior only and avoid duplicating production builders.  |
| generated ignored output and `docs:check`/public-root export scanners                                                  | `scripts`, package manifests                        | Toolchain adaptation                                          | Consolidate checks around one generated-contract manifest.                                                    |
| private payload/message-size caps and native receive guards                                                            | security fixes in server/transport                  | Node security adaptation                                      | Keep as adapter-local limits, with one shared limit policy rather than per-socket constants.                  |

## Confirmed JVM analogues: not TS inventions

These TS names have direct or strong JVM counterparts and should not be removed
merely because their representation differs:

| TS                                                                | JVM evidence                                                                                                                                                                                        | Result                                                                            |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `Aggregate`, `AggregateTransaction`, repository/aggregate storage | `server/src/main/java/io/spine/server/aggregate/Aggregate.java`, `AggregateTransaction.java`, `DefaultAggregateRepository.java`, and `server/src/main/kotlin/io/spine/server/entity/Transaction.kt` | Port/adaptation, not invention.                                                   |
| `@Assign`, `@React`, `@Subscribe`, `@Apply` compatibility         | `server/.../command/Assign.java`, `server/.../event/React.java`, `server/.../aggregate/Apply.java`, plus assignee/reactor classes                                                                   | Handler vocabulary is JVM-derived; TS generation is the adaptation.               |
| command/event buses and dispatch outcomes                         | JVM `server/bus`, `server/event/EventBus.java`, `server/dispatch/*`, and Kotlin event result helpers                                                                                                | Keep the domain boundary; simplify only duplicate TS outcome wrappers.            |
| delivery inbox, shards, pickup, catch-up, stations                | JVM `server/delivery/Inbox.java`, `ShardedWorkRegistry.java`, `CatchUp*`, `Station.java`, and `Conveyor.java`                                                                                       | TS delivery concepts are not invented, although its lifecycle coordinator may be. |
| query/read-side repository and stand concepts                     | JVM `server/entity/QueryableRepository.java`, `server/query/Querying.kt`, and `server/stand`                                                                                                        | Port/adaptation.                                                                  |
| storage record/column/spec/query concepts                         | JVM `server/entity/storage/*`, `server/storage/*`, and gcloud `DsRecordStorage`, `DsEntitySpec`, `DsColumnMapping`                                                                                  | Strong parity; TS naming is not evidence of invention.                            |

## Definitions that remain reduction candidates

After source inspection, the strongest TS-specific or TS-over-explicitness
candidates are generation,
registration-scoped retirement, parked operational obligations, readiness
handoff, exact-drain barriers, delivery-attempt summaries, durable subscription
claim/cancel state, default first-field routing, generated registry discovery,
and possibly `RecordSpec` column/mask vocabulary. `RecordSpec` itself is not a
confirmed invention because the JVM has record/storage specifications.

### Confidence corrections

- **High-confidence adaptation:** generated registry/analyzer/discovery is a
  TypeScript build/module-loading solution; the JVM uses classpath/reflection
  model classes and handler metadata instead.
- **Medium-confidence TS-specific lifecycle encoding:** generation,
  registration-scoped retirement, parked obligations, readiness handoff, and
  exact-drain barriers are represented explicitly in TS, while related JVM
  delivery lifecycle is expressed through `CatchUpProcess`, `Station`,
  `Conveyor`, `DeliveryMonitor`, and repository ownership. A direct behavioral
  mapping still requires focused source reading.
- **Low-confidence invention:** default first-declared-field routing. JVM
  `server/src/main/kotlin/io/spine/server/route/MessageRouting.kt` has explicit
  default-route replacement and type-based routing; TS should be checked against
  that contract before retaining its first-field policy.
- **Not established as an invention:** durable subscription claim/cancel state
  may be a TS persistence encoding for a service concern; it is not a
  core-jvm equivalent unless the JVM subscription implementation is compared.

## Proposed reduction rules

1. Keep public concepts that describe observable behavior or a supported adapter.
2. Make lifecycle, generation, readiness, and parked-obligation types private.
3. Prefer one internal lifecycle coordinator and one delivery outcome model.
4. Keep Protobuf and Spine type-URL concepts canonical; do not simplify them
   into JSON or JavaScript-only names.
5. Require a source-level `core-jvm` mapping and behavior tests before any
   removal, rename, or public-contract change.

## Follow-up evidence required

- Read the corresponding JVM implementations, not only filenames, for the
  medium-confidence lifecycle candidates.
- Compare the pinned `core-jvm` source with the TS source at the analysis
  baseline and record any later drift.
- Map each TS item to a JVM type or record “no JVM analogue” with source path.
- Reclassify each item as parity, platform adaptation, release exclusion, or
  TS invention, then create reduction tasks only for confirmed inventions.
