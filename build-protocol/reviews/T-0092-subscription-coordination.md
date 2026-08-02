# T-0092 Review Record

Status: Specialist review wave in progress

## Required Concerns

- Style/maintainability: required for the durable state machine, transition
  organization, naming, and deterministic race fixtures.
- Documentation: required for visible leases, limits, restart, cleanup, and
  update-delivery limitation claims.
- TypeScript/API docs: required for any binding/option/result evolution,
  declarations/TSDoc, compatibility, and avoidance of premature public APIs.
- Performance/reliability: required for every race, fence, lease, retry,
  ambiguous outcome, accounting, cleanup, restart, and bounded-resource claim.
- Final security: remains the parent Wave 5 release gate; private data and
  sanitized failures are mandatory focused acceptance now.

Expected reviewer models/reasoning are recorded in the task before dispatch.
Actual runtime metadata will be recorded when exposed; otherwise immutable
configured role/profile evidence and the limitation are recorded honestly.

## Pre-review Mechanical Disposition

Specialist dispatch is deferred because the implementation checkpoint does not
yet cover the accepted ambiguous-CAS, paged repair, guarded-update,
cancellation-takeover, or cleanup continuation/backoff/restart matrix. The
same implementation owner receives these deterministic gaps; reviewer capacity
is reserved for a complete converged checkpoint.

## Preflight Tooling Correction

- Mechanical preflight found `TS2554` in the durable bindings test: a Vitest
  `toThrow()` assertion supplied an unsupported second argument. This is a
  test-tooling defect, not a specialist-review finding and does not change the
  durable registry contract.
- The recorded existing `implementer` profile (`gpt-5.6-terra` / medium) made
  the bounded correction. Runtime self-introspection remains unavailable;
  immutable configured-role evidence is the available metadata.
- Pending evidence: narrow server typecheck and focused durable registry test
  after the correction, followed by immediate feature-branch push.

- Evidence: the narrow server typecheck and focused durable registry suite
  (104 tests) passed, as did Prettier and `git diff --check`.

## Auth Test Preflight Correction

- Mechanical preflight found four ESLint failures in the auth subscription
  test doubles: redundant async wrappers and an unawaited release promise.
  This is test-tooling cleanup, not a specialist-review finding, and does not
  change the durable registry or public subscription contract.
- The recorded existing `implementer` profile (`gpt-5.6-terra` / medium) made
  the bounded correction. Runtime self-introspection remains unavailable.
- Pending evidence: affected lint, focused auth test/typecheck, formatting,
  and `git diff --check`, followed by immediate feature-branch push.

- Evidence: affected ESLint and auth typecheck passed; the focused auth
  subscription suite passed 51 tests; Prettier and `git diff --check` passed.

## Cleanup Enforcement Correction

- Mechanical cleanup enforcement found three overlong durable-fixture lines
  and required a specific necessity disposition for the standalone public
  predicate `isDurableSubscriptionBindings()`. This is structural/documentation
  policy cleanup, not a specialist-review finding.
- The recorded existing `implementer` profile (`gpt-5.6-terra` / medium) split
  the fixtures without changing their serialized values and recorded the exact
  TypeScript type-predicate boundary rationale in the server ledger. Runtime
  self-introspection remains unavailable.
- Pending evidence: cleanup check, affected lint/typecheck/tests, formatting,
  and `git diff --check`, followed by immediate push.

- Evidence: cleanup enforcement, affected ESLint, and server typecheck passed;
  the focused durable registry suite passed 104 tests; Prettier and
  `git diff --check` passed.

## TSDoc Preflight Correction

- Mechanical TSDoc enforcement found missing callable summaries, parameter and
  return descriptions, option/property summaries, and one inline block opener
  in the auth subscription contract and durable registry. This is
  documentation-only cleanup, not a specialist-review finding.
- The recorded existing `implementer` profile (`gpt-5.6-terra` / medium)
  corrected the complete reported batch under the project TSDoc rules. Runtime
  self-introspection remains unavailable.
- Pending evidence: TSDoc enforcement, affected lint/typechecks/tests,
  formatting, and `git diff --check`, followed by immediate push.

- Evidence: TSDoc enforcement, affected ESLint, and auth/server typechecks
  passed; focused auth subscription and durable registry suites passed 155
  tests; Prettier and `git diff --check` passed.

## Repository Format Baseline Prerequisite

- Repository-wide `format:check` found four current-main baseline files. The
  bounded correction preserves user-required blank lines before TSDoc with the
  established `// prettier-ignore` convention and applies ordinary Prettier
  wrapping to the Datastore limit call. No behavior changed.
- The recorded existing `implementer` profile (`gpt-5.6-terra` / medium) made
  this mechanical baseline correction. Runtime self-introspection remains
  unavailable.
- Pending evidence: full format and TSDoc checks, affected lint/typechecks/
  tests, and `git diff --check`, followed by immediate push.

- Evidence: affected ESLint and server/storage/Datastore/MySQL typechecks
  passed; four focused suites passed 178 tests; full `format:check`, TSDoc
  enforcement, and `git diff --check` passed.

## Specialist Review Dispatch

Review endpoint: `d214b046` against the T-0092 base `0748473e`.

The full no-tests task preflight passed before dispatch: generated builds,
tooling typecheck, repository lint, cleanup and TSDoc enforcement, formatting,
generated documentation checks, Proto lint/currentness, and release-readiness
checks are clean.

| Concern | Existing role | Expected model | Expected reasoning |
| --- | --- | --- | --- |
| Style and maintainability | `style_maintainability_reviewer` | `gpt-5.6-terra` | high |
| Documentation | `documentation_reviewer` | `gpt-5.6-luna` | medium |
| TypeScript and API documentation | `typescript_api_docs_reviewer` | `gpt-5.6-terra` | high |
| Performance and reliability | `performance_reliability_reviewer` | `gpt-5.6-terra` | high |

Every model and reasoning field is explicit in the dispatch. The reviewer
surface does not expose runtime self-introspection; unless a visible mismatch
is reported, the immutable configured role/profile is the accepted runtime
metadata and this limitation will be recorded with each result.

## First Specialist Wave Results

All four dispatched concerns returned at endpoint `8e28ab94`. None exposed
runtime model/reasoning self-introspection, so the explicit immutable
role/profile in the dispatch is the accepted metadata. No visible mismatch or
fallback was reported.

- Style/maintainability (`style_maintainability_reviewer`,
  `gpt-5.6-terra` / high): requested changes. P1: the accepted capacity,
  ownership, and competing-cleaner races lack deterministic barriers at the
  contested read/CAS boundary. P2: duplicated fault decorators match brittle
  serialized substrings instead of semantic records.
- TypeScript/API documentation (`typescript_api_docs_reviewer`,
  `gpt-5.6-terra` / high): requested changes. Blocking: the auth gateway drops
  the durable guard before update forwarding and backend cancellation.
  Important: the public guard contract does not define the callback's timing,
  false-result, and absent-guard obligations.
- Documentation (`documentation_reviewer`, `gpt-5.6-luna` / medium): requested
  changes. The README and REFERENCE claim that lease loss stops forwarding,
  but the current gateway does not enforce the guard at the final effect
  boundary. Other reviewed quota, restart, cleanup, reconnect/re-query,
  replay, ordering, and delivery-limit claims are consistent.
- Performance/reliability (`performance_reliability_reviewer`,
  `gpt-5.6-terra` / high): requested changes. P1: ambiguous CAS can accept a
  different same-shaped owner; failed creation can retain an implicit quota
  reservation; a slow cleaner can lose its unrenewed lease and duplicate
  disposal; close does not converge all in-flight activation/cancellation
  work. P2: cleanup can permanently skip valid IDs sorting before its initial
  control-record cursor.

One consolidated correction batch returns to the existing implementation
owner. Re-review will cover only the concerns materially affected by the
corrections.
