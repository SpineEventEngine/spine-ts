# T-0017k Review Log

Status: clean after focused re-review

Scope: production server runtime environment assembly, lifecycle ownership,
docs/API updates, and verification evidence.

## Required Lanes

| Lane                       | Reviewer ID                            | Status | Result          |
| -------------------------- | -------------------------------------- | ------ | --------------- |
| Code style/maintainability | `019f4676-7d98-7ad0-adf9-0bc3361b14c2` | Closed | Clean           |
| Documentation completeness | `019f4676-988f-75b3-9979-ef4fddff987c` | Closed | Findings to fix |
| TypeScript/API docs        | `019f4676-b540-7540-b359-5be9d338514d` | Closed | Findings to fix |
| Security                   | `019f4676-c992-76d1-9540-ac7977984ea7` | Closed | Findings to fix |
| Performance/reliability    | `019f4676-df72-7d62-a164-f07d7ea0b751` | Closed | Findings to fix |

## Review Requirements

- Reviewers must check the task `Human-Imposed Requirements Ledger`.
- Reviewers must check that the implementation inspects and preserves the
  relevant JVM `Server`/`ServerEnvironment` concepts without copying the Java
  singleton model wholesale.
- Reviewers must check that production mode refuses missing required factories
  before opening the listener.
- Reviewers must check that local/test defaults remain convenient.
- Reviewers must check that environment ownership and shutdown order are
  explicit, idempotent, and tested.
- Reviewers must check that ZeroMQ worker topology remains deferred to
  `T-0017l`.
- Reviewers must check that no end-user API requires framework `Event`
  envelopes, manual transactions, schema-bearing decorators, `@Apply`, or
  application-owned handler materialization.

## Initial Findings To Inspect

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md` says Java
  `ServerEnvironment` selects storage, transport, delivery, tracing, command
  scheduling, deployment type, and node ID. Tests use defaults; non-test modes
  require configured storage and transport.
- The same doc recommends explicit TypeScript environment/runtime objects with
  clear ownership rather than surprising shared-factory closure.
- Current TypeScript `Server` already owns HTTP/2 listener lifecycle, contexts,
  and explicit closeable resources. The next slice should extend this shape
  rather than replace it with a broad facade.

## Round One Findings

- Documentation reviewer requested that the top-level user guide server bullet
  mention `ServerEnvironment`, local/test defaults, caller-owned environments,
  production-required facilities, and close order. It also requested that
  production examples stop using `InMemoryStorageFactory`.
- TypeScript/API reviewer found that docs/comments overclaim environment
  configuration for already-built contexts and that public
  `ServerEnvironment.assertReadyToStart()` leaks an internal preflight hook.
- Security reviewer found that a blank host can bypass the local-only default
  and bind broadly, and also requested production examples avoid in-memory
  storage.
- Performance/reliability reviewer found listener-open failure cleanup gaps,
  failed-close retry gaps, and local transport publish-handler map cleanup gaps.

## Round Two Findings

- TypeScript/API docs, security, and performance/reliability re-review reported
  clean.
- Documentation re-review found one remaining stale top-level
  `docs/USER_GUIDE.md` server bullet that lacked the new environment details.
- Style re-review requested extracting the duplicated retryable close helper
  logic from `server.ts` and `server-environment.ts` into one package-private
  helper.

## Round Two Fixes

- Updated the stale top-level `docs/USER_GUIDE.md` server bullet to describe
  `ServerEnvironment`, local/test defaults, caller-owned environments,
  production-required storage/transport, and environment close order.
- Extracted shared retryable close behavior into package-private
  `packages/server/src/server/retryable-close.ts` and reused it from
  `server.ts` and `server-environment.ts`.

## Focused Final Re-review

- Documentation reviewer `019f4689-6cc0-7e53-9580-b5d54327aeed` reported
  clean after checking the user-guide server bullets and production snippets.
- Style reviewer `019f4689-5635-70c3-9aba-d009fd634c0d` reported clean after
  checking the shared retryable close helper extraction.

## Round One Fix Pass

- Authoring/fix sub-agent updated `docs/USER_GUIDE.md`,
  `packages/server/README.md`, API/architecture docs, and TypeDoc comments to
  narrow `ServerEnvironment` wording to server assembly, replace production
  in-memory snippets with durable/deployment placeholders, and state that
  durable production storage adapters remain deferred while
  `InMemoryStorageFactory` is local/test-only.
- Removed public `ServerEnvironment.assertReadyToStart()` and kept production
  required-facility validation at environment construction.
- Rejected blank server hosts before listener creation.
- Added listener-open failure cleanup for owned closeables/environments,
  retryable failed close behavior for `RunningServer` and `ServerEnvironment`,
  and local publish-handler map deletion when the last subscriber closes.
- Verification evidence is recorded in
  `build-protocol/work-logs/T-0017k.md`.
