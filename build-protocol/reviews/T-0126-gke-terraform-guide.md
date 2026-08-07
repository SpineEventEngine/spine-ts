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
