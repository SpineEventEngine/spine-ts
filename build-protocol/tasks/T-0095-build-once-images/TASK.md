# T-0095: Build-once packages and local images

Status: Requirements split active
Start: `2026-08-02`
Baseline: `1c53cbdf`
Branch: `task/T-0095-build-once-images`
Worktree: `.worktrees/T-0095-build-once-images`
Parent: `T-0089`

Classification: High-risk. This task changes package/install boundaries,
production entrypoints, container process ownership, and release verification.

## Objective

Builds Spine TS application and infrastructure artifacts exactly once, then
starts combined or application-only MessageBoard runtime and standalone gateway
or simple delivery-server images without generation, compilation, workspace
traversal, or monorepo rebuild at startup.

## Human-Imposed Requirements Ledger

- A fresh application repository installed from packed dependencies must run
  `spine-proto generate`, `compose`, and `handlers` during its build and start
  installed runtime output without relying on this monorepo.
- The same MessageBoard application code and artifacts must support combined
  gateway/application and application-only modes through explicit entrypoints.
- Storage remains selected by application code. Container or deployment
  infrastructure must not choose MySQL, Datastore, or in-memory storage.
- MessageBoard may use the Datastore emulator in tests; production configuration
  remains an application concern.
- Build standalone gateway and the existing in-memory simple delivery server as
  local images from pinned workspace artifacts. Do not publish packages/images.
- Node receives process signals directly. Shutdown is bounded. Secrets are not
  baked into images. Startup performs no generation, TypeScript compilation, or
  monorepo rebuild.
- Compose and Kubernetes topology files belong to dependent T-0096, not this
  task. Do not build, launch, patch, or vendor Spine JVM.
- Preserve protected human-review files and unrelated user work. Push every
  feature-branch commit immediately.

## Acceptance Criteria

1. Packed-tarball acceptance proves a fresh install can generate/compose
   Protobuf and handlers at build time, compile once, and start installed output.
2. One MessageBoard artifact starts in combined or application-only mode without
   domain-code changes or runtime build tools.
3. Standalone gateway and simple delivery server local images build and pass
   bounded start/stop checks from pinned artifacts.
4. Production images contain required generated assets while excluding build
   caches, development-only inputs, and embedded secrets where practical.
5. Process ownership and shutdown are documented and tested; Node receives
   termination signals directly.
6. All relevant review lanes converge and the task passes its cheap preflight,
   local package/image acceptance, and one final `verify:release` gate.

## Requirements Splitter Dispatch

- Existing role: `requirements_splitter`.
- Scope: freeze build/install/runtime artifact boundaries, entrypoints, Docker
  ownership, RED acceptance tests, capability precheck, exact file ownership,
  and review/verification gates without entering T-0096 topology scope.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: high.
- Both fields are explicit in dispatch. Runtime metadata will be recorded when
  exposed; otherwise the immutable configured role/profile and limitation are
  the available acceptance evidence.

