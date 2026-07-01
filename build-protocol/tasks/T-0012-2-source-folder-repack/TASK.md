# T-0012.2: Source Folder Repack

Status: Complete; ready to merge into parent corrective branch
Start: `2026-07-01 18:47 WEST`
Baseline commit: `480feb02ebde00e03f13a30162d31b9f427e7d18`
Branch: `task/T-0012-2-source-folder-repack`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-2-source-folder-repack`
Parent task: `T-0012 Corrective Cleanup And Roadmap Reset`

## Objective

Reorganize package source and test files by semantics before deleting or
rebuilding runtime behavior.

This task prepares the codebase for the simpler JVM-aligned cleanup by making
modules navigable without changing framework behavior.

## Scope

Allowed:

- move production files into package-specific semantic folders;
- move tests to mirror the corresponding production folders;
- update imports, package entry points, TypeScript config, ESLint config, and
  docs affected by file movement;
- keep package root `src` folders to a handful of entry/global files;
- keep existing public package exports working unless a change is explicitly
  documented as internal-only.

Not allowed:

- redesign storage, buses, repositories, bounded context, delivery, stand, or
  gRPC behavior;
- introduce new framework concepts;
- rename concepts for semantic redesign beyond path-local import cleanup;
- add exported standalone helpers;
- weaken cleanup enforcement from `T-0012.1`.

## Initial Folder Intent

- `packages/server/src/context`: bounded-context assembly surface.
- `packages/server/src/entity`: entity state, metadata, transaction, and
  transition validation.
- `packages/server/src/handler`: handler decorators, metadata, and registration
  readiness.
- `packages/server/src/repository`: repository surface.
- `packages/server/src/runtime`: runtime routing, signal intake, and runtime
  dispatch helpers.
- `packages/transport/src/zeromq`: ZeroMQ adapter configuration and adapter
  implementation if the existing file needs to split later.
- Skeletal packages such as `core`, `storage`, `testing`, and `proto` may keep a
  root entry point when they have no meaningful internal folder yet.

The implementer may adjust these folder names if local imports show a simpler
semantic grouping, but must record the reason in this task report.

## Acceptance Criteria

- `packages/server/src` contains only `index.ts` plus semantic folders.
- `packages/server/test` mirrors the new server `src` semantic folders.
- `packages/transport/src` contains only `index.ts` plus semantic folders when
  more than one production file exists.
- `packages/transport/test` mirrors transport production folders.
- Small packages retain only intentional root entry files.
- `pnpm lint` cleanup checks pass.
- Typecheck, tests, docs checks, proto generation/checks, and full verify pass.
- Reviewers confirm no behavior redesign or helper sprawl was introduced.

## Required Skills

- `codebase-design`: semantic grouping and avoiding shallow helper sprawl.
- `typescript-advanced-types`: advisory only if moved exports affect type
  surfaces.
- `verification-before-completion`: required before completion claims.

## Review Lanes

Required independent reviewers:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

No blocking human question is known.
