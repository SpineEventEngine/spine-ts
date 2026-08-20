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
