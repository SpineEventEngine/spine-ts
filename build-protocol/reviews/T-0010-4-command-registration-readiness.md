# Review Log: T-0010.4 Command Registration Readiness

Status: Review Complete; No Open Findings

## Required Review Lanes

Every implementation subtask and docs-only subtask must complete these review
lanes before integration:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Setup Review State

T-0010.4 setup started on `2026-06-30 17:24 WEST` from parent commit
`e5e7b1d`. Setup inspected task-relevant Spine JVM command dispatcher,
assignee, duplicate handler, bounded-context builder, and command service code,
plus the existing TS handler metadata registry and bounded-context runtime
surface. No blockers were identified. Setup baseline verification passed on
`2026-06-30 17:27 WEST` with 19 test files / 234 tests, coverage 96.21%
statements / 90.38% branches / 99.16% functions / 96.14% lines, TypeDoc/API
checks with 100 proto / 28 core / 116 server / 26 storage expected exports,
proto lint/generate checksum verification, and generated proto output clean.

The setup boundary is metadata/readiness only: expose deterministic registered
command type ownership from existing handler metadata and reuse
`HandlerMetadataRegistry` duplicate command assignment validation. Do not
introduce command buses, services, posting, routing, dispatch, handler
invocation, validation, storage, transport, or `Ack`.

## Reviewer Rounds

Initial required review lanes were run by separate reviewer sub-agents and then
closed by the orchestrator:

| Lane                       | Reviewer sub-agent                     | Result                                                                                                                                                                                                                                                                      |
| -------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code style/maintainability | `019f1969-e89b-79c3-aa03-0733091721b9` | Minor finding: `localeCompare()` made command-name ordering depend on host/default locale and ICU behavior.                                                                                                                                                                 |
| Documentation              | `019f196a-16c4-7860-a2b4-61968550b23e` | No findings.                                                                                                                                                                                                                                                                |
| TypeScript/API docs        | `019f196a-3f93-75d1-8092-fb2719106ed0` | No findings.                                                                                                                                                                                                                                                                |
| Security                   | `019f196a-681f-7583-ae34-99e0dde0d033` | No findings. The reviewer noted an edge around hostile custom `HandlerMetadataRegistryLookup` objects, but did not classify it as a finding for the intended frozen metadata path.                                                                                          |
| Performance/reliability    | `019f196a-8e4e-7631-941c-733a7ad1d340` | Important findings: `localeCompare()` made command-name ordering locale-dependent, and returned assignee values copied only the outer object while nested `handler`, `entityHandlers`, and `registeredHandler` references could remain aliased from public lookup metadata. |

Implementation verification evidence:

- RED: `corepack pnpm test packages/server/src/command-registration-readiness.test.ts`
  failed on `2026-06-30 17:34 WEST` because the new public API was absent.
- GREEN: focused readiness and root export tests passed on `2026-06-30 17:37
WEST`.
- Full: `CI=true corepack pnpm verify` passed on `2026-06-30 17:38 WEST` with
  20 test files / 240 tests and coverage 96.26% statements / 90.44% branches /
  99.18% functions / 96.20% lines.

Concerns: none.

## Final Re-Review

All required lanes were re-run after the review fix and then closed by the
orchestrator:

| Lane                       | Re-review sub-agent                    | Result                                                                                                                                                                                                             |
| -------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Code style/maintainability | `019f1979-0da3-7bf1-9119-ee0e8bb0ad4c` | No findings. Confirmed `localeCompare()` was replaced with explicit code-unit comparison, regression coverage includes digit/uppercase/underscore/lowercase ordering, and no bus/service/dispatch behavior leaked. |
| Documentation              | `019f1979-47a0-7703-b882-1f56c2adff15` | No findings. Confirmed docs/logs accurately record separate reviewer sub-agents, findings, fixes, verification, and metadata-only exclusions.                                                                      |
| TypeScript/API docs        | `019f1979-6fc3-7022-ba8f-fd272e8f5468` | No findings. Confirmed public types remain readonly, export docs remain complete, and no bus/service/dispatch abstractions were added.                                                                             |
| Security                   | `019f1979-a556-7583-93a0-7f59499e1dda` | No findings. Noted residual trusted generated descriptor/schema references are intentionally not deep-frozen, matching the current shallow descriptor metadata pattern.                                            |
| Performance/reliability    | `019f1979-d135-7342-a3d5-38c286f5da1c` | No findings. Confirmed code-unit ordering and cloned/frozen nested assignee metadata resolve the prior reliability findings.                                                                                       |

## Review Closure

All required review lanes have no open findings:

- code style/maintainability: locale-dependent ordering finding fixed and
  re-review clean;
- documentation: clean;
- TypeScript/API docs: clean;
- security: clean, with trusted descriptor/schema references accepted as
  residual risk under the current metadata pattern;
- performance/reliability: locale ordering and nested copy-safety findings
  fixed and re-review clean.

All participating implementation, review-fix, and reviewer sub-agents were
closed by the main orchestrator.

Closure verification on `2026-06-30 18:03 WEST` ran fresh `CI=true corepack
pnpm verify` and passed with 20 test files / 242 tests, coverage above the 90%
target, TypeDoc/API export checks clean, proto lint/generation checks clean,
and generated proto output clean.

## Review-Fix Round

Review-fix sub-agent evaluated the two incoming findings against
`packages/server/src/command-registration-readiness.ts` and found both valid:

- Important/reliability and Minor/maintainability: command-name sorting used
  default `localeCompare()`, so deterministic order depended on host/default
  locale and ICU behavior.
- Important/reliability: returned assignee values copied only the outer object;
  nested `handler`, `entityHandlers`, and `registeredHandler` references could
  be aliased from public lookup metadata and manually supplied registry
  metadata.

Resolution:

- Replaced `localeCompare()` with explicit locale-independent code-unit
  comparison and added regression coverage for digit, uppercase, underscore,
  and lowercase ordering.
- Added fresh frozen copies for returned nested handler metadata,
  entity-handler metadata, registered handler metadata, and shallow entity
  metadata so mutating one returned assignee cannot affect later lookups.
- Kept scope to metadata/readiness only; no command bus, command service,
  dispatch, posting, routing, validation, storage, handler invocation,
  transport, repository runtime registration, or `Ack` was added.
- Duplicate assignment enforcement remains delegated to
  `HandlerMetadataRegistry`; no second duplicate policy was introduced.

Review-fix verification:

- RED: `corepack pnpm test packages/server/src/command-registration-readiness.test.ts`
  failed on `2026-06-30 17:48 WEST` with 3 focused regressions for
  locale-dependent sorting, nested registered handler identity, and mutable
  nested handler metadata.
- GREEN: `corepack pnpm test packages/server/src/command-registration-readiness.test.ts`
  passed on `2026-06-30 17:51 WEST` with 1 file / 8 tests.
- Typecheck: `corepack pnpm typecheck` passed on `2026-06-30 17:51 WEST`.
- Full: `CI=true corepack pnpm verify` passed on `2026-06-30 17:54 WEST` with
  20 test files / 242 tests and coverage 95.94% statements / 90.38% branches /
  98.15% functions / 95.87% lines.

Concerns: none.
