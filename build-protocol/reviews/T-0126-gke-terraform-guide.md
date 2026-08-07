# T-0126 Specialist Review

## Planned Review Wave

The complete review wave starts only after RED/GREEN implementation and the
cheap deterministic preflight converge. All results will be collected before
one correction batch returns to the implementation owner.

- Style and maintainability: existing `style_maintainability_reviewer` role;
  expected explicit profile `gpt-5.6-terra` / `high`. Scope: Terraform module
  shape, editable defaults, naming, duplication, and repository quality rules.
- Documentation: existing `documentation_reviewer` role; immutable expected
  profile `gpt-5.6-luna` / `medium`. Scope: beginner progression, copyable
  commands, diagrams, factual GKE claims, limitations, and troubleshooting.
- TypeScript and API documentation: existing
  `typescript_api_docs_reviewer` role; expected explicit profile
  `gpt-5.6-terra` / `high`. Scope: public runtime snippets and their alignment
  with current package/server contracts; no runtime API change is planned.
- Performance and reliability: existing `performance_reliability_reviewer`
  role; expected explicit profile `gpt-5.6-terra` / `high`. Scope: readiness,
  scale-zero recovery, autoscaling limits, rolling/incompatible replacement,
  rollback, DNS membership, and shutdown/resource claims.
- Dedicated per-task security review is deferred to the final Wave 7 security
  gate. This task nevertheless requires mechanical proof that templates use
  private application-node networking and external secret references only.

Both model and reasoning will be explicit in every configurable dispatch. The
Desktop surface selects the immutable documentation role because Luna is not
an exposed override. Runtime metadata will be recorded when available;
otherwise the immutable configured role/profile and absence of a visible
mismatch are the acceptance evidence.

## Review Wave 1 Dispatch

The complete review wave examines `origin/main@c6ff000c..adc4af1a`. The branch
is clean and pushed after Terraform 3.2.1 initialization/validation, recursive
Terraform formatting, four focused policy tests, and the full infrastructure-
and-docs-only `verify:task` profile passed. All results are collected before
any correction dispatch.

The concern scopes and expected profiles are exactly those recorded above.
Terra reviewers receive explicit `gpt-5.6-terra` / `high` dispatch fields. The
documentation reviewer receives the immutable `documentation_reviewer` role
and explicit `medium` reasoning; the Desktop tool does not expose Luna as a
model override, so the role's fixed `gpt-5.6-luna` profile is the model
selection evidence.

## Review Wave 1 Results

All four results were collected before correction dispatch. Runtime
self-introspection was unavailable. Each reviewer reported the configured
role/profile with no visible mismatch or fallback.

- Style and maintainability: P2 make the one-Gateway assertion stop at the end
  of the Gateway resource rather than matching Delivery's replica value. P2
  prove both application and Gateway Secret variables are declared and consumed
  by their corresponding external `secret_ref` blocks.
- Documentation: P1 teach that a production standalone Gateway image must
  assemble the required sessions, authorization, actor-context resolution,
  origins, clock, fingerprint, type registry, and named
  `DurableSubscriptionBindings`; the operator-managed edge alone is not enough.
  P2 explain rollback when HPA owns capacity.
- TypeScript and API documentation: P1 configure the delivery executable's
  `HOST` and `PORT`; P1 show application and Gateway listeners binding a
  non-loopback host and mapping their configured ports; P2 show or qualify the
  durable bindings promise.
- Performance and reliability: P0 configure delivery `HOST=0.0.0.0` and its
  variable port so the ClusterIP Service is reachable. P1 configure application
  and Gateway listener host/port behavior; P1 never run the module HPA and a
  KEDA-managed HPA against the same Deployment; P1 disable the module HPA before
  an incompatible stop-all replacement; P1 configure named durable Gateway
  bindings before promising restart survival; P2 wait for all three Deployment
  rollouts before endpoint/log verification.

## Aggregated Correction Batch

One deduplicated batch returns to the existing implementer:

1. Set delivery `HOST` and `PORT` explicitly and prove both values by policy
   test.
2. Add a clear listener-host convention and copyable application/Gateway
   entrypoint examples that pass `host: "0.0.0.0"` and the corresponding port.
3. State that the module external-metric HPA has minimum one; automatic zero to
   one uses operator-managed KEDA as the sole autoscaler, with the module HPA
   disabled.
4. Make incompatible replacement and rollback disable module autoscaling before
   applying zero, then explicitly restore either manual replicas, the module
   HPA, or an operator-managed KEDA policy.
5. Teach every required production standalone browser option and named durable
   bindings, link the complete server/auth guide, and state that production
   startup rejects missing or volatile bindings.
6. Add rollout-status commands for application, Gateway, and delivery.
7. Bound the Gateway replica assertion to its own resource and prove both
   Secret variables are declared and consumed.

The P0 and all accepted P1/P2 findings block integration. Corrections reopen
all four concerns because the Terraform, policy tests, public snippets, and
operational guide are substantively affected.

## Focused Re-review Dispatch

Correction `97d0af92` implements the complete aggregated batch. Recursive
Terraform formatting and validation, strict TypeScript snippet checking, four
focused policy tests, and the infrastructure/docs-only `verify:task` profile
all pass. The branch is clean and pushed.

All four original concerns recheck only their recorded findings. Style,
TypeScript/API, and performance/reliability use explicit
`gpt-5.6-terra` / `high`. Documentation uses its immutable
`gpt-5.6-luna` / `medium` role, with `medium` explicit and the role selecting
the fixed model because the Desktop tool does not expose Luna as an override.
Runtime metadata is recorded if exposed; otherwise the configured role/profile
and absence of a visible mismatch remain the acceptance evidence.

## Focused Re-review Results

- Style and maintainability: clean. The Gateway replica assertion is bounded to
  its own resource and both Secret variables are declared and consumed.
- Documentation: the original production Gateway, durable bindings, and
  autoscaling replacement findings are clean with no direct regression.
- Performance and reliability: delivery reachability, module-HPA/KEDA mutual
  exclusion, rollout waits, and policy tests are clean. Three P1s remain: an
  operator-managed KEDA policy must be suspended before stop-all replacement;
  entrypoints must read and validate injected ports rather than hard-code
  defaults; and durable bindings must use storage shared persistently across
  Gateway replacements, not merely a stable namespace.
- TypeScript and API documentation: delivery configuration and the documented
  browser collaborator types are correct. P1: `Server` treats only
  `browser.backend` as standalone, while the GKE entrypoint supplies dynamic
  `browser.discovery`; discovery-only production startup therefore enters the
  local-context path and fails before it can operate as the documented Gateway.
  P1 also confirms the injected-port mismatch.

Reviewer runtime self-introspection was unavailable. All four configured
roles/profiles matched their dispatches with no visible mismatch or fallback.

## Final Correction Batch

The original implementer receives one final high-risk batch:

1. Treat dynamic `browser.discovery` as standalone remote hosting everywhere
   `Server` validates ownership, required browser collaborators, production
   registry/bindings, and opens the browser pipeline. Add direct Server tests
   proving discovery-only startup bypasses local environment attachment and
   owns discovery shutdown.
2. Read and validate the injected listener/discovery ports in copyable
   application and Gateway entrypoints; do not hard-code Terraform defaults.
3. Require `DurableSubscriptionBindings` storage to be shared and persistent
   across Gateway replacement before claiming survival.
4. Require operator-managed KEDA to be suspended/removed before stop-all
   replacement or rollback, then restored only after the selected version is
   ready.

The runtime correction is bounded but changes shared Server behavior, so the
final verification profile is promoted to `pnpm verify:release`. Style,
documentation, TypeScript/API, and performance/reliability receive narrow
closure rechecks because the correction changes runtime structure, public
snippets, and replacement semantics.

## Closure Re-review Dispatch

Correction `7c9f236b` passes 128 focused Server/policy tests plus Server
typechecking, focused ESLint, TSDoc, cleanup, audience and strict snippet
checks, Terraform formatting/validation, and diff validation. The branch is
clean and pushed. The final release gate remains deferred until these closure
rechecks converge.

- Style checks only the new standalone classification/open seam, test
  maintainability, and configuration-example ownership.
- Documentation checks only injected configuration, persistent shared binding
  storage, KEDA suspension/restoration, and direct regressions.
- TypeScript/API checks only discovery-only standalone admission/opening,
  required collaborator validation, backend-plus-discovery precedence, public
  contract wording, and snippets.
- Performance/reliability checks only environment-attachment exclusion,
  discovery lifecycle, persistent bindings, configured ports, and stop-all
  replacement safety.

Terra closure reviewers use explicit `gpt-5.6-terra` / `high` fields. The
documentation role remains immutable `gpt-5.6-luna` / `medium`, with `medium`
explicit and the role selecting the fixed model. Runtime metadata will be
recorded when exposed; otherwise configured profile and absence of a visible
mismatch remain the acceptance evidence.

## Closure Re-review Results

- TypeScript/API: clean. Discovery-only admission/opening, required
  collaborators, named durable bindings, backend-plus-discovery precedence,
  public TSDoc, snippets, and 128 focused tests are correct.
- Style and maintainability: the runtime seam and tests are clean. P2: the
  guide describes one shared `DeploymentSettings` owner, but its entrypoint
  snippets only declare that owner and environment instead of importing a real
  module and binding `process.env`.
- Documentation: P1 confirms the declaration-only entrypoints are not copyable
  for a beginner deployment guide. Persistent bindings, KEDA safety, and
  discovery-only semantics are otherwise clean.
- Performance and reliability: P1 discovery-only `Server.run()` still registers
  local `ServerEnvironment` retirement with `ProcessServerCoordinator`, so the
  last standalone Gateway closes facilities it never attached. Signal-managed
  listener/discovery shutdown must remain, but environment retirement must be
  limited to environment-owning run records. All other closure concerns are
  clean.

Runtime self-introspection was unavailable. Every reviewer reported its
configured role/profile with no visible mismatch or fallback.

## Final Remediation Dispatch

The original implementer receives the two accepted findings plus one mechanical
package-completeness correction discovered before release verification:

1. Make process coordination distinguish environment-owning local servers from
   standalone browser hosts. Closing or signaling a discovery-only `run()` must
   stop its listener/discovery exactly once without closing `ServerEnvironment`;
   local run siblings must still close their environment when their last
   environment-owning record retires.
2. Supply actual small, documented GKE entrypoint example files with one shared
   deployment-settings owner. README snippets use those real paths, import the
   owner, bind `process.env`, and accept application-owned collaborators through
   explicit typed options instead of declaration-only pseudo-code.
3. Add `terraform` and the new examples to the deployment-gke package payload.
   The current package `files` list contains only `dist`, README, and reference,
   which would omit the primary T-0126 deliverables from a future package.
   Prove the packed file list deterministically.

This remediation receives narrow style, documentation, API, and reliability
closure only where changed. The already-promoted release gate runs once after
closure converges.
