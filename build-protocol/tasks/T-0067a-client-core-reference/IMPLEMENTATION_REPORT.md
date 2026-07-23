# T-0067a Implementation Report

Status: closed; merged and post-merge verified on `main`.

## Implementation

- Added the declared `@spine-ts/core` workspace dependency as the first
  TypeScript composite-project reference of `@spine-ts/client`, matching the
  existing dependency-reference ordering in `packages/server/tsconfig.json`.
- No dedicated build-graph regression-test seam exists: the existing script
  tests cover cleanup, formatting, package metadata, and Proto generation, not
  inter-package TypeScript references. The clean composite build is the
  smallest deterministic regression check for this configuration edge.

## Root-Cause And RED Evidence

- After `corepack pnpm proto:generate`, `corepack pnpm exec tsc -b --clean &&
corepack pnpm typecheck:build:generated` failed from a clean composite-output
  state with `TS2307` at `packages/client/src/client/client.ts` for
  `@spine-ts/core`; its dependent `field` parameter then surfaced as implicit
  `any`.
- `packages/client/package.json` already declares `@spine-ts/core`, while the
  client project previously referenced only `../proto`. The root build lists
  client before core, so TypeScript had no graph edge requiring core to build
  first. This is the root cause, rather than a source or generated-Proto issue.

## Focused Verification

- `corepack pnpm exec tsc -b --clean && corepack pnpm typecheck:build:generated`
  — passed after the correction from a clean composite-output state.
- `corepack pnpm exec tsc -b packages/client/tsconfig.json --force` — passed.
- `corepack pnpm format:check` — passed.
- `git diff --check` — passed.

The first direct `typecheck:build:generated` attempt in this fresh worktree
also exposed missing ignored Proto sources. `corepack pnpm proto:generate`
restored the required generated inputs; the subsequent clean-output RED command
is the authoritative reproduction. Proto generation changed only the
executable bit of an unassigned codegen script, which was restored before final
diff verification.

## Scope And Metadata

- Implementation change: `packages/client/tsconfig.json`.
- Durable records updated: this report and `build-protocol/work-logs/T-0067a.md`.
- No runtime model self-introspection metadata is exposed by this execution
  surface. The immutable assignment profile is the explicitly dispatched
  existing `implementer` role, `gpt-5.6-terra` / `medium`.
