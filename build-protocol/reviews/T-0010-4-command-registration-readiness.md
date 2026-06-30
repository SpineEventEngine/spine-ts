# Review Log: T-0010.4 Command Registration Readiness

Status: Review Fix Verified

## Required Review Lanes

Every implementation subtask and docs-only subtask must complete these review
lanes before integration:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Setup Review State

T-0010.4 setup started on `2026-06-30 17:24 WEST` from parent commit
`e5e7b1d`. Setup inspected task-relevant Spine JVM command dispatcher,
assignee, duplicate handler, bounded-context builder, and command service code,
plus the existing TS handler metadata registry and bounded-context runtime
surface. No blockers were identified. Setup baseline verification passed on
`2026-06-30 17:27 WEST` with 19 test files / 234 tests, coverage 96.21%
statements / 90.38% branches / 99.16% functions / 96.14% lines, TypeDoc/API
checks with 100 proto / 28 core / 116 server / 26 storage expected exports,
proto lint/generate checksum verification, and generated proto output clean.

The setup boundary is metadata/readiness only: expose deterministic registered
command type ownership from existing handler metadata and reuse
`HandlerMetadataRegistry` duplicate command assignment validation. Do not
introduce command buses, services, posting, routing, dispatch, handler
invocation, validation, storage, transport, or `Ack`.

## Reviewer Rounds

No separate reviewer sub-agents were spawned per handoff. The implementation
sub-agent completed the required lanes against the task scope:

| Lane                       | Result                                                                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Code style/maintainability | Passed. The public surface is one small read-only class over `HandlerMetadataRegistryLookup`, with no command bus/service/dispatch behavior and no second duplicate policy. `eslint` and `prettier --check` passed in full verify.         |
| Documentation              | Passed. `packages/server/README.md` and `docs/api/README.md` describe command registration readiness as metadata-only and list runtime exclusions.                                                                                         |
| TypeScript/API docs        | Passed. Root exports and `scripts/check-api-docs.mjs` include `CommandRegistrationReadiness`, `CommandRegistrationReadinessLookup`, and `CommandRegistrationAssigneeMetadata`; TypeDoc JSON check passed with 119 expected server exports. |
| Security                   | Passed. Readiness returns frozen fresh-copy arrays/values, does not inspect payloads or invoke user handlers, and delegates duplicate assignment validation to the existing registry.                                                      |
| Performance/reliability    | Passed. Construction performs bounded metadata scans and deterministic sorting; lookups are map-backed; empty registries are valid. Full verify passed with coverage above the 90% task floor.                                             |

Verification evidence:

- RED: `corepack pnpm test packages/server/src/command-registration-readiness.test.ts`
  failed on `2026-06-30 17:34 WEST` because the new public API was absent.
- GREEN: focused readiness and root export tests passed on `2026-06-30 17:37
WEST`.
- Full: `CI=true corepack pnpm verify` passed on `2026-06-30 17:38 WEST` with
  20 test files / 240 tests and coverage 96.26% statements / 90.44% branches /
  99.18% functions / 96.20% lines.

Concerns: none.

## Review-Fix Round

Review-fix sub-agent evaluated the two incoming findings against
`packages/server/src/command-registration-readiness.ts` and found both valid:

- Important/reliability and Minor/maintainability: command-name sorting used
  default `localeCompare()`, so deterministic order depended on host/default
  locale and ICU behavior.
- Important/reliability: returned assignee values copied only the outer object;
  nested `handler`, `entityHandlers`, and `registeredHandler` references could
  be aliased from public lookup metadata and manually supplied registry
  metadata.

Resolution:

- Replaced `localeCompare()` with explicit locale-independent code-unit
  comparison and added regression coverage for digit, uppercase, underscore,
  and lowercase ordering.
- Added fresh frozen copies for returned nested handler metadata,
  entity-handler metadata, registered handler metadata, and shallow entity
  metadata so mutating one returned assignee cannot affect later lookups.
- Kept scope to metadata/readiness only; no command bus, command service,
  dispatch, posting, routing, validation, storage, handler invocation,
  transport, repository runtime registration, or `Ack` was added.
- Duplicate assignment enforcement remains delegated to
  `HandlerMetadataRegistry`; no second duplicate policy was introduced.

Review-fix verification:

- RED: `corepack pnpm test packages/server/src/command-registration-readiness.test.ts`
  failed on `2026-06-30 17:48 WEST` with 3 focused regressions for
  locale-dependent sorting, nested registered handler identity, and mutable
  nested handler metadata.
- GREEN: `corepack pnpm test packages/server/src/command-registration-readiness.test.ts`
  passed on `2026-06-30 17:51 WEST` with 1 file / 8 tests.
- Typecheck: `corepack pnpm typecheck` passed on `2026-06-30 17:51 WEST`.
- Full: `CI=true corepack pnpm verify` passed on `2026-06-30 17:54 WEST` with
  20 test files / 242 tests and coverage 95.94% statements / 90.38% branches /
  98.15% functions / 95.87% lines.

Concerns: none.
