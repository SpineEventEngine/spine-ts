# T-0080N: Remediate the datastore-orders example

## Status

Planned.

## Parent And Dependencies

- Parent: T-0080.
- Depends on: T-0080E and T-0080H.
- May run in parallel with T-0080L/M.

## Objective

Bring the flat datastore-orders example's authored TypeScript and Proto into
full documentation, naming, and behavior-ownership compliance while preserving
its Datastore-backed workflow.

## Classification

High-risk if an authored Proto/public example contract or persistence-sensitive
behavior changes; otherwise standard.

## Human-Imposed Requirements Ledger

- The example remains flat and uses
  `@spine-event-engine/example-datastore-orders`.
- Authored Proto declarations/fields and exported TypeScript APIs have concise,
  complete documentation.
- Authored names have at most four semantic components.
- Standalone functions require cohesive ownership or exact necessity
  dispositions.
- Existing Datastore adapter/load behavior and end-user API guardrails remain
  intact.
- Copied Spine Proto and generated output are not hand-edited.
- No Spine JVM build.

## Ownership

- `examples/datastore-orders` authored Proto/TypeScript, docs, tests, and
  quality partitions only.
- No shared root script/workspace/API-manifest edit.

## Acceptance Criteria

1. Owned authored Proto and TypeScript have zero comment/TSDoc/name debt.
2. Every remaining standalone function has a specific necessity disposition.
3. Proto renames preserve field numbers/wire types and update generated
   consumers through clean generation.
4. Datastore adapter composition, command/entity/query/load behavior, package
   payload, and cleanup remain equivalent.
5. README environment variables/commands/package coordinate remain accurate and
   end-user API scans remain clean.
6. Focused example tests pass without requiring live external Datastore access
   beyond the repository's existing test contract.

## Exclusions

- No Datastore feature/schema migration, new example behavior, or package move.
- No shared tooling/generation aggregation change.

## Verification And Review

- Clean package generation/build, full datastore-orders focused tests/load
  smoke under existing fixtures, docs commands/links, end-user API scan,
  TypeDoc/lint/format, checker partitions, generated cleanliness, and
  `git diff --check`.
- Style/maintainability, documentation, TypeScript/API docs, and
  performance/reliability are relevant when persistence/load ownership moves.

## Planning Dispatch

- T-0080N starts after completed and pushed T-0080M commit `28c0f379`.
- Authored Proto/public contracts plus persistence/load lifecycle make planning
  high-risk. The existing requirements splitter is explicitly assigned
  `gpt-5.6-sol` / high.
- The splitter is read-only, may not spawn, and must inventory the exact 79
  TSDoc, 13 standalone-function, 54 Proto-comment, and one structural row;
  freeze wire/package/generated/Datastore/query/load/cleanup invariants; and
  propose bounded non-overlapping ownership and exact gates.
- Both model and reasoning fields are explicit. Runtime metadata or its honest
  limitation is required.

## Accepted Bounded Plan

- Exact debt is 79 TSDoc rows, 13 standalone-function rows, 54 Proto-comment
  rows, and one semantic-name row.
- N1 owns the command/entity/event Proto files and adds 18 comments. N2 owns
  `read_models.proto` and adds 36 comments. Neither changes a non-comment token.
- N3 owns `src/index.ts` and its topology test only if required. It resolves 57
  TSDoc rows and renames only
  `startDatastoreOrdersDatastoreServer` to `startOrdersDatastoreServer`;
  no compatibility alias remains.
- N4 owns `src/load-runner.ts`, its script, and its test. It resolves 22 TSDoc
  rows, retains exported `runDatastoreOrdersLoad`, and moves nine private
  helpers into the existing run/user owners without generic utilities.
- N5 follows integration and owns README plus the four exact ledgers. It targets
  zero TSDoc/Proto/name debt and exactly four necessities for the three public
  composition/server boundaries plus the exported load runner.
- Package, Proto package/type URLs/wire/options/generated paths, exact 2/10/2
  topology and 14 repositories, storage-factory composition, Datastore adapter
  creation, server defaults, load levels, 16-session pool, 10-user waves,
  correlation, timings, all-settled failure messages, percentiles,
  zero-elapsed throughput, timeout aborts, cleanup, and CLI shutdown are frozen.
- Baseline clean generation/project build and all three focused files/10 tests
  pass. The required CLI gate is the real 10-user in-memory loopback run; it is
  not Datastore emulator/cloud evidence.
- All four canonical review concerns apply. Security is N/A until final release
  readiness.
- Splitter runtime self-introspection was unavailable for explicit
  `gpt-5.6-sol` / high, with no visible mismatch.

## Implementation Dispatch

- N1, N2, and N3 use isolated non-overlapping ownership. Each writer is the
  existing implementer role, explicitly `gpt-5.6-terra` / medium, with both
  fields explicit in dispatch.
- Writers may not edit another track, shared tooling, package/workspace files,
  generated output, ledgers, or records; may not commit, push, build Spine JVM,
  or spawn; and must report runtime metadata or its limitation.
- N1/N2 prove comment-only token identity. N3 proves the single exact rename,
  unchanged topology/storage/server behavior, and complete TSDoc.
- N4 is dispatched when an implementation slot returns. N5 follows complete
  integration and review.
