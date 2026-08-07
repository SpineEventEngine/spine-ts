# T-0128 Review Record

Status: Implementation in progress

## Required Concerns

- Style and maintainability: cross-platform fixture depth, ownership, naming,
  duplication, deterministic orchestration, and durable tests.
- Documentation: beginner sequence, cross-platform consistency, measured
  capacity claims, replacement/restart limitations, exclusions, and examples.
- TypeScript/API: current public imports, snippets, package boundaries,
  declarations, and absence of accidental diagnostics or Wave 8 API.
- Performance and reliability: scale churn, zero/return, generation fencing,
  subscription reactivation, replacement, bounded connection concurrency,
  32/40-node evidence, and cleanup/lifecycle behavior.
- Security: dedicated final security review remains deferred to the project
  release gate. This task still checks private topology and external secret
  references deterministically.

## Implementation Dispatch Metadata

The existing implementer receives exclusive ownership of the T-0128
acceptance/load fixtures, example orchestration, root and deployment docs, and
task records. Expected and explicit profile: `gpt-5.6-terra` / `medium`.
Runtime metadata is recorded if exposed; otherwise the immutable configured
role/profile and absence of a visible mismatch remain the acceptance evidence.

## Review Dispatch Metadata

Mechanical verification precedes one complete concern-specific review wave.
Style, TypeScript/API, and reliability reviewers use their existing roles with
explicit `gpt-5.6-terra` / `high`. Documentation uses the existing immutable
`gpt-5.6-luna` / `medium` role with `medium` explicit. Actual runtime metadata
is recorded where available; missing self-introspection alone does not
invalidate a result.

Actual runtime-model introspection was unavailable in all four lanes. Each
review ran under its immutable configured role/profile with no visible
mismatch: style/maintainability, TypeScript/API, and reliability used explicit
`gpt-5.6-terra` / `high`; documentation used explicit
`gpt-5.6-luna` / `medium`.

## Implementation acceptance evidence

- The T-0128 profile selects executable deterministic evidence for both platform
  discovery seams, dynamic subscription reactivation, durable Gateway restart
  recovery, client authoritative re-query after reconnect, and compatible versus
  incompatible replacement. The shared fixture does not add a compatibility
  handshake, diagnostics API, second Gateway, or runtime API change.
- Message Board Compose/Kubernetes policy coverage now guards one Gateway,
  explicitly local static Compose backends, and Kubernetes GKE discovery.

## Review wave one

The complete concern wave produced one correction batch:

1. TypeScript/API and reliability: private per-node backend subscription bytes
   must cross an explicitly typed `BackendSubscriptionEnvelope` activation
   seam, not be relabelled as `PublicSubscriptionWire`. Keep the public
   coordinator/binding definition boundary unchanged and retain defensive
   copying.
2. Documentation: remove the stale browser-guide paragraph that describes a
   fixed 1–32 topology; reconcile it with dynamic GKE/GCE discovery and the
   measured 40-node profile.
3. Style/maintainability: make both the 32- and 40-node capacity cases forward
   through every discovered node, rather than proving all-node routing only at
   40.
4. Style/maintainability: remove unused `LOCAL_STATIC_BACKENDS` configuration
   and its locking assertion; documentation already identifies static Compose
   as local-only.
5. Style/documentation: update the container guide to distinguish local
   `BACKEND_URLS`/legacy `BACKEND_URL` from production GKE
   `BACKEND_DISCOVERY_SERVICE`/`BACKEND_DISCOVERY_PORT`.

No other finding was reported. API docs passed, focused API/deployment tests
passed 85/85, focused reliability auth tests passed 58/58, and style
`git diff --check` passed. Corrections affect all four concerns, so each lane
receives one focused re-review after the single implementation batch.

## Review-correction evidence

- The `SubscriptionCreator` native-child seam now requires a
  `BackendSubscriptionEnvelope` for activation. The public
  `SubscriptionCoordinator` and `SubscriptionGateway` continue to retain and
  rewrite `PublicSubscriptionWire` definitions. RED observed the prior
  `public-subscription` label at both distinct native children; GREEN verifies
  copied backend-envelope labels and opaque per-node bytes.
- The 32/40 bounded-start cases retain `maxConcurrentStarts: 2` and now prove
  every discovered node receives a round-robin forward. The stale 1–32 guide
  claim and the unused `LOCAL_STATIC_BACKENDS` setting/assertion are removed.
- The container guide distinguishes local fixed URLs from GKE service discovery.
  Focused auth tests passed 58/58; Compose topology and image-builder source
  checks passed 7/7; `pnpm typecheck:build`, API-doc, documentation-audience,
  formatting, and diff checks passed. No full Docker rerun was needed because
  the correction changes a typed native envelope seam covered by the focused
  opaque-envelope behavior test.
