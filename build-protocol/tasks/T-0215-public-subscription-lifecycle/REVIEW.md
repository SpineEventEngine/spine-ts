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
