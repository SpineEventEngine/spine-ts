# T-0055: Environment And Singleton Server Facilities

Status: Complete; integrated, post-merge verified, and pushed

## Objective

Replace per-server environment assembly with one lazily resolved,
environment-type-aware process singleton. Make `Environment` and
`ServerEnvironment` the stable Node runtime configuration boundary, preserve
the existing server attachment/cleanup guarantees, and expose deterministic
reset only through the testing subpath.

## Classification

High-risk. This task replaces a public server-construction contract, changes
process-wide facility ownership, and must preserve concurrent startup,
attachment, shutdown, and cleanup-retry behavior across multiple servers.
The accepted Wave 1 architecture fixes the public seam; no additional
requirements split is needed.

## Human-Imposed Requirements Ledger

- Provide behavioral/conceptual Spine JVM parity using an idiomatic, minimal
  TypeScript design; do not copy JVM internals or overload proliferation.
- Node.js is the only supported environment in Wave 1.
- Export `Environment`, `EnvironmentType`, `ServerEnvironment`, and
  `ServerEnvironmentSettings` from `@spine-ts/server`.
- Configure environment-specific settings through
  `ServerEnvironment.when(type).use(settingsOrFactory)` and resolve runtime
  facilities through `ServerEnvironment.instance()`.
- Remove `ServerEnvironment.local()`, `ServerEnvironment.production()`,
  `ServerOptions.environment`, and every ownership-option compatibility alias
  in the same packet; there is no deprecation cycle.
- One canonical `Environment` and one canonical `ServerEnvironment` exist per
  module graph. Resolution is lazy and concurrency-safe, and changing the
  selected environment after resolution fails clearly.
- Node identity remains stable until deterministic test reset or process end.
- Multiple servers share singleton facilities. Closing one server must not
  close them. Explicit process-environment shutdown closes each owned facility
  once while attempting all cleanup and retaining the existing retry semantics.
- The exact `@spine-ts/server/testing` subpath exports
  `resetServerEnvironmentForTest()`. It disposes the prior singleton and
  restores defaults deterministically; it is absent from the package root.
- Tests reconfigure through the production `when(type).use(...)` surface after
  reset. Singleton-mutating tests are serialized and always reset.
- Preserve unrelated files and the accepted Wave 1 scope; do not begin client,
  Projection query, BlackBox, or Delivery packets here.

## Ownership

- `packages/server` environment, server lifecycle, package exports, testing
  entrypoint, declarations, and focused tests;
- affected server/context fixtures, examples, and current documentation;
- package/API/release-readiness tooling needed for the exact testing subpath;
- T-0055 task, work, and review records.

## Acceptance Criteria

1. One stable `Environment` and `ServerEnvironment` instance is reachable from
   every supported canonical import path.
2. Settings are selected by environment type, resolve lazily once, and concurrent
   access invokes a settings factory at most once.
3. The supported root and testing exports match the exact plan; negative
   declaration/resolution fixtures prove reset controls do not leak at root.
4. Environment selection or reconfiguration after first resolution fails with
   a deterministic error and cannot split facility ownership.
5. Server node identity is generated once per singleton lifecycle and is stable
   across sibling servers.
6. Sibling `Server` instances share facilities. Closing/failing one server
   detaches its own contexts/resources without closing singleton facilities.
7. Explicit singleton close is concurrency-safe and idempotent, attempts all
   facility cleanup, aggregates failures, and preserves safe retry behavior.
8. Test reset waits for disposal, rejects/serializes unsafe close/reset races,
   clears settings and resolved state, and restores local in-memory defaults.
9. Remove all explicit-instance/ownership aliases and migrate active source,
   tests, examples, and current docs atomically with no compatibility export.
10. Startup failure, sibling-server, concurrent resolution, close/reset race,
    reset isolation, and package graph identity have focused regression proof.

## TDD And Verification

- Capture RED tests for the new root/testing imports, singleton identity,
  settings factory resolution, sibling ownership, and reset/close races before
  implementing the seam.
- Run focused server environment/lifecycle/context/package tests, typecheck,
  lint/cleanup, TypeDoc/API, formatting, release-readiness, stale-alias scans,
  and diff hygiene before review.
- TypeScript/API, documentation, style/maintainability, and
  performance/reliability reviews are all required.
- Run full repository verification after accepted review corrections, then
  commit/push, merge/push, post-merge verify, record closure, and continue.

## Assignment Gate

- Existing role: `implementer`.
- Bounded scope: this task only; one production writer; no child spawning.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Both fields must be explicit in dispatch.
- The implementer must not commit, push, merge, or modify unrelated files.
- Runtime metadata is recorded when exposed; otherwise the explicit immutable
  configured role/profile and limitation are accepted honestly.

## Baseline

- Branch/worktree: `task/T-0055-server-environment-singleton` /
  `.worktrees/T-0055-server-environment-singleton`.
- Base: pushed `main` at `a079c900` after T-0054 durable closure.
- Current `ServerEnvironment` is an explicit object built by `local()` or
  `production()`, accepts facility ownership flags, and is injected through
  `ServerOptions`. Individual servers may create and close implicit
  environments. T-0055 replaces this surface atomically while preserving the
  mature attachment/cleanup machinery beneath it.

## Durable Closure

- Reviewed task endpoint: `b374ac71` on
  `origin/task/T-0055-server-environment-singleton`.
- Integrated into `main` by merge commit `8b1990f4`, pushed to `origin/main`.
- The required post-merge `pnpm --config.verify-deps-before-run=false verify`
  passed on that merge: 86 test files passed with 3 skipped, 1,931 tests passed
  with 21 skipped, and branch coverage was 90.06%.
- Both typechecks, lint/cleanup, formatting, TypeDoc/API validation, copied
  Proto checksums, frozen descriptors, generated cleanliness, and release
  readiness also passed. T-0055 is durably closed; T-0056 is the active
  implementation frontier.
