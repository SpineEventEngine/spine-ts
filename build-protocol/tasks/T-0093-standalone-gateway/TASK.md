# T-0093: Standalone gateway host

Status: Active
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

Dispatch the existing requirements splitter, accept the bounded plan, then use
one implementation owner with deterministic request/routing/lifecycle tests.

