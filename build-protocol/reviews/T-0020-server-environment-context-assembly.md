# T-0020 Review Log: Server Environment Context Assembly

Status: complete

Date: 2026-07-09

## Required Review Lanes

- Code style/maintainability: pending
- Documentation: pending
- TypeScript/API docs: pending
- Security: pending
- Performance/reliability: pending

## Shared Review Context

Reviewers must check the task diff against:

- `build-protocol/tasks/T-0020-server-environment-context-assembly/TASK.md`
- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/CODE_QUALITY.md`
- relevant docs touched by the task

Review focus from the splitter:

- Keep changes local to `Server` and a tiny bounded-context builder hook.
- Remove stale docs claiming `ServerEnvironment` builder integration is still
  deferred.
- Avoid overexposing internal builder/environment plumbing as public API.
- Preserve local-only default host behavior and fail before listener open when
  builder assembly fails.
- Build all pending contexts before listen and close already-built contexts if a
  later builder fails.

## Round 1

- Code style/maintainability: pass after follow-up fix.
- Documentation: pass after follow-up fix.
- TypeScript/API docs: changes requested; clean after follow-up fix and re-review.
- Security: pass.
- Performance/reliability: pass.

Findings:

- [P2] Public API declarations leaked the private `ServerContext` alias
  through `Server.add(...)` and `ServerOptions.contexts`. Public declarations
  should inline `BoundedContext | BoundedContextBuilder` or introduce a
  deliberate exported type instead of exposing a private helper alias.
- [P2] `Server.add(...)` and `ServerOptions.contexts` TypeDoc mentioned
  builders but did not document the actual behavior: builders assemble during
  `Server.start()` and default to `ServerEnvironment.storageFactory` unless
  `withStorageFactory(...)` selected a more specific local factory first.

Re-review:

- TypeScript/API docs final re-review reported clean after the public
  declarations stopped exposing the private alias and TypeDoc documented
  start-time builder assembly plus storage precedence.

## Post-Merge Verification Fix Review

Status: complete

Scope:

- `packages/server/src/context/bounded-context.ts`
- `packages/server/src/server/server.ts`
- `packages/server/test/server/server.test.ts`
- `build-protocol/work-logs/T-0020.md`

Reason:

- Full post-merge verification found one TypeScript return-type issue in a test
  dispatcher and one runtime classification bug in `Server` context/builder
  assembly. Both were fixed on `main` before committing the post-merge
  verification fix.

Round result:

- Code style/maintainability: clean.
- Documentation/log accuracy: clean.
- TypeScript/API docs: changes requested for total `isBuilder(...)` guard.
- Security: finding raised for structural non-builder context trust boundary;
  pending re-review because this reflects pre-existing `ServerOptions.contexts`
  behavior rather than a new boundary from the post-merge fix.
- Performance/reliability: clean.

Re-review:

- TypeScript/API docs: clean after the total `isBuilder(...)` guard added an
  object/non-null precheck before the WeakMap lookup.
- Security: clean after re-review confirmed the structural non-builder context
  concern is pre-existing `ServerOptions.contexts` behavior, not a new
  post-merge regression.
