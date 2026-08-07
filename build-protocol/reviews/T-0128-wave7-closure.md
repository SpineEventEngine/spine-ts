# T-0128 Review Record

Status: Clean; integrated and post-merge verified

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
   through every discovered node, rather than proving all-node routing only at 40.
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

## Focused re-review

- Documentation: clean. Dynamic GKE/GCE discovery, local versus GKE container
  settings, and measured 32/40-node claims are consistent.
- Style/maintainability: clean. Both capacity cases route through every node
  with a two-start bound; dead configuration is removed; private-envelope
  naming and ownership are coherent.
- TypeScript/API and reliability: the production correction is clean, but both
  lanes found the same stale direct native-adapter test. `native-relay.test.ts`
  still passes `PublicSubscriptionWire` to the newly private activation seam.
  Vitest transpilation hides the error; strict test typechecking reports
  `TS2322`. The test must activate with the backend envelope returned by
  Subscribe and retain the public wire only where its public contract applies.
- Reviewer runtime introspection remained unavailable. All immutable configured
  role/profile metadata matched the recorded explicit dispatches.

This test-only deterministic correction does not reopen documentation or style.
API and reliability receive a final focused disposition after strict tooling
and the native relay suite pass.

## Final API/reliability disposition

- Resolved. The direct `NativeSubscriptionCreator` flow now asserts that
  Subscribe returns a `BackendSubscriptionEnvelope` with the native bytes and
  passes that exact envelope to Activate. Its public wire remains scoped to
  Subscribe and Cancel.
- `pnpm typecheck:tooling` passed, eliminating the reported `TS2322`; native
  relay plus dynamic creator/forwarder tests passed 68/68. This deterministic
  test-only correction does not reopen the already-clean documentation or style
  lanes.
- Final TypeScript/API review: clean. The reviewer independently confirmed the
  strict tooling typecheck, the 68/68 focused tests, the native-envelope flow,
  and the absence of a Protobuf, package-export, or package-metadata delta.
- Final performance/reliability review: clean. The reviewer independently
  reproduced the strict tooling typecheck, the 68/68 focused tests, and a clean
  diff, and accepted the backend-envelope ownership and lifecycle behavior.
- Runtime-model introspection was unavailable for both final dispositions. The
  immutable configured reviewer profiles remained `gpt-5.6-terra` / `high`,
  with no visible mismatch.

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

## Release verification

- After the complete affected-scope preflight passed, `pnpm verify:release`
  passed all generated, build, tooling, lint, cleanup, TSDoc, formatting,
  documentation/API, Proto, package-readiness, test, and coverage stages.
- Vitest reported 201 passing files / 3 skipped and 3,982 passing tests / 26
  skipped. Coverage was 94.08% statements, 90.13% branches, 94.58% functions,
  and 95.10% lines.
