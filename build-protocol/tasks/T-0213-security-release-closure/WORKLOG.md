# T-0213 work log

## 2026-08-19 — setup and planning

- Created isolated worktree `/tmp/spine-ts-t0213` on
  `codex/t0213-release-closure` from clean pushed `main@4c28e2223`.
- `pnpm install --frozen-lockfile` passed. A build attempted before fresh Proto
  generation failed only because ignored generated modules were absent; after
  `pnpm proto:generate`, `pnpm typecheck:build:generated` passed.
- Restored exactly ten randomized generation-ID metadata byproducts with no
  generated source change; the branch returned clean.
- T-0213 uses the repository-grounded security threat-model workflow. Existing
  conversation decisions supply deployment assumptions; application-specific
  data sensitivity and external exposure remain explicit conditional inputs.
- Requirements split assignment: existing `requirements_splitter` role,
  explicitly configured `gpt-5.6-sol` / `high`, bounded to the final security,
  documentation, verification, review, and integration sequence. Runtime model
  telemetry is recorded if exposed; otherwise the immutable configured profile
  and limitation are evidence. No subagent may spawn another subagent.

## 2026-08-19 — accepted execution split

- Requirements splitter completed with no architecture blocker and no required
  human decision. Conditional deployment/application assumptions are recorded
  in `TASK.md`; only an unremovable security residual, incompatible advisory,
  or public/domain contract expansion can require human direction.
- The dependency-ordered execution sequence is recorded in `PLAN.md`.
- Read-only inventory assignments:
  - security/source: existing `explorer` function, explicitly
    `gpt-5.6-luna` / `low`;
  - dependency/package: existing `explorer` function, explicitly
    `gpt-5.6-luna` / `medium`;
  - documentation/status: existing `explorer` function, explicitly
    `gpt-5.6-luna` / `medium`;
  - release-smoke: existing `explorer` function, explicitly
    `gpt-5.6-luna` / `low`, dispatched in the next available slot.
- Runtime telemetry is recorded if exposed; otherwise each explicit immutable
  dispatch profile and its limitation are retained. Inventories are read-only
  and may not spawn subagents.

## 2026-08-19 — inventory convergence

- Security/source inventory mapped the current Gateway/auth, private
  Coordinator/managed-child, services/buses, tenant storage, Delivery,
  subscription, process-local IntegrationBroker, generated-module,
  diagnostics, and build boundaries. ZeroMQ assumptions are retired.
- Dependency inventory confirmed minimal build approval (`@bufbuild/buf` only,
  `protobufjs` denied), 501 verified registry signatures, one unused Todo
  transport dev dependency, and seven transitive advisories requiring
  classification/remediation before the security gate.
- Documentation/status inventory found stale current release requirements,
  capability rows, Todo guidance, security records, and T-0204 through T-0212
  status mirrors. T000/T001 are already correctly historical.
- Smoke inventory confirmed managed lifecycle, managed external-event/Delivery,
  Todo standalone, Message Board image contract, one-node Compose, and
  distributed Compose as the retained real proofs.
- Direct inspection resolved one inventory discrepancy: root
  `verify:release:generated` still excludes and then invokes the deleted broker
  cross-process test. The metadata test only checks one coverage invocation and
  does not reject this stale second command.

## 2026-08-19 — release-plumbing implementation assignment

- Owner: existing `implementer` role, explicitly configured
  `gpt-5.6-terra` / `medium`; runtime telemetry is recorded if available,
  otherwise the immutable configured profile and limitation are evidence.
- Owned scope: root release scripts/metadata test, T-0212 removal guard, Todo
  manifest/lock/reference/spec, and T-0213 records only.
- Behavior-first acceptance: retain failing proof for the stale second test
  invocation/deleted paths/dependency, then leave exactly one global coverage
  run; do not restore ZeroMQ or invent replacement transport.
- The owner is not alone in the repository, must preserve other edits, and may
  not spawn subagents.

## 2026-08-19 — release-plumbing correction implementation

- Implementer profile: existing `implementer` role, explicitly configured
  `gpt-5.6-terra` / `medium`. Runtime telemetry was not exposed by the assigned
  execution surface; the immutable configured profile is the available evidence.
- RED: `pnpm exec vitest run scripts/package-metadata.test.mjs` failed exactly
  because `verify:release:generated` still named the deleted
  `server-integration-broker-cross-process` test and ran Vitest twice.
- GREEN implementation reduced the release command to one global coverage run,
  removed the stale Todo transport development dependency and lock importer,
  expanded the T-0212 guard for the deleted broker/Todo paths and references,
  and replaced Todo’s retired local-multiprocess guidance with the accepted
  single-process development and managed-complete-replica deployment model.
- Focused GREEN checks passed: package metadata 11/11, T-0212 removal guard,
  frozen lockfile installation, and Todo startup/black-box tests 55/55.
