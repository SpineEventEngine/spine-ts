# T-0128: Cross-Platform Capacity, Replacement, And Wave Closure

Status: Reviewed and release-verified; integration pending

## Objective

Closes Wave 7 with reproducible evidence that one standalone Gateway follows
changing GKE- and GCE-discovered application nodes through scaling,
replacement, and restart, while every public deployment claim remains accurate
and no deferred Wave 8 capability leaks into the release.

The authoritative acceptance contract is T-0128 in
`build-protocol/planning/WAVE_7_SCALING_REDEPLOYMENT_PLAN.md`.

## Classification

High-risk. This task crosses dynamic routing, durable subscriptions, cloud
discovery, replacement semantics, load/capacity claims, examples, and public
deployment guidance. The approved Wave 7 plan resolves the architecture, so no
new requirements-splitter pass is required.

## Human-Imposed Requirements Ledger

1. Support GKE and GCE only; Cloud Run remains excluded.
2. Use exactly one standalone Gateway. Multiple Gateways belong to Wave 8.
3. Infrastructure platforms scale identical application versions; Spine TS
   discovers nodes but never performs scaling itself.
4. Cover scale up, scale down, zero nodes, return from zero, compatible rolling
   overlap, and incompatible stop-all/start-new replacement.
5. Preserve durable subscription definitions and Inbox work. Gateway
   replacement interrupts clients; clients reconnect and perform an
   authoritative query.
6. Exercise 32 expected nodes and at least 40 nodes, use every discovered node,
   and keep connection work bounded. This is measured/recommended capacity,
   never a hard runtime maximum.
7. Keep storage application-owned, pass external secret references only, and
   document that pending Inbox work may execute under new business logic.
8. Reconcile all root, architecture, deployment, package, and example guidance
   with the implemented GKE/GCE picture.
9. Do not add Cloud Logging, a public diagnostics API, multiple Gateways, a
   `validation-ts` update, storage-layout tuning, npm publication, JVM builds,
   or pushes to the future migration remote.
10. Push every feature-branch commit to `origin` immediately and preserve the
    dirty primary checkout and unrelated worktrees.

## Baseline And Isolation

- Baseline: `origin/main@3ca436b1`, with T-0127 integrated and post-merge
  verified.
- Branch: `task/T-0128-wave7-closure`.
- Worktree: `.worktrees/T-0128-wave7-closure`.
- The primary checkout remains protected and untouched.

## Acceptance Boundary

1. Add deterministic cross-platform acceptance scenarios using real framework
   discovery/routing/subscription components and controlled platform seams.
2. Prove scale up/down/zero/return for GKE DNS and GCE leased discovery,
   including unary routing and durable subscription reactivation.
3. Prove compatible old/new overlap, incompatible zero-node cutover, and
   Gateway restart with durable definitions, reconnect, and authoritative
   re-query semantics without inventing a compatibility handshake.
4. Add a reproducible capacity profile at 32 and 40 nodes that records its
   environment, bounded connection concurrency, measured results, and use of
   every discovered node.
5. Reconcile beginner documentation and package references with one Gateway,
   GKE/GCE-only deployment, platform-owned scaling, application-owned storage,
   external secret references, best-effort update notifications, and pending
   Inbox behavior.
6. Keep public API unchanged unless a demonstrated acceptance blocker requires
   a narrowly reviewed correction.

## Required Gates

- One existing implementer owns all overlapping fixtures, orchestration,
  documentation, and closure records. Expected explicit profile:
  `gpt-5.6-terra` / `medium`.
- Add RED-first tests and record the intended failures before implementation.
- Run the cheap affected-scope preflight before one complete review wave.
- All four canonical concerns are relevant. Style, TypeScript/API, and
  reliability use `gpt-5.6-terra` / `high`; documentation uses its immutable
  `gpt-5.6-luna` / `medium` role.
- Apply at most one accepted review-correction batch, then run one
  `pnpm verify:release` after convergence.
- Merge through a clean integration worktree, prove tree equality, post-merge
  verify, push `main`, and remove completed task/integration branches and
  worktrees.
