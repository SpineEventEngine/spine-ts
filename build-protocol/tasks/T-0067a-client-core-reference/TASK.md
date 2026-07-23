# T-0067a: Client-to-Core Build Reference

Status: closed; merged and post-merge verified on `main`.

Baseline: `4e3b43d6`

## Objective

Make a clean generated repository build compile `@spine-ts/core` before
`@spine-ts/client`, matching the client's declared workspace dependency and
preventing stale `dist` output from masking the build graph.

## Classification

Standard. The correction changes TypeScript project-build configuration but no
runtime behavior or public API.

## Human-Imposed Requirements Ledger

- Continue Wave 1 autonomously until every requested feature and closure gate
  is complete or a genuine protocol/environment blocker is documented.
- Use the streamlined selective-review protocol; do not reopen unrelated lanes
  or run redundant full gates for a one-edge build-configuration correction.
- Push the task branch and `main` to `origin` immediately after every commit.
- Preserve all unrelated user files and dirty-worktree contents.
- Never read, modify, stage, commit, delete, move, or use
  `human-review-1-jul.md` as project input.

## Acceptance Criteria

- Reproduce the clean-build failure without relying on pre-existing package
  output.
- Add the missing client-to-core TypeScript project reference using the
  existing repository pattern.
- Add or extend a deterministic build-graph regression check if the repository
  has an appropriate existing seam; do not invent a large new validator.
- Prove a clean generated build succeeds and run focused configuration,
  typecheck, formatting, and diff checks.
- Record all canonical review dispositions. TypeScript/API and
  style/maintainability are required; documentation and reliability may be N/A
  with concrete reasons if the endpoint remains configuration-only.
- Commit, immediately push the task branch, merge into `main`, post-merge
  verify, record closure, commit, and immediately push `main`.

## Dispatch Gate

- Implementer: existing `implementer` role, expected and explicitly dispatched
  `gpt-5.6-terra` / `medium`.
- Style/maintainability reviewer: existing role, expected and explicitly
  dispatched `gpt-5.6-terra` / `high`.
- TypeScript/API reviewer: existing role, expected and explicitly dispatched
  `gpt-5.6-terra` / `high`.
- Runtime metadata or the immutable-profile/self-introspection limitation must
  be recorded before accepting each result.
