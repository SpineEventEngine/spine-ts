# T-0015e: Generated Registry Runtime Discovery

Status: completed
Start: `2026-07-07 22:36 WEST`
End: `2026-07-08 00:20 WEST`
Baseline commit: `df562b3`
Task log path: `build-protocol/tasks/T-0015e-runtime-discovery/TASK.md`
Branch: `task/T-0015e-runtime-discovery`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0015e-runtime-discovery`
Requirements splitter: `019f3dce-6067-7190-919d-cf6a62eebfa7`; completed and closed during T-0015a setup.
Authoring sub-agent: Codex implementation sub-agent
Reviewer status: all required lanes clean after three rounds plus focused docs re-review
Implementation commit: `9d28aeb`
Final branch HEAD: `9d28aeb`
Integrated to main: Pending

## Objective

Add the smallest runtime discovery anchor for framework-generated handler
registry modules.

T-0015e should let framework/server assembly load generated registry modules
from explicit or conventional generated output locations and ingest them through
the T-0015b `HandlerRegistryIngestor`. It must not implement to-do example
migration, generated source creation, handler invocation changes, or broader
package scanning.

## Human-Imposed Requirements Ledger

- Handler discovery and materialization are framework responsibilities.
- End-user apps must not call `materializeDecoratedEntityHandlers()` or provide
  explicit schema-bearing decorators in ordinary code.
- Generated registry modules are build artifacts under ignored `generated/`
  directories.
- Runtime discovery must remain small and explicit; no speculative global
  scanning or hidden process-wide registry mutation.
- Generated registries exclude `@Apply`.
- Ordinary handlers return domain messages, not framework `Command` or `Event`
  envelopes.

## Context From Earlier Slices

- T-0015b added `GeneratedHandlerRegistry` and `HandlerRegistryIngestor`.
- T-0015c added the build-time analyzer.
- T-0015d added the internal generated registry writer, which can produce a
  generated module exporting `generatedHandlerRegistry`.

## Acceptance Criteria

- Provide a small framework-owned discovery/loading API for generated registry
  modules.
- Support explicit module URL/path inputs and a conventional generated registry
  location without scanning arbitrary package trees.
- Validate loaded module shape and report deterministic errors.
- Ingest discovered registries through `HandlerRegistryIngestor`, returning or
  filling a caller-owned `HandlerMetadataRegistry`.
- Do not introduce automatic handler invocation changes, to-do example
  migration, generated source writing, or runtime global registration.
- Add focused tests for successful loading, missing exports, invalid modules,
  and ingestion wiring.
- Update technical/API docs, package README, and durable logs.

## Verification Plan

- Focused discovery tests.
- Existing generated registry writer/ingestion tests.
- `corepack pnpm typecheck:build`.
- `corepack pnpm docs:check`.
- `corepack pnpm lint`.
- `corepack pnpm format:check`.
- `git diff --check`.
