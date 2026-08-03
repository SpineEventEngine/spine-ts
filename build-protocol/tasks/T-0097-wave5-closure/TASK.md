# T-0097: Wave 5 documentation and release closure

Status: Ready for integration
Start: `2026-08-03`
Baseline: `0f47c634`
Branch: `task/T-0097-wave5-closure`
Worktree: `.worktrees/T-0097-wave5-closure`
Parent: `T-0089`

Classification: High-risk release closure. This task reconciles production
deployment claims, authentication and persistence trust boundaries, final
security review, real container acceptance, and repository-wide verification.

## Objective

Completes human and agent documentation for the accepted Wave 5 runtime,
reconciles every child task, passes final security and release acceptance, and
integrates the fully verified Wave into `main` with remote synchronization.

## Human-Imposed Requirements Ledger

- Document `Server.run()` versus caller-managed `start()`, combined versus
  standalone eligibility, listener-only TCP readiness, graceful shutdown, and
  the resources closed by `ServerEnvironment`.
- Document bounded auth routes/origins, shared signing and revocation,
  authentication trust boundaries, durable subscription registry ownership,
  finite leases/cleanup, failover limits, and reconnect plus authoritative
  re-query requirements.
- State that application code selects and shares its storage; gateway registry
  storage is separately configured; the single simple delivery server is
  in-memory, non-durable, non-HA, and exactly one replica.
- Preserve both small-production topology choices while requiring standalone
  gateway mode for multiple application replicas.
- Do not add health endpoints, Helm, an operator, deployment CLI, storage
  selector, durable delivery-server mode, Redis/Hazelcast, publication, or Wave
  6 notification-completeness guarantees.
- Do not build or modify Spine JVM. Use only locked descriptors/fixtures.
- Never read or change either protected human-review file. Preserve unrelated
  user work and push every feature commit immediately.

## Acceptance Criteria

1. Affected human READMEs/guides and agent REFERENCES teach the final lifecycle,
   deployment, storage, auth, durability, readiness, and limitation contracts
   without internal task/wave jargon in public prose.
2. Commands, links, snippets, exports, package/assets, local images, Compose,
   Kubernetes, prohibited claims, and generated artifacts pass deterministic
   checks from a clean build state.
3. Final native acceptance passes combined and standalone lifecycle/failover,
   local image contracts, graceful shutdown, and leak scans without a JVM build.
4. All four canonical specialist concerns converge. The existing final
   security reviewer finds no unresolved P0-P2 risk in authentication,
   persistence, routing, container, and deployment trust boundaries.
5. One final `verify:release` passes after review convergence. The reviewed
   branch is merged into `main`, change-sensitive post-merge verification
   passes, and all intended remote refs are synchronized.

## Planning Disposition

The approved G1 split in `build-protocol/planning/WAVE_5_EXECUTION_SPLIT.md`
already defines this exact final boundary. No new subsystem, contract, or human
decision exists, so another requirements-splitter pass would duplicate accepted
planning.

## Implementation Owner Dispatch

- Existing role: `implementer`.
- Scope: affected public human and agent documentation, status/release records,
  deterministic claim/command checks, and only corrections demonstrated by
  those checks. No new runtime capability.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: medium.
- Both fields must be explicit. The owner must not spawn subagents, touch
  protected files, build JVM, publish, or broaden Wave 5 guarantees.

## Review Assignments

- Style/maintainability: existing reviewer, `gpt-5.6-terra` / high.
- Documentation completeness: existing reviewer, immutable
  `gpt-5.6-luna` / medium.
- TypeScript/API documentation: existing reviewer,
  `gpt-5.6-terra` / high.
- Performance/reliability: existing reviewer, `gpt-5.6-terra` / high.
- Final security: existing final security reviewer,
  `gpt-5.6-terra` / high.

Runtime metadata is recorded when exposed. Otherwise immutable configured
profiles and the surface limitation are the acceptance evidence; explicit
field omission, visible mismatch, or inherited fallback requires redispatch.

## Verification Strategy

Run deterministic docs/status/claim checks and focused topology/container
acceptance before review. After one converged correction batch and final
security, run `verify:release` exactly once. Post-merge verification is
change-sensitive and may reuse byte-identical reviewed-tree evidence.
