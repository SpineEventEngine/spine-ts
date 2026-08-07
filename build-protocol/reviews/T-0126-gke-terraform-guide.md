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
