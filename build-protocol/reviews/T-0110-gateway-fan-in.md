# T-0110 Review Record

## Review Endpoint

- Branch: `task/T-0110-gateway-fan-in`.
- Endpoint: `5669501a`.
- Focused `verify:task --no-coverage` passes all Node, Proto, generated build,
  tooling TypeScript, ESLint, cleanup, TSDoc, formatting, API/audience docs,
  Proto freshness, release-readiness gates, and 368 focused tests.

## Review Assignments

| Concern                     | Existing role                      | Explicit profile                    | Scope                                                                                                           |
| --------------------------- | ---------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Style and maintainability   | `style_maintainability_reviewer`   | `gpt-5.6-terra` / `high`            | Deep-module placement, naming, lifecycle ownership, compatibility, and unnecessary abstractions.                |
| TypeScript and API          | `typescript_api_docs_reviewer`     | `gpt-5.6-terra` / `high`            | Public config/exports, TSDoc, source compatibility, frozen Proto use, and durable internal contract.            |
| Performance and reliability | `performance_reliability_reviewer` | `gpt-5.6-terra` / `high`            | Bounds, fan-out compensation, child-loss joining, cancellation, persistence fencing, races, and byte ownership. |
| Documentation               | `documentation_reviewer`           | immutable `gpt-5.6-luna` / `medium` | Human/agent docs and Message Board configuration claims affected by this task.                                  |

All assignments explicitly set model and reasoning. Runtime self-introspection
may be unavailable; the immutable configured role/profile is accepted absent a
visible mismatch. Reviewers may not edit or spawn children. One complete finding
batch returns to the existing implementation owner.

## Security Disposition

N/A for a separate final security review. T-0110 does not move the existing
browser-to-Gateway or Gateway-to-native trust boundaries, forward credentials,
change authentication/authorization, or expose backend topology/envelopes to
browser callers. It only fans trusted native calls across a fixed bounded set;
security-sensitive endpoint validation and generic loss-message leakage remain
inside the API and reliability review scopes.

## Complete Review Wave Results

All four assigned roles completed. Runtime self-introspection was unavailable
for every lane; each immutable explicitly dispatched profile matched its
recorded role with no visible fallback.

### Consolidated correction batch

1. **P1 — partial-create compensation:** fan-in rollback must not reuse the
   already-aborted request signal. Use a fresh bounded cleanup signal and prove
   cleanup after timeout/close once an earlier child succeeded.
2. **P1 — aggregate allocation bound:** enforce the configured aggregate
   backend-envelope byte cap with safe arithmetic while summing child results,
   before allocating the composite, and compensate successful children.
3. **P1 — exact loss notice:** client-web must suppress only the generic
   `backend-unavailable` error-only notice. Other error-only updates retain
   their prior delivery behavior. Prove a healthy update after one child loss.
4. **P1 — valid Kubernetes topology:** replace duplicate service URLs with two
   distinct stable application-node endpoints and validate the configured value
   through Gateway configuration tests.
5. **P2 — exclusive backend API:** make `baseUrl` and `baseUrls` mutually
   exclusive in TypeScript and reject both/neither at runtime.
6. **P2 — topology-fencing capability:** document persistence/equality and the
   `legacy` default. A custom durable store used for standalone fan-in must
   explicitly declare topology-fencing support; the built-in durable store does.
7. **P2 — required proofs:** add focused abort rollback, aggregate cap,
   child-loss/healthy continuation, and actual durable matching/reordered/
   missing-topology tests.
8. **Documentation:** teach preferred `BACKEND_URLS` plus legacy fallback in
   Message Board app/container docs; document `baseUrls`, 1–32 bounds,
   round-robin/no-retry, fan-out, best-effort duplicates/loss, topology fencing,
   and authoritative re-query in server README/reference and browser guide.
   Correct public TSDoc accordingly.

No other style, naming, placement, frozen Proto, or trust-boundary finding was
reported. One correction pass returns to the existing implementer; only
substantively affected reliability/API/docs concerns require confirmation.

## Correction Endpoint And Confirmation

- Review corrections converge at `c538e649`. They add fresh bounded rollback,
  pre-allocation caps, exact notice discrimination, exclusive configuration,
  topology-fencing capability, stable Kubernetes endpoints, all requested
  regressions, and user/agent/public documentation.
- Fresh focused `verify:task --no-coverage` passes every deterministic gate and
  374 tests. The style findings are deterministically closed by Gateway-validated
  manifest/config tests and the exact-notice client regression.
- Narrow confirmation returns only to the existing API and reliability roles
  under explicit Terra/high and documentation under immutable Luna/medium.
  Runtime metadata handling is unchanged; reviewers remain read-only and may not
  spawn children.

## Narrow Confirmation Results

- Reliability confirms aggregate caps/compensation, exact loss with healthy
  continuation, durable topology variants, cancellation, and bounds. One P1
  remains: fresh rollback cleanup is not time-bounded when `dispose()` ignores
  abort. Add a finite timeout/race and non-cooperative regression.
- API confirms exact notice and exclusive backend configuration. One P2 remains:
  `SubscriptionBindings` does not publicly declare/document its
  `topologyFencing: true` capability, lifecycle topology persistence/equality,
  or the Gateway's `legacy` default; BrowserServer relies on a cast.
- Documentation confirms Kubernetes, Message Board, server README/reference,
  and main fan-in guidance. Three exact sentences remain: remove the stale
  cross-node contradiction, state no automatic unary retry, and make
  BrowserBackend's URL wording plural-aware.
- One final bounded correction returns to the existing Terra/medium owner. Only
  reliability, API, and documentation receive finding-specific confirmation.

## Final Confirmation Endpoint

- `db597327` adds finite non-cooperative rollback proof, clears completed cleanup
  timers, documents the public topology capability/lifecycle/default contract,
  and corrects the three exact guide/TSDoc sentences. `ca22ecd2` records the
  evidence.
- Fresh focused preflight passes every deterministic gate and 375 tests.
- Reliability, API, and documentation receive final confirmation of only their
  previously remaining findings.

## Final Confirmation Results

- Documentation is clean for the requested scope; topology manifest tests pass
  8/8.
- API is clean except one exact TSDoc sentence: omission of
  `SubscriptionGatewayOptions.topology` must state its runtime `legacy` default.
- Reliability confirms finite non-cooperative timeout behavior but finds one P1
  synchronous-throw edge: direct `dispose()` invocation during `map()` can stop
  later child cleanup calls from starting. Put each call behind a promise
  boundary and prove later compensation after an earlier synchronous throw.
- These two deterministic changes return once to the existing implementer. API
  and reliability receive final exact confirmation; documentation is closed.
