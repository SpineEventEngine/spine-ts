# T-0093: Standalone gateway host

Status: Ready for integration; implementation and specialist review complete
Start: `2026-08-02`
Baseline: `ef7912e1`
Branch: `task/T-0093-standalone-gateway`
Worktree: `.worktrees/T-0093-standalone-gateway`
Parent: `T-0089`

Classification: High-risk. This task changes production listener assembly,
authentication route isolation, request limits, backend forwarding, and
shutdown across Node and locked JVM-compatible service descriptors.

## Objective

Deepens the existing browser host into one standalone gateway in front of a
Spine TS or unmodified Spine JVM endpoint. It exposes only reserved Spine RPC
paths and explicitly registered bounded authentication routes, requires a
durable subscription registry in production, and closes intake before relays
and owned resources.

## Human-Imposed Requirements Ledger

| Requirement                                                    | Evidence                                        |
| -------------------------------------------------------------- | ----------------------------------------------- |
| Keep one gateway pipeline and no general router or health API. | `Server` composes the existing `BrowserServer`. |
| Never build or launch JVM code.                                | Fixture and wire checks are static only.        |
| Fail closed before standalone ownership/listener work.         | Server admission regressions.                   |
| Push verified checkpoints immediately.                         | Task branch history and work log.               |

## Acceptance Criteria

1. Production startup requires an explicit backend target, session and auth
   collaborators, durable subscription bindings and namespace, and fails
   before listener open when configuration is incomplete or volatile.
2. Command, Query, ResolveContext, Subscribe, Activate, and Cancel use the
   existing shared descriptors and policy in combined and standalone modes.
   Static locked JVM fixture evidence is used without building or modifying
   Spine JVM.
3. Every application auth route has one normalized exact method/path, finite
   body/time limits, and explicit origin policy. Duplicate, conflicting,
   wildcard, catch-all, and reserved Spine routes fail before listener open.
4. Reserved Spine paths always win. Unknown paths/methods and uncaught errors
   produce bounded non-leaking responses without backend or application work.
5. Auth handlers receive Fetch `Request` and `AbortSignal`. Timeout,
   disconnect, drain, and shutdown cancel work; bodies are bounded before
   buffering.
6. OAuth callbacks may explicitly accept a missing browser `Origin`, while
   application code remains responsible for OAuth state verification. Other
   origins follow exact allowlists.
7. Envoy exposes only the same reserved Spine and registered auth method/path
   surface with matching origins and limits.
8. Close stops intake first, aborts relays/routes, then closes registry and
   backend resources without leaks or duplicate closure.
9. No general router, catch-all, second gateway pipeline, deployment CLI,
   storage selector, application health API, Wave 6 subscription propagation,
   npm publication, or Spine JVM build is introduced.

## Requirements Splitter Dispatch

- Existing role: `requirements_splitter`.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: high.
- Both fields must be explicit. Runtime metadata is recorded when exposed;
  otherwise the immutable configured role/profile and limitation are evidence.
- Scope: produce the smallest dependency-ordered RED/implementation split,
  exact route/configuration/lifecycle invariants, file ownership, compatibility
  fixture checks, review concerns, and verification gates without expanding
  C1.

## Implementation And Review Profiles

- One existing `implementer`: `gpt-5.6-terra` / medium, explicit.
- Style/maintainability, TypeScript/API, and performance/reliability reviewers:
  existing roles, `gpt-5.6-terra` / high, explicit.
- Documentation reviewer: existing role, `gpt-5.6-luna` / medium, explicit.
- Runtime metadata limitations and every result must be recorded before
  acceptance. Final security remains the parent Wave 5 G1 gate.

## Immediate Next Action

The requirements split is accepted in
`build-protocol/planning/T-0093_STANDALONE_GATEWAY_SPLIT.md`. Dispatch one
implementation owner with deterministic request/routing/lifecycle tests.

## Requirements Splitter Result

- Existing role: `requirements_splitter`.
- Expected and explicitly dispatched profile: `gpt-5.6-sol` / high.
- Runtime self-introspection was unavailable; the immutable configured profile
  is the accepted metadata and no visible mismatch or fallback occurred.
- No governing conflict was found. The split deepens the existing host,
  selects standalone mode with `browser.backend`, and adds no runner/router or
  duplicate namespace configuration.

## Final Verification

- All four applicable specialist concerns are clean. Runtime self-introspection
  was unavailable; every dispatch used its explicitly required immutable role,
  model, and reasoning profile, with no visible mismatch or fallback.
- `pnpm --config.verify-deps-before-run=false verify:release` passes at
  `748d2476`. The repository totals are 94.16% statements, 90.06% branches,
  94.60% functions, and 95.04% lines.
- `pnpm test:envoy` passes 4/4, including acceptance and deliberate rejection
  checks against the pinned Envoy image.
- T-0093 is ready for a no-fast-forward merge into `main`, followed by the
  change-sensitive post-merge verification required by the parent task.
