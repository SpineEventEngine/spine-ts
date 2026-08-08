# T-0137: Stand Subscription Persistence

Status: Complete, reviewed, and ready for the stacked integration train

## Objective

Replaces the invented Stand control/staging protocol with one approved
`spine.client.SubscriptionRecord` per subscription, stored under its explicit
`SubscriptionId`.

## Classification

High-risk. This task changes a serialized record, concurrent creation and
activation semantics, expiry cleanup, restart/polling behavior, and provider
customization for a server-wide persistence component.

## Baseline And Ownership

- Baseline: pushed T-0136 commit `35b2b096`.
- Branch: `task/T-0137-stand-subscriptions`.
- Worktree: `.worktrees/T-0137-stand-subscriptions`.
- Ownership: `packages/server/src/stand/**`, mirrored Stand tests, the narrow
  bounded-context builder/root-export surfaces required to remove global
  subscription capacity, removal of
  the old private Stand Proto and its source/export/checksum references,
  focused provider customization tests, docs for this changed behavior, and
  T-0137 task records.
- Do not modify unrelated server/delivery/Gateway consumers, JVM code, examples,
  or add compatibility readers/aliases.

## Frozen Human Requirements

- Persist one `spine.client.SubscriptionRecord` per subscription.
- The record's `id` is first and is the storage ID; use `SubscriptionStatus`,
  field `status`, and enum value `SS_UNSPECIFIED`.
- Preserve subscription creation, activation expiry, cancellation, pending
  cleanup, polling/restart, and custom bounded-context registry behavior.
- Delete revision, generation, control/staging records, JSON-in-`Any`, and
  arbitrary global capacity coordination.
- Delete the private
  `packages/proto/proto/spine/system/server/stand_subscription.proto` and every
  generated/source/export/checksum reference.
- Prove MySQL and Datastore customization reaches `SubscriptionRecord`.
- Do not promise complete update delivery, multiple-Gateway behavior, or a new
  public cursor/capacity coordination API.

## Architecture Assignment

- Existing `requirements_splitter`, explicitly `gpt-5.6-sol` / `high`, owns a
  read-only bounded decision before implementation.
- It must freeze exact RecordSpec/ID/columns, create/activate/cancel/pending
  cleanup transitions, conflict/idempotency behavior, storage capability
  requirements, restart/polling visibility, lifecycle, provider selector keys,
  and the precise disposition of the old global `limit` option after removing
  control/staging coordination.
- It must not edit files, invoke JVM builds, create new public APIs, or spawn
  subagents.

## Verification And Review

- Required reviews: documentation, TypeScript/API docs,
  performance/reliability, and style/maintainability. Security is N/A unless a
  trust/credential/authorization boundary changes.
- Required verification: focused TypeScript/tests, changed-source coverage at
  least 90% in every metric, Proto generation/lint/cleanliness, documentation
  gates, provider customization behavior, and one focused `verify:task` after
  convergence.

## Continuation Assignment

- Existing role: `implementer`.
- Expected and explicitly dispatched profile: `gpt-5.6-terra` / `medium`.
- Remaining owned scope: replace obsolete provider conformance coverage, correct
  the affected server subscription guidance/reference, and record focused
  verification. Runtime self-introspection is unavailable on this surface; the
  immutable configured role/profile is the available metadata and no fallback
  is visible.
- Acceptance: provider tests exercise the durable registry lifecycle and show
  that MySQL `SubscriptionRecord` table selection and Datastore custom
  `SubscriptionRecord` storage selection reach the registry. No revision,
  capacity, staging, or control-record expectation remains in that test.

## Frozen Architecture Result

- Persist exactly one `SubscriptionRecord` using `SubscriptionId` as its
  message storage ID. Columns are numeric `status` and millisecond
  `when_activation_expires` with an absent-deadline sentinel.
- Keep one CAS-capable storage handle. Create is absent-to-pending CAS;
  activation is exact pending-to-active CAS; cancellation and expiry cleanup
  physically CAS-delete the exact observed row.
- Cleanup considers at most 26 ordered pending candidates, processes at most 25
  expired rows, and reports `more` only for an observed 26th expired candidate.
- Polling/restart uses subscription contents plus creation time as the approved
  attachment identity. Cross-node observation remains best-effort on the
  ten-second reconciliation interval.
- Remove revision, generation, control/staging/JSON-`Any` records, recovery
  state, `StandCapacityError`, `standSubscriptionLimits`, registry constructor
  limits, and `BoundedContextBuilder.withSubscriptionLimit`.
- Keep `SpineServicesOptions.subscriptionLimit`; it bounds only concurrent
  unknown-ID cancellation work in one service instance.
- MySQL record-only table customization and Datastore exact source/record
  custom storage must be observed through registry construction.

## Known Downstream Limitation

The remaining composite server build has six unowned `RecordSpec.schema`
migration failures in tenant-index, delivery-attempts, inbox-records,
sharded-work-registry, and durable-subscription-bindings. Those consumers are
assigned to later Wave 8 tasks and are not changed by T-0137.

## Current Mechanical Gate

- `verify:task` reaches successful Node and Proto generation, then stops at the
  six unowned server migration failures above and four unowned example
  migrations (retired Datastore API in Orders and Message Board).
- The 16 focused Stand tests pass, but scoped changed-source coverage is below
  the required 90% in every dimension: 70.09% statements, 60.52% branches,
  70.12% functions, and 74.41% lines.
- Before review, owned T-0137 runtime code also needs its existing twelve
  registry ESLint findings, two runtime ESLint findings, and public registry
  TSDoc findings corrected. The replacement provider test itself is ESLint
  clean and passes (2/2).

## Final Coverage Correction

- Public StorageFactory-seam tests now cover non-atomic rejection, CAS-false
  retries, create reread outcomes, and malformed durable records. Exact focused
  changed-source coverage passes 80/80 tests with 96.86% statements, 93.08%
  branches, 97.43% functions, and 98.52% lines; all required metrics are at
  least 90%. No runtime source or coverage threshold changed.

## Verification Baselines

- The deterministic owned formatting/import/test-callback correction is clean:
  scoped coverage remains 80/80 with every metric above 90%, exact owned ESLint
  excluding the inherited typed cascade passes, Prettier passes, and
  `git diff --check` passes.
- Do not treat the 11 `bounded-context.test.ts` error-typed ESLint cascades as
  T-0137 defects: they derive from the six known downstream `RecordSpec.schema`
  migrations. Global TSDoc also has 11 inherited committed T-0134 MySQL
  findings in `packages/storage-rdbms/src/mysql/{testing,errors,scope}.ts`;
  they are outside this task's owned files.

## Exact-Optional Typecheck Correction

- The `expiresAt()` helper now validates pending phase and defined expiry from
  the public entry contract itself. This removes the three owned
  exact-optional TS2379 narrowing errors without a cast or assertion and
  preserves malformed-record validation. Direct server inventory now has only
  the six assigned downstream migrations; retained public expiry behavior and
  80-test scoped coverage remain green (93.16% branches).

## Consolidated Review Correction Batch

- The correction restores the exact provider column contract, a discriminated
  lifecycle entry type, canonical Protobuf equality, content-aware attachment
  identity, exact bounded cleanup, private-Proto output cleanup, and API/doc
  inventory accuracy. Focused RED/GREEN evidence and the remaining durable
  restart/poll requirement are recorded in the work and review logs.

## Final Acceptance

- All four required specialist concerns are clean after recorded correction
  waves; security remains N/A because no trust boundary changed.
- Final focused Stand verification passes 87 tests with 97.03% statements,
  92.94% branches, 97.64% functions, and 97.95% lines.
- Proto and workflow contract verification passes 71 tests. Proto generation,
  Buf lint, generated-output cleanliness, owned ESLint, Prettier, and diff
  integrity pass.
- Direct server TypeScript compilation reports only the six assigned downstream
  `RecordSpec.schema` migrations and no T-0137 error.
- T-0137 is durably complete on its feature branch. Full shared verification
  and merge remain sequenced after the later Wave 8 consumers migrate.
