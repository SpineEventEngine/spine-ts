# Implementation Report: T-0010.4 Command Registration Readiness

Status: Review Fix Verified
Task log:
`build-protocol/tasks/T-0010-4-command-registration-readiness/TASK.md`
Work log: `build-protocol/work-logs/T-0010-4.md`
Review log:
`build-protocol/reviews/T-0010-4-command-registration-readiness.md`
Branch: `task/T-0010-4-command-registration-readiness`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0010-4-command-registration-readiness`

## Summary

T-0010.4 starts from parent task commit `e5e7b1d`, after T-0010.3 introduced
write-side signal intake result values. The selected scope is a metadata-only
command registration readiness surface derived from existing handler metadata.
The subtask should expose command type ownership/readiness for later command
service/runtime tasks without implementing buses, services, dispatch, routing,
storage, validation, or `Ack`.

Implemented `CommandRegistrationReadiness` as a small public read-only view over
`HandlerMetadataRegistryLookup`. The surface reports deterministic registered
command message full type names and frozen copy-safe assignee metadata. Building
from `EntityHandlersMetadata` constructs a `HandlerMetadataRegistry`, preserving
the existing duplicate command assignment policy.

Review-fix follow-up replaced host-locale sorting with explicit code-unit
ordering and made the returned nested readiness view copy-safe by cloning and
freezing handler metadata, entity-handler metadata, registered handler
metadata, and shallow entity metadata for each lookup result.

## JVM Research Used

Setup inspected task-relevant Spine JVM server code:

- `CommandDispatcherRegistry.java`;
- `CommandDispatcher.java`;
- `AbstractAssignee.java`;
- `DuplicateHandlerCheck.java`;
- `BoundedContextBuilder.java`;
- `CommandService.java`;
- `spine-server-runtime-and-bounded-context.md`;
- `spine-routing-dispatch-and-delivery.md`.

The important JVM shape is unicast command registration: a dispatcher exposes
the command classes it can handle, registration rejects already-owned command
classes, and command service routing is later built from registered command
classes. Existing TS `HandlerMetadataRegistry` already enforces duplicate
command assignments, so this subtask should reuse that policy instead of
creating a second command-bus registry.

## Files Changed

- `packages/server/src/command-registration-readiness.ts`: new metadata-only
  readiness class, lookup interface, assignee metadata value type,
  locale-independent command-name ordering, and nested clone/freeze helpers for
  returned readiness metadata.
- `packages/server/src/command-registration-readiness.test.ts`: TDD coverage for
  empty registries, deterministic command lists, unique assignee lookup,
  duplicate failure through `HandlerMetadataRegistry`, copy safety, and absence
  of bus/service/dispatch/posting/routing/Ack members. Review-fix coverage adds
  code-unit ordering for punctuation/case/underscore/digit names and nested
  assignee metadata copy safety.
- `packages/server/src/index.ts` and `packages/server/src/index.test.ts`: public
  root exports and export contract assertions.
- `packages/server/README.md` and `docs/api/README.md`: command registration
  readiness usage notes and explicit runtime exclusions.
- `scripts/check-api-docs.mjs`: TypeDoc export gate updated for the new public
  server API.
- Build protocol task/report/work/review logs updated with implementation and
  verification evidence.

## Verification

- Worktree dependency setup on `2026-06-30 17:27 WEST`: the first sandboxed
  `corepack pnpm install --frozen-lockfile` hit npm registry DNS failures; the
  same frozen install was rerun with network escalation and completed from the
  existing pnpm store with 194 reused packages, 0 downloads, and no lockfile
  changes.
- Setup baseline verification passed on `2026-06-30 17:27 WEST`: `CI=true
corepack pnpm verify` passed with 19 test files / 234 tests, coverage 96.21%
  statements / 90.38% branches / 99.16% functions / 96.14% lines, TypeDoc/API
  checks with 100 proto / 28 core / 116 server / 26 storage expected exports,
  proto lint/generate checksum verification, and generated proto output clean.
- TDD RED on `2026-06-30 17:34 WEST`: `corepack pnpm test
packages/server/src/command-registration-readiness.test.ts` failed with six
  expected failures because `CommandRegistrationReadiness` was undefined before
  production code existed.
- Focused GREEN on `2026-06-30 17:37 WEST`: `corepack pnpm test
packages/server/src/command-registration-readiness.test.ts` passed 1 file /
  6 tests; `corepack pnpm test packages/server/src/index.test.ts` passed 1 file
  / 9 tests.
- Typecheck on `2026-06-30 17:37 WEST`: `corepack pnpm typecheck` passed.
- Full verification on `2026-06-30 17:38 WEST`: `CI=true corepack pnpm verify`
  passed with 20 test files / 240 tests, coverage 96.26% statements / 90.44%
  branches / 99.18% functions / 96.20% lines, TypeDoc/API checks with 100
  proto / 28 core / 119 server / 26 storage expected exports, proto
  lint/generate checksum verification, and generated proto output clean.
- Review-fix RED on `2026-06-30 17:48 WEST`: `corepack pnpm test
packages/server/src/command-registration-readiness.test.ts` failed as
  expected with 3 focused regressions for locale-dependent ordering, nested
  registered handler identity, and mutable nested handler metadata.
- Review-fix GREEN on `2026-06-30 17:51 WEST`: `corepack pnpm test
packages/server/src/command-registration-readiness.test.ts` passed 1 file /
  8 tests.
- Review-fix typecheck on `2026-06-30 17:51 WEST`: `corepack pnpm typecheck`
  passed.
- Review-fix full verification on `2026-06-30 17:54 WEST`: `CI=true corepack
pnpm verify` passed with 20 test files / 242 tests, coverage 95.94%
  statements / 90.38% branches / 98.15% functions / 95.87% lines, TypeDoc/API
  checks with 100 proto / 28 core / 119 server / 26 storage expected exports,
  proto lint/generate checksum verification, and generated proto output clean.

## Subtask Progress

- Setup logs and D-0051 were created on `2026-06-30 17:24 WEST`.
- Setup baseline verification passed on `2026-06-30 17:27 WEST`.
- Implementation and verification completed on `2026-06-30 17:38 WEST`.
- Review-fix pass completed on `2026-06-30 17:54 WEST`; both reviewer comments
  were addressed with focused RED/GREEN evidence and full verification.

## Concerns

- None.
