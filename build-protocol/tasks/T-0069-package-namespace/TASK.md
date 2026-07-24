# T-0069: Atomic Package Namespace Cutover

Status: Complete

## Objective

Rename every live Spine TS workspace package and reference from
`@spine-ts/*` to `@spine-event-engine/*` atomically, with no aliases or dual
scope, while preserving historical protocol evidence.

## Classification

High-risk. The change replaces every package identity and import specifier,
touches generated-code templates and executables, rewrites the lockfile,
changes public documentation, and must leave the whole monorepo resolvable in
one commit.

## Acceptance Criteria

- Rename all fourteen workspace packages.
- Replace all live `@spine-ts/*` references in the 226-file inventory,
  including manifests, lockfile, source/tests, scripts, generated-source
  templates, examples, root/package docs, and API validation inventories.
- Do not rewrite `build-protocol/**` historical evidence merely to hide prior
  package names. Current T-0068/T-0069 active planning records may name the old
  scope when describing the cutover.
- Keep pnpm and the existing workspace topology.
- Add a deterministic release gate that rejects a live old-scope reference
  outside the explicit historical-evidence boundary.
- Provide no compatibility alias, redirect package, `paths` mapping, or
  dual-scope export.
- Prove package/export resolution, code generation, declarations, examples,
  tests, and user documentation under `@spine-event-engine/*`.
- Preserve unrelated root files and never modify `human-review-1-jul.md`.
- Commit and push the task branch immediately, then merge, verify, and push
  `main`.

## Human-Imposed Requirements Ledger

- Cut over every live workspace package and reference to
  `@spine-event-engine/*` in one atomic change.
- Provide no compatibility package, alias, redirect, path mapping, migration
  layer, or dual-scope support for `@spine-ts/*`.
- Retain pnpm and the current workspace topology.
- Follow the autonomous build protocol, including durable task/work/review
  records and behavior-focused validation before completion.
- Use the isolated task worktree; only the assigned implementation owner writes
  the overlapping production scope.
- After a commit, the orchestration workflow must push the task branch and the
  integrated `main` branch immediately; the implementation owner may not
  commit, push, or merge.
- Preserve unrelated files and dirty-worktree content; never modify
  `human-review-1-jul.md`.
- Retain explicit assignment metadata: existing `implementer` role,
  `gpt-5.6-terra` model, and `medium` reasoning. Record the execution surface's
  runtime-metadata limitation when self-introspection is unavailable.

## TDD and Verification

1. Add the old-scope rejection test/gate and prove it fails on the baseline.
2. Perform the atomic rename and regenerate only deterministic artifacts
   required by the repository.
3. Run the namespace scan, frozen install, Proto/generator checks, build,
   package-resolution/declaration tests, examples, full repository test, docs
   check, release-readiness gate, and coverage gate at change-sensitive
   cadence.
4. Run relevant specialist review as one wave, return one correction batch,
   and re-review only affected concerns.

## Implementation Owner Assignment

- Existing role: `implementer`.
- Ownership: the complete T-0069 namespace cutover across the isolated
  worktree. It is the only production writer for this task.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Both fields must be explicit in dispatch.
- The owner must use behavior-first validation, preserve historical protocol
  evidence, avoid unrelated changes, and may not commit, push, merge, or spawn
  children.

## Review Concerns

- Style and maintainability: required for validation/script changes.
- Documentation: required for root/package/example/API guide replacements.
- TypeScript/API: required for package identities, exports, declarations, and
  generated imports.
- Performance/reliability: N/A unless the implementation changes runtime
  behavior; a concrete disposition is still required.
- Final security: N/A; no trust boundary or runtime behavior is intended.
