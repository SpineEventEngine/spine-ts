# Review Log: T-0011.5 Delivery And Retry Boundary Contracts

Status: Implemented; Verified; Reviews Pending

## Required Review Lanes

Every implementation subtask and docs-only subtask must complete these review
lanes before integration:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Setup Review State

T-0011.5 setup started on `2026-06-30 23:52 WEST` from parent T-0011 commit
`bc028bc`. Durable setup logs were created before implementation handoff.
Setup baseline verification passed on `2026-06-30 23:55 WEST` with 23 test
files / 276 tests, coverage 96.60% statements / 91.06% branches / 99.30%
functions / 96.54% lines, TypeDoc/API counts 100 / 28 / 124 / 26 / 31, copied
Spine proto checksum verification, proto lint/generate, generated proto output
clean, and generated files clean. TypeDoc emitted the existing invalid-`origin`
warning only.

## Current Review Gate

Implementation sub-agent authored the transport-only delivery/retry boundary
contracts and recorded focused RED/GREEN evidence. Branch-tip verification
passed on `2026-07-01 00:50 WEST` with 23 test files / 280 tests, coverage
96.04% statements / 90.31% branches / 99.33% functions / 95.98% lines, and
TypeDoc/API counts 100 / 28 / 124 / 26 / 46. The next gate is the required
review lanes.

## Reviewer Rounds

- Round 1 reviewers spawned after commit `74160fb`:
  code style/maintainability `019f1b10-bcd9-7ba2-8ebf-ce29b7d236ce`;
  documentation `019f1b14-f7e3-73b2-a367-375c6f848a80`; TypeScript/API docs
  `019f1b15-6084-73c3-8295-66055f81f168`; security
  `019f1b16-0942-78f2-b992-53096b01bac9`; performance/reliability
  `019f1b16-6ba3-75d1-8877-b92ce18741e9`.
- Round 1 results:
  - code style/maintainability: `STATUS: CLEAN`.
  - documentation: `STATUS: CLEAN`.
  - TypeScript/API docs: `STATUS: COMMENTS`. Findings: `scheduled` delivery
    status overclaims retry scheduling; `TransportDeliveryResultInput` is not a
    discriminated union; broad participant identity input type permits
    broker-shaped values with `workerRole` at compile time.
  - security: `STATUS: COMMENTS`. Finding: failure-detail sanitization uses a
    denylist and can leak sensitive scalar diagnostics under alternate keys.
  - performance/reliability: `STATUS: COMMENTS`. Findings: `scheduled`
    delivery status overclaims actual scheduling; unsafe integer attempt
    numbers can collide in deterministic keys.
- Round 1 fix required before re-review.
- Round 1 review-fix implementation on `2026-07-01 02:28 WEST`:
  - removed public `scheduled` delivery status; failed outcomes now derive
    `failed` status even when `retryEligibility` is `eligible`;
  - changed attempt-number validation to
    `Number.isSafeInteger(value) && value >= 1`;
  - made `TransportDeliveryResultInput` a discriminated union so delivered
    inputs reject failure data and failed inputs require failure data at
    compile time;
  - made `TransportParticipantIdentityInput` a broker/worker discriminated
    union so broker inputs reject `workerRole` and worker inputs require it at
    compile time; and
  - replaced failure-detail denylisting with an allowlist for scalar `stage`,
    `attempt`, `retryable`, `reason`, and `code` details.
- Review-fix focused verification:
  `corepack pnpm vitest run packages/transport/src/index.test.ts` passed with
  1 test file / 17 tests; `corepack pnpm typecheck` passed.
- Orchestrator full verification for the round-one fix failed on
  `2026-07-01 02:36 WEST` during `eslint`: `TransportDeliveryResultInputBase`
  used a `type` alias where the repo rule requires an `interface`, and
  `toMatchTypeOf()` was deprecated in a type-level test. A narrow lint fix is
  required before re-review.
- Narrow lint fix on `2026-07-01 02:39 WEST`:
  `TransportDeliveryResultInputBase` is now an `interface`, and the
  `TransportDeliveryResultInput` expect-type assertion now uses non-deprecated
  `toExtend()`. Focused verification passed: `corepack pnpm lint`;
  `corepack pnpm test packages/transport/src/index.test.ts` with 1 test file /
  17 tests; `corepack pnpm typecheck`; and `git diff --check`.
