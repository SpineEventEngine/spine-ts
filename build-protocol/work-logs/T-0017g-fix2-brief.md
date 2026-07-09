# T-0017g Second Fix Brief

## Objective

Close the remaining targeted style and documentation findings after the first
fix re-review.

## Required Fixes

1. Move local process-manager inbox handoff mechanics out of
   `packages/server/src/context/bounded-context.ts`.
   - Create a dedicated internal module under a semantic package folder.
   - Keep `BoundedContext` limited to construction and registration.
   - Preserve behavior and tests.

2. Shorten the new process-manager inbox/replay vocabulary.
   - Replace five-component names such as
     `RepositoryProcessManagerInboxTarget`,
     `createProcessManagerInboxTarget`,
     `validateProcessManagerReplayTenant`, and
     `validateProcessManagerReplayTarget`.
   - Keep names explicit enough for the local context.

3. Fix stale docs.
   - `docs/api/README.md` must not say the current slice does not manage any
     inbox/delivery behavior. It should say the only supported durable handoff
     is framework-owned process-manager command handoff; broader delivery
     lifecycle management remains deferred.
   - `packages/server/README.md` must not say durable inbox handoff is entirely
     outside the local runtime slice.

## Verification Required

- Focused repository routing tests.
- `pnpm --config.verify-deps-before-run=false format:check`
- `git diff --check`
- Docs check if docs wording changes materially.
