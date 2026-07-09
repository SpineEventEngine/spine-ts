# T-0020: Server Environment Context Assembly

Status: complete; integrated to main

Date: 2026-07-09

## Goal

Close the deferred `ServerEnvironment` assembly gap by letting `Server` accept
`BoundedContextBuilder` instances and build them at `start()` with the server
environment storage factory as the default storage source.

This task must stay small and JVM-familiar. It must not introduce a process-wide
singleton, broad assembly facade, worker topology, ZeroMQ endpoint runner,
durable scheduler, or integration broker.

## Splitter Result

The requirements-splitting sub-agent `019f4879-c12f-7602-8ff8-312ac8226c07`
reported no real blockers and recommended this staged plan:

1. `T-0020a`: `Server` accepts `BoundedContextBuilder` inputs and builds them
   at `start()`.
2. `T-0020b`: storage selection rule is explicit: `withStorageFactory()` wins;
   otherwise server-start assembly uses `ServerEnvironment.storageFactory`.
3. `T-0020c`: async entity-class assembly through `Server.start()` remains
   supported through the existing generated-registry builder path.
4. `T-0020d`: lifecycle checks confirm lazily built contexts are server-owned
   and failed assembly does not open the listener.
5. `T-0020e`: docs/API wording removes the stale "later builder integration"
   caveat.

The first implementable slice is the combined `T-0020a/T-0020b` behavior, with
focused lifecycle and docs updates because every task must update relevant docs.

## Scope

Likely production files:

- `packages/server/src/server/server.ts`
- `packages/server/src/context/bounded-context.ts`
- `packages/server/src/index.ts` only if the public type surface needs a named
  union/export

Likely tests:

- `packages/server/test/server/server.test.ts`
- `packages/server/test/context/bounded-context.test.ts`

Likely docs:

- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `packages/server/README.md`

## Acceptance Criteria

- `Server.add(builder)` supports a `BoundedContextBuilder`.
- `ServerOptions.contexts` may contain built contexts and builders if the
  implementation keeps that constructor path.
- `Server.start()` builds all added builders before opening the listener.
- A builder without explicit storage uses `ServerEnvironment.storageFactory`.
- A builder with `withStorageFactory(...)` keeps that explicit factory.
- Existing `Server.add(builtContext)` behavior remains unchanged.
- Built-from-builder contexts are server-owned and close with the running
  server.
- Builder assembly failure rejects before listener open and closes any contexts
  already built for that start attempt.
- Docs no longer say context-builder environment wiring is deferred.

## Human-Imposed Requirements Ledger

- Follow `BUILD_PROTOCOL.md`: one orchestrating agent, a splitter sub-agent,
  one implementation sub-agent per task/sub-task, five reviewer sub-agents, and
  close all participating agents when done.
- No change may be made without updating the relevant log.
- For `@spine-ts/server` code, inspect relevant Spine JVM server behavior before
  shaping runtime/API code.
- Prefer the smallest JVM-familiar concept over precise but large TS-specific
  abstractions.
- Avoid overengineering; delete or replace wrong abstractions aggressively.
- Keep names short and explicit; no more than four semantic components.
- Do not add broad facades, singleton server environment behavior, or invented
  server concepts absent from the JVM-backed requirement.
- Generated files must not be committed.
- Preserve strict read-side/write-side segregation and asynchronous processing.
- The framework and example docs must stay honest about what is ready.
- Test coverage target remains at least 90%.

## JVM Inspection Evidence

Inspected `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`, which
summarizes the relevant Spine JVM source paths:

- `io.spine.server.Server`
- `io.spine.server.ServerEnvironment`
- `io.spine.server.BoundedContextBuilder`
- `io.spine.server.BoundedContext`
- `io.spine.server.storage.StorageFactory`

Relevant JVM-backed behavior recorded there:

- Java `Server.Builder.add(BoundedContextBuilder)` builds contexts lazily as
  part of server/service assembly.
- Java repositories obtain default storage through `ServerEnvironment`.
- TypeScript should prefer an explicit `ServerEnvironment` object passed into
  builders/server assembly rather than adding a Java-style process-wide
  singleton.

Only the summarized local JVM research note was available under
`spine-jvm-docs/`; no local `core-jvm` source checkout was present in the
workspace search.

## Skill Applicability Check

Session-exposed skills used by the orchestrator:

- `subagent-driven-development`
- `using-git-worktrees`
- `requesting-code-review`
- `verification-before-completion`

Repo manifest checked:

- `build-protocol/skills/EXPECTED_SKILLS.md`

Installed skill entrypoints checked:

- `find ~/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`

Installed lock checked:

- `~/.agents/.skill-lock.json`

Selected task-relevant skills:

- `subagent-driven-development`: required for implementation/review agents.
- `using-git-worktrees`: required for isolated task worktree.
- `requesting-code-review`: required for review-loop discipline.
- `verification-before-completion`: required before completion claims.

Skipped relevant-looking skills:

- `architecture-patterns`, `codebase-design`, and
  `typescript-advanced-types` are advisory but not selected for the
  orchestrator because the slice is intentionally narrow and governed by the
  local build protocol plus existing server APIs.

## Verification Plan

Focused:

- `npx vitest run packages/server/test/server/server.test.ts packages/server/test/context/bounded-context.test.ts`
- `pnpm --config.verify-deps-before-run=false typecheck:build`
- `pnpm --config.verify-deps-before-run=false format:check`
- `pnpm --config.verify-deps-before-run=false docs:check`
- `git diff --check`

Before completion on `main`:

- `pnpm --config.verify-deps-before-run=false verify`

If sandbox denies local listener or IPC behavior with `EPERM`, rerun the
necessary verification with escalation as explicitly authorized by the human.
