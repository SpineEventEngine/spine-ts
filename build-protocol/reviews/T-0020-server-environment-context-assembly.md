# T-0020 Review Log: Server Environment Context Assembly

Status: planned

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
