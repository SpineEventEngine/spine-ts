# T-0215 review

## Concern wave

- TypeScript/API documentation: explicit public access contract, session
  compatibility, declarations, TSDoc, and no accidental wire expansion.
- Performance/reliability: cancellation, expiry, process loss, restart,
  durable cleanup contention, queue bounds, and shutdown.
- Style/maintainability: one clear access model without sentinel timestamps or
  example-only bypasses.
- Documentation: beginner explanation of public versus authenticated access and
  cancellation behavior.

The changed behavior includes an explicit unauthenticated public Gateway mode,
so the final security reviewer is required after the specialist finding batch
converges. Review dispatch and dispositions are recorded here as they complete.

## 2026-08-20 dispatch

- Review baseline: `fb79e3a4b637b44bc7ec7a5c03fb8dde1c19e102`.
- Review head: `e46c88df`.
- Performance/reliability: existing `performance_reliability_reviewer`, explicit
  configured `gpt-5.6-terra` / `high`; cancellation, timers, purge
  single-flight, shutdown, retry, and bounded-resource behavior.
- TypeScript/API documentation: existing `typescript_api_docs_reviewer`,
  explicit configured `gpt-5.6-terra` / `high`; public declarations,
  compatibility, trust-mode exclusivity, TSDoc, and user-facing claims.
- Style/maintainability: existing `style_maintainability_reviewer`, explicit
  configured `gpt-5.6-terra` / `high`; ownership depth, duplicated lifecycle
  facts, error flow, naming, and test maintainability.
- Runtime telemetry may be unavailable. In that case, each existing role's
  immutable configured profile and the telemetry limitation are the recorded
  evidence. Every review is read-only and subagent spawning is prohibited.

## First-wave findings and dispositions

- **API P1 — accepted:** public mode permitted caller-supplied bindings even
  though durable authenticated bindings require an expiry. Public browser
  options now reject supplied bindings in TypeScript and at the runtime
  validation boundary; Browser Server always owns its process-local public
  bindings.
- **API P2 — accepted:** option declarations allowed both or neither admission
  mode. Unary, Subscription, and Browser options now encode the exact XOR.
  Downstream GCE/GKE example aliases use distributive omission so they preserve
  the admission discriminator without changing deployment behavior.
- **API P2 — rejected as not a defect:** the shared handshake fact is available
  through `@spine-event-engine/core/internal/subscription-lifecycle`. Core is a
  private workspace package; the symbol is absent from the root API, marked
  `@internal`, and explicit `./internal/*` subpaths are an established package
  convention in Core, Deployment, Server, and Storage. Relocating it would
  duplicate the fact or create a package for one constant.
- **Reliability P2 — accepted:** duplicate same-horizon purge calls could add a
  second 25-row pass. The active horizon is now explicit; equal or older calls
  join without scheduling work, while one genuinely later horizon is retained.
- **Maintainability P2 — accepted:** public TypeDoc still used session-only
  “authenticated” terminology. Comments now describe admission and authorization
  across both modes.
- Runtime metadata was unavailable for every reviewer; the immutable configured
  role/profile recorded in the dispatch section is the evidence.

## Correction evidence

- Retained purge RED removed 26 rows instead of the bounded 25; GREEN removes
  25 while the duplicate caller joins the same result.
- Retained Browser Server RED accepted supplied public bindings; GREEN rejects
  them before opening a listener.
- `@ts-expect-error` declaration proofs were RED as unused directives; the XOR
  declarations make both/neither and public-with-bindings invalid.
- Full generated build, repository tooling typecheck, changed-file ESLint, and
  the affected 300-test wave pass after correction.

## 2026-08-20 affected re-review dispatch

- Correction head: `13948d73`.
- The same existing reliability, TypeScript/API, and maintainability reviewer
  contexts re-check only their accepted findings and the documented internal-
  subpath disposition.
- Their explicit configured profiles remain `gpt-5.6-terra` / `high`; runtime
  telemetry limitations remain recorded. Re-review is read-only and subagent
  spawning remains prohibited.

## 2026-08-20 final correction implementation assignment

- Existing `implementer` role, explicit configured `gpt-5.6-terra` / `medium`,
  owns the bounded correction for failed-purge horizon retention and public API
  documentation discoverability.
- Runtime telemetry is not exposed by the execution surface. The immutable
  configured role/profile above is the acceptance evidence.

## 2026-08-20 affected re-review findings and correction

- **Reliability P2 — accepted:** if an active expiry scan failed after a
  coalesced caller requested a later cutoff, retrying an older cutoff overwrote
  the pending later cutoff. The durable owner now starts with the greater of
  its retained pending cutoff and the retry cutoff. The regression first proved
  the loss (only the first expiry was removed), then proves both expiries are
  removed after the retry.
- **TypeScript/API P2 — accepted:** the public option aliases referenced private
  admission constituents, so generated API documentation did not present the
  two usable shapes. `GatewayAdmission` and `BrowserAdmission` are now exported
  and fully documented. The Auth and Server root export inventories were
  deliberately updated; this is a public declaration/documentation correction,
  not a behavioral widening. Public Browser admission still prohibits supplied
  bindings.
- **Documentation finding — accepted:** Auth reference and GCE/GKE standalone
  Gateway guidance now distinguish authenticated supplied durable bindings from
  public framework-owned process-local bindings. Server reference wording now
  makes the same ownership distinction.
- **Internal subpath disposition — unchanged/rejected:** it remains a private
  Core package convention and is unrelated to this correction.

## 2026-08-20 final affected re-review dispatch

- Correction head: `31e8c35f`.
- Estimated review effort: 0.5–1 hour for the three affected concerns, including
  a bounded deterministic correction if a reviewer confirms one.
- The existing reliability, TypeScript/API, and maintainability reviewers
  re-check only the failed-purge cutoff, the two intentional public admission
  exports, and the corrected Auth/Server/GCE/GKE explanations.
- Every reviewer retains its explicit configured `gpt-5.6-terra` / `high`
  profile. Runtime telemetry may be unavailable; the immutable configured
  role/profile is then the recorded evidence. Re-review is read-only and
  subagent spawning is prohibited.

## 2026-08-20 final affected re-review findings

- **Reliability — pass:** the greatest coalesced purge cutoff survives a failed
  pass and retry; duplicate cutoffs remain bounded, later cutoffs execute, and
  close joins. Focused durable evidence passes 44/44.
- **API P2 — accepted:** the public admission types are visible, but the
  collaborator intersections used by Unary and Browser option pages remain
  hidden from TypeDoc. The complete usable option shape must be visible.
- **API P2 — accepted:** Auth reference incorrectly calls `ResolveContext`
  authenticated-only. Public admission resolves trusted context without a
  session expiry.
- **Maintainability P2 — accepted:** the public admission TSDoc attributes
  trusted-context establishment to authorization instead of distinguishing
  authorization from the required context resolver.
- Final bounded wording/type-presentation correction estimate: 0.5–1 hour,
  owned by the existing `implementer` with explicit configured
  `gpt-5.6-terra` / `medium`. Runtime telemetry may be unavailable; the
  immutable configured profile remains the evidence.

## 2026-08-20 declaration and wording correction

- Correction head: `cec1ae2b`.
- The documented Auth and Server collaborator types now make the complete
  public option shapes visible. Auth reference documents public
  `ResolveContext` without session expiry, and admission TSDoc separates
  authorization from trusted-context resolution.
- Focused Unary/Browser proofs pass 148/148. API inventory, audience, snippets,
  TSDoc, changed-file ESLint, formatting, and diff hygiene pass.
- Final affected API and maintainability re-review estimate: 0.25–0.5 hour.
  Both existing reviewers retain explicit configured `gpt-5.6-terra` / `high`
  profiles; runtime telemetry may be unavailable.

## 2026-08-20 final narrow re-review findings

- **API/maintainability P2 — accepted:** `SubscriptionGatewayOptions` still
  references a private collaborator declaration, and public
  `BrowserServerCollaborators` still references private `BrowserBackend`.
  Both constituent shapes must be visible and navigable in generated TypeDoc.
- **Documentation P2 — accepted:** one Auth reference sentence still attributes
  trusted-context reconstruction to authorization rather than the separate
  context resolver.
- Final local correction estimate: 15–30 minutes, including TypeDoc generation,
  API inventory, typecheck, and focused checks; no unrelated work is included.

## 2026-08-20 option-constituent correction

- Correction head: `85db55b6`.
- `SubscriptionGatewayCollaborators` and `BrowserBackend` are exported,
  documented, registered in API inventories, and navigable from their public
  option contracts. Auth reference assigns trusted-context reconstruction to
  `ContextResolver`.
- Generated/tooling typechecks, 148 focused proofs, API inventory (109 Auth / 250
  Server), audience, snippets, TSDoc, ESLint, formatting, and diff hygiene pass.
- Final narrow API/maintainability re-review estimate: 5–10 minutes. Both
  reviewers retain explicit configured `gpt-5.6-terra` / `high` profiles.

## 2026-08-20 specialist convergence

- **Reliability — pass:** no P0–P2 findings; focused durable suite passes 44/44.
- **TypeScript/API — pass:** every component of Unary, Subscription, and Browser
  options is root-exported, inventory-checked, and navigable in TypeDoc. XOR
  admission and the public binding prohibition remain intact.
- **Maintainability/documentation — pass:** Auth reference correctly separates
  authorization from trusted-context resolution, and the exported collaborator
  contracts are clear.
- Final security review estimate: 0.5–1 hour. The existing security reviewer is
  assigned only the public admission/trust boundary, lifetime/cancellation,
  bounded-resource behavior, and absence of public persisted bindings.
- The existing documentation reviewer runs in parallel for an estimated
  15–30 minutes, checking only beginner clarity and accuracy of the affected
  public/authenticated subscription guidance. Its explicit configured profile
  is `gpt-5.6-luna` / `medium`; runtime telemetry may be unavailable.

## 2026-08-20 documentation and security findings

- **Documentation P2 — accepted:** Auth reference must name the exact 30-second
  incomplete activation handshake and state that active public subscriptions
  have no framework TTL.
- **Security P2 — accepted:** Message Board authorization permits actorless
  public requests, after which context resolution throws and native adapters
  surface an internal failure. Authorization must reject a missing/blank actor
  before context resolution; regressions must prove no backend forwarding,
  binding creation, or internal-error response.
- No P0/P1 findings. The remaining public/session separation, context rewrite,
  binding ownership, timers/cancellation, request/queue bounds, and logging
  surfaces passed security review.
- Final correction estimate: 0.5–1 hour, including RED/GREEN behavior tests,
  exact documentation, affected security/docs re-review, and push.

## 2026-08-20 security/documentation correction

- Correction head: `9189e9e7`.
- Actorless and whitespace-only public Read, Subscribe, Activate, and Cancel now
  fail with permission denial before context resolution, forwarding, or binding
  creation. Auth reference names the 30-second incomplete activation cleanup and
  states that active public streams have no framework TTL.
- Focused evidence passes 118/118 together with generated/tooling typechecks,
  API inventory, audience, snippets, TSDoc, ESLint, formatting, and diff checks.
- Affected security/documentation re-review estimate: 10–20 minutes. Existing
  reviewer profiles remain security `gpt-5.6-terra` / `high` and documentation
  `gpt-5.6-luna` / `medium`; runtime telemetry may be unavailable.

## 2026-08-20 security/documentation re-review

- **Security — pass:** actorless and whitespace-only public operations are
  denied before context resolution, forwarding, or binding work; no P0–P2
  findings remain.
- **Documentation P1 — accepted:** Auth reference overgeneralizes the 30-second
  pending-activation cleanup to all modes. It applies only to public mode;
  authenticated durable subscriptions retain session-derived expiry.
- Exact documentation correction estimate: 5–10 minutes, including deterministic
  documentation checks, push, and narrow documentation re-review.

## 2026-08-20 final review disposition

- **Security — pass:** public actor validation now fails closed before context
  resolution, forwarding, or binding work; no P0–P2 findings remain.
- **Documentation — pass:** public pending activation cleanup is accurately
  documented as 30 seconds, active public streams have no framework TTL,
  authenticated durable definitions use session-derived expiry, and public
  definitions are process-local.
- All relevant specialist, security, and documentation concerns have converged.

## 2026-08-20 final TypeDoc correction implementation assignment

- Existing `implementer` role, explicit configured `gpt-5.6-terra` / `medium`,
  owns public collaborator visibility and wording corrections. Runtime telemetry
  is unavailable; the immutable configured role/profile is the acceptance
  evidence.

## 2026-08-20 final TypeDoc correction disposition

- **API P2 — accepted:** `UnaryGatewayCollaborators` and
  `BrowserServerCollaborators` are now public, documented constituents of their
  option intersections. Their root-export inventories intentionally changed so
  TypeDoc presents all common fields alongside the mutually exclusive admission
  shapes. Runtime behavior did not change.
- **API P2 — accepted:** public `ResolveContext` resolves trusted context for
  the framework-owned public principal and omits `expiresAt`; the Auth reference
  now says so.
- **Maintainability P2 — accepted:** admission, authorization, and trusted
  context resolution now have separate, accurate public TSDoc responsibilities.

## 2026-08-20 final constituent visibility disposition

- **API/maintainability P2 — accepted:** `SubscriptionGatewayCollaborators` and
  `BrowserBackend` are now exported and documented, completing the navigable
  public constituents of Unary, Subscription, and Browser option shapes. Their
  root export inventories intentionally changed; no runtime behavior changed.
- **Documentation P2 — accepted:** the Auth reference now assigns public
  principal admission to authorization and trusted-context reconstruction to
  `ContextResolver`.

## 2026-08-20 public actor-admission correction

- Existing `implementer` role, explicit configured `gpt-5.6-terra` / `medium`,
  owns this bounded security correction. Runtime telemetry is unavailable; the
  immutable configured role/profile is the acceptance evidence.
- **Security finding — accepted:** public actorless subscription operations
  reached `BoardContextResolver` and produced an internal error. `BoardAccessPolicy`
  now rejects missing or whitespace-only public actors before context resolution,
  forwarding, or binding work. Native adapter regressions prove Read, Subscribe,
  Activate, and Cancel are normal `PermissionDenied` failures.

## 2026-08-20 final lifecycle wording correction

- **Documentation P2 — accepted:** the 30-second incomplete
  Subscribe-to-Activate cleanup is now explicitly scoped to public,
  process-local definitions. Authenticated durable definitions instead use their
  stored session-derived expiry; healthy active public streams have no TTL.

## 2026-08-20 cheap-preflight containment correction

- Preflight failed on the previously unregistered
  `auth.public_pending_subscription_cleanup` boundary. Its adjacent source
  performs a best-effort local pending-definition cleanup, so it is registered
  as the distinct `auth.subscription.cleanup` no-log operation with its existing
  deterministic Auth subscription test owner. Estimated correction effort:
  15–30 minutes; existing `implementer`, explicit `gpt-5.6-terra` / `medium`;
  runtime telemetry unavailable.
