# T-0067 Implementation Report

Status: implementation, reviews, and full verification complete; integration pending.

## Scope and behavior

- Corrected stale root/package claims: `@spine-ts/client` now documents its
  command/query/subscription facade and Projection Query DSL; the package-level
  `delivery-server` description distinguishes its low-level listener-free core
  from its exported standalone listener.
- Updated the framework guide's delivery narrative to describe the completed
  standalone in-memory server, its configuration/lifecycle, machine-facing
  Admin and health behavior, trusted-network boundary, and two-application-
  machine topology. Replaced the obsolete T-0063-era exclusion text with the
  actual Wave 1 frontier and retained the precise Wave 2/3/4 handoffs.
- Corrected both remote-supervisor snippets so builder-created delivery uses
  `RemoteInbox` with caller-owned durable, capacity-bounded quarantine storage
  and `RemoteWorkRegistry` over the same `DeliveryClient`. The lifecycle closes
  the supervisor before the client and application-owned quarantine resource.
- Existing examples remain consumer-substitution snippets: `@example/*`, the
  generated schemas/columns, and endpoint callbacks are supplied by the
  application. Their package-root Spine imports and documented public API names
  were checked against current package roots.

## Upstream delta audit

See `build-protocol/research/T-0067-upstream-delta-audit.md`. No upstream
runtime or contract change is adopted by this documentation task.

## Security and dependency inputs

- Extended the existing repository threat model with the Node client,
  singleton environment, BlackBox, delivery client/server/Admin, remote
  payload, and supervisor boundaries. Added TM-013 through TM-018 as explicit
  hypotheses for the existing final security reviewer; no clean disposition is
  pre-claimed.
- T-0067b patched the three development-only advisory resolutions without a
  manifest or direct-range change. It is merged, post-merge verified, and
  pushed at `main` closure `893d8756`; production and full low-threshold audits
  both report zero known vulnerabilities.

## Implementer metadata

- Assigned existing role: `implementer`.
- Expected and explicitly dispatched profile: `gpt-5.6-terra` / `medium`.
- Runtime model self-introspection is not exposed to this implementation
  surface. The immutable configured assignment is recorded; no visible fallback
  or role/profile mismatch was observed.

## Focused mechanical evidence

- `git diff --check` passed.
- `pnpm format:check` passed on the changed documentation.
- `node docs/check-typescript-snippets.mjs` passed for all TypeScript fences in
  the root guide and affected package READMEs. It proves TypeScript syntax and
  that every named `@spine-ts/*` import resolves to a current package-exported
  declaration, including `import type` bindings. Consumer-substitution modules,
  declared application-owned values, and endpoint callbacks remain illustrative
  and are intentionally not resolved in this framework workspace.
- `pnpm docs:check:generated` passed (TypeDoc generation and API-doc checker).
- `pnpm vitest run packages/delivery-server/test/public-api.test.ts` passed:
  1 test file, 2 tests. This verifies the documented standalone delivery-server
  root exports.
- `pnpm typecheck:build:generated` passed (`tsc -b`).
- After the coordinator API-actuality correction, the same focused gate passed
  again: `node docs/check-typescript-snippets.mjs`;
  `pnpm docs:check:generated`; `pnpm vitest run
packages/delivery-server/test/public-api.test.ts` (1 file, 2 tests);
  `pnpm typecheck:build:generated`; `pnpm format:check`; and
  `git diff --check`.
- No runtime, API, Proto, dependency, or generated-file change was made. The
  implementation endpoint is ready for the orchestrator's validation/review
  wave.

## Security correction implementation

- Added finite safe defaults and validated configuration for retained Inbox
  messages (10,000), serialized retained bytes (32 MiB), and tracked shards
  (1,000). Single and batch writes are admitted atomically against all three
  budgets; over-capacity operations return `RESOURCE_EXHAUSTED` without a
  partial write.
- Canonicalized server-side persisted-record validation to the delivery-client
  decoder boundary: complete identity/inbox/signal fields, valid timestamps and
  supported label/status enums, Command/Event payload, and a 1 MiB serialized
  payload limit. Batches have a server-side maximum of 100 records.
- Capped Admin snapshots and manual expiration responses at 1,000 shard
  observations, matching the maximum tracked-shard configuration and keeping
  response work below the existing 4 MiB RPC ceiling. Persisted worker/node IDs
  together are capped at 128 UTF-8 bytes so one expiration response cannot
  exceed that ceiling through session strings.
- Focused tests passed for poison direct-service requests, invalid mixed-batch
  atomicity, message/byte/shard capacity, and session shard capacity. Affected
  style, reliability, API, and security reviews remain required.

## Final correction batch

- Full encoded Inbox records now leave wrapper room below 4 MiB. `findOne`,
  newest, and exact requested page responses are encoded and checked; an
  over-ceiling page fails with `RESOURCE_EXHAUSTED` and instructions to request
  a smaller page, without silent shortening or a new cursor contract.
- Released message-free shard records are pruned immediately or after their
  final message is removed. The server core, listener, Admin/expiration output,
  and client decoder share the 1,000 tracked-shard ceiling.
- Write and remove batches validate the 1..100 length before any record work.
  Defaults are centralized, public core options declare their own ranges, and
  invalid core/listener configuration fails synchronously.
- The delivery client rejects combined worker/node identities over 128 UTF-8
  bytes before attempting an RPC, matching the server boundary.
- Final focused verification passed: delivery-server 15 files / 63 tests and
  delivery-client 10 files / 81 tests, including real gRPC and multi-process
  topology; both package composite builds passed.
