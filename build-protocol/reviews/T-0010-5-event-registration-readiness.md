# Review Log: T-0010.5 Event Registration Readiness

Status: Implementation Reviewed; Review Fixes Complete; Verification Passed

## Required Review Lanes

Every implementation and docs-only task must complete these review lanes before
integration:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Setup Review State

T-0010.5 starts from parent commit `20aaad1`. The task is constrained to a
metadata-only readiness surface for event subscriptions, event reactions, and
event applications.

Setup baseline verification passed on `2026-06-30 18:16 WEST`: `CI=true
corepack pnpm verify` passed with 20 test files / 242 tests, coverage 95.94%
statements / 90.38% branches / 98.15% functions / 95.87% lines, TypeDoc/API
checks with 100 proto / 28 core / 119 server / 26 storage expected exports,
proto lint/generate checksum verification, and generated proto output clean.

Reviewer prompts must check:

- server-module code inspected task-relevant Spine JVM `core-jvm/server` event
  registration code before implementation;
- subscribers and reactors preserve fan-out and do not gain duplicate rejection;
- event application uniqueness remains delegated to `HandlerMetadataRegistry`;
- no event bus, integration broker, import bus, storage, dispatch, service,
  transport, handler invocation, validation, or `Ack` behavior is added;
- domestic/external classification is documented as deferred instead of
  guessed;
- returned readiness metadata is deterministic and copy-safe.

## Reviewer Rounds

### Round 1: Implementation Commit `a453757`

- Maintainability reviewer `019f1999-9c26-7c80-868d-1c54f56daa6e`:
  Important finding. Event readiness duplicated command readiness
  `compareFullTypeNames`, handler/entity clone helpers, and readiness metadata
  construction logic. Disposition: fixed by extracting private server helper
  `packages/server/src/registration-readiness-metadata.ts` and using it from
  both command and event readiness. The helper is not exported from
  `packages/server/src/index.ts`.
- Documentation reviewer `019f1999-cfd4-7ed3-a88a-f23f3a75c943`: Important
  finding. Durable logs used generic author wording instead of concrete
  authoring sub-agent ID. Minor finding. This review log status was stale.
  Disposition: fixed by recording authoring sub-agent
  `019f198d-7dc2-7641-9abb-4c49d776e370`, reviewer IDs, findings, and
  review-fix status in task/report/work/review logs.
- TypeScript/API reviewer `019f199a-0079-7cf3-ab60-78f8c7286dac`: clean.
  Disposition: no code change required.
- Security reviewer `019f199a-38dc-7a90-bc98-5a3a08efd62e`: Important
  finding. Returned handler metadata froze only top-level handler objects and
  preserved mutable nested `schema` / `descriptor` references. Disposition:
  fixed by cloning and freezing handler/entity schema and descriptor objects in
  immutable readiness snapshots; regression tests mutate returned schema and
  descriptor metadata and verify later lookups remain unchanged.
- Performance/reliability reviewer
  `019f199a-6696-7061-b129-bdc51f12ef81`: Important finding. Event
  `fromRegistry()` trusted custom lookup `findHandlersByKind()` results and
  could bypass event application uniqueness. Important finding.
  `cloneEntityMetadata()` split identity between `entity.idField` and
  `entity.firstFieldRoutingHint.field`. Minor finding. Event readiness cloned
  full metadata graphs on repeated lookups. Disposition: fixed by
  canonicalizing event `fromRegistry()` through `HandlerMetadataRegistry`, using
  a field metadata clone map to preserve identity, and storing immutable nested
  snapshots that are reused while returning fresh outer arrays and metadata
  records.

### Review-Fix Verification

- RED on `2026-06-30 18:42 WEST`: `corepack pnpm test
packages/server/src/command-registration-readiness.test.ts
packages/server/src/event-registration-readiness.test.ts` failed as expected
  with 5 focused regressions covering schema/descriptor mutation safety, field
  identity preservation, and custom lookup duplicate event applications.
- Focused GREEN on `2026-06-30 18:45 WEST`: `corepack pnpm test
packages/server/src/command-registration-readiness.test.ts
packages/server/src/event-registration-readiness.test.ts` passed with 2 test
  files / 22 tests.
- Typecheck on `2026-06-30 18:45 WEST`: `corepack pnpm typecheck` passed with
  `tsc -b` and `tsc --noEmit -p tsconfig.eslint.json`.
- Full verification attempts on `2026-06-30 18:46-18:47 WEST`: `CI=true
corepack pnpm verify` first failed on one ESLint `no-unsafe-argument` finding
  in the helper clone utility; after switching to `Reflect.getPrototypeOf()`,
  it failed on Prettier formatting for `build-protocol/work-logs/T-0010-5.md`;
  formatting the touched durable logs resolved it.
- Full verification on `2026-06-30 18:50 WEST`: `CI=true corepack pnpm verify`
  passed with 21 test files / 256 tests, coverage 96.45% statements / 90.55%
  branches / 99.24% functions / 96.39% lines, TypeDoc/API checks with 100
  proto / 28 core / 124 server / 26 storage expected exports, proto
  lint/generate checksum verification, and generated proto output clean.
