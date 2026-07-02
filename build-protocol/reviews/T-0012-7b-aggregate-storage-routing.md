# Review Log: T-0012.7b Aggregate Storage And Signal Routing

Status: round 17 fixes in progress
Branch: `task/T-0012-7b-aggregate-storage-routing`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-7b-aggregate-storage-routing`
Baseline commit: `77492b9`

## Required Review Lanes

Every review round must run these separate reviewer sub-agents:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Review Focus

Reviewers must reject:

- `Inbox`, delivery workers, `Stand`, gRPC services, import bus, scheduler,
  system context runtime, process supervision, or read-side query behavior;
- public repository-registration internals;
- large error/detail hierarchies;
- exported standalone helpers without a recorded reason;
- names over the four-component limit;
- tests under `src`; and
- stale docs/API expectations.

## Review Rounds

### Round 1

Reviewer sub-agents:

- code style/maintainability:
  `019f20b5-0eff-7251-a2bc-f07084f818dc`;
- documentation: `019f20b5-0f97-7620-9bcf-407082375366`;
- TypeScript/API docs: `019f20b5-1005-7421-b3c6-da3fd387c494`;
- security: `019f20b5-109e-7a23-aacf-7ff0aadd2e53`;
- performance/reliability:
  `019f20b5-1117-7191-bcb1-fba591615fa4`.

Result: changes requested.

Findings addressed by fix commit `69c6716`:

- stale architecture, user-guide, API, and repository TypeDoc statements about
  repository routing;
- non-primary declaration order in `aggregate-storage.ts`;
- misleading unused `aggregateId` parameter in `appendEvents()`;
- missing aggregate append/read invariants for route consistency and event
  versions;
- runtime-synthesized `spine.server.AggregateSnapshotRecord` descriptor;
- public aggregate and repository route APIs losing ID generic information; and
- structurally fabricated handler metadata becoming bus-visible through
  repository dispatcher adapters.

All five round-1 reviewers were closed after their reports were collected.

### Round 2

Reviewer sub-agents:

- code style/maintainability:
  `019f20c5-44f5-7421-a5cb-b510bf19416c`;
- documentation: `019f20c5-456c-7192-8106-d431040334cb`;
- TypeScript/API docs: `019f20c5-45ff-7352-90fa-c30ea695fdb6`;
- security: `019f20c5-4671-74c1-947f-262cd763fe80`;
- performance/reliability:
  `019f20c5-470a-7190-943f-f7d6662f3aca`.

Result: changes requested.

Findings addressed in the round-2 fix pass:

- storage/user/architecture docs no longer say aggregate snapshots/history are
  deferred;
- review log re-review range now points at the package actually reviewed;
- aggregate event reads sort by aggregate version before duplicate-version
  validation, so event-store ID ordering cannot reject valid history;
- `RepositoryOptions.handlers` now preserves entity/state generics; and
- handler metadata authenticity is exposed through an internal access object
  rather than a standalone helper export.

All five round-2 reviewers were closed after their reports were collected.

### Round 3

Reviewer sub-agents:

- code style/maintainability:
  `019f20cc-161e-7af3-9864-d06791974164`;
- documentation: `019f20cc-16c8-76c0-8a17-e5e14b777318`;
- TypeScript/API docs: `019f20cc-1747-7f91-ae7a-d20481b4e75f`;
- security: `019f20cc-17c6-7b52-852e-4bb13d7f9550`;
- performance/reliability:
  `019f20cc-1860-7e41-a857-4861b5a45f5a`.

Result: clean. No Critical, Important, or Minor findings remained. All five
round-3 reviewers were closed after their reports were collected.

### Round 4

Pending final review of the post-round-3 verification fix:

- package-root export smoke test now includes `AggregateStorage`;
- aggregate-storage tests cover first-field primitive routing, unroutable
  events, corrupted internal snapshot records, and duplicate versions already
  present in stored history; and
- final full verification passed after the coverage-focused test additions.

Reviewer sub-agents:

- code style/maintainability:
  `019f20d8-55a4-7d61-8806-f13ae14fcf07`;
- documentation: `019f20d8-5643-7ce0-83cc-1f08faaea1fd`;
- TypeScript/API docs: `019f20d8-56c2-77d1-85ef-f078487242c4`;
- security: `019f20d8-5767-7ae2-a0d3-60be0adb3c11`;
- performance/reliability:
  `019f20d8-57d3-71a1-bb6c-5ca4921ce37f`.

Result: changes requested.

Findings addressed in the round-4 fix pass:

- task/work-log current state was stale after the final verification commit;
- `packages/server/README.md` omitted aggregate storage and repository route
  calculation from the current server surface; and
- corrupted snapshot records did not fail closed for missing or mismatched
  aggregate IDs.

All five round-4 reviewers were closed after their reports were collected.

### Round 5

Reviewer sub-agents:

- code style/maintainability:
  `019f20dc-9003-7971-9571-dcb524e1f512`;
- documentation: `019f20dc-908c-7773-afdf-a59e99df91b8`;
- TypeScript/API docs: `019f20dc-9100-73d1-879f-8aac38318c09`;
- security: `019f20dc-91bd-74d3-b534-4054337a55bf`;
- performance/reliability:
  `019f20dc-9232-7800-8b3a-0f693457b4a7`.

Result: changes requested.

Findings addressed in the round-5 fix pass:

- task/work-log current state was still stale for the active review phase;
- `packages/server/README.md` still said repository did not route messages; and
- snapshot identity comparison used string coercion instead of exact primitive
  identity.

All five round-5 reviewers were closed after their reports were collected.

### Round 6

Reviewer sub-agents:

- code style/maintainability:
  `019f20e0-ff9c-7900-87e3-a5022ddb48ef`;
- documentation: `019f20e1-005a-7200-a575-312f9eea0634`;
- TypeScript/API docs: `019f20e1-00fc-71a1-8a06-f0b09b0a68b2`;
- security: `019f20e1-0181-74b1-850e-70a7dd32625e`;
- performance/reliability:
  `019f20e1-0227-71a0-b80c-1e235ae3e8c5`.

Result: changes requested.

Findings addressed in the round-6 fix pass:

- task/work-log current state still described the previous review phase; and
- `packages/server/README.md` still said registered command/event metadata does
  not become routing, instead of saying runtime dispatch and handler invocation
  remain deferred.

All five round-6 reviewers were closed after their reports were collected.

### Round 7

Reviewer sub-agents:

- code style/maintainability:
  `019f20e5-ab67-7cb2-88e3-9a9a0a6474df`;
- documentation: `019f20e5-d569-7882-9b8d-eafe7f1c82cc`;
- TypeScript/API docs: `019f20e5-fe0f-7e51-b380-38178f5b1408`;
- security: `019f20e6-22ce-7511-bcd3-cc37b4007e8c`;
- performance/reliability:
  `019f20e6-4ea8-7fc1-907a-37b3870d9bf1`.

Result: changes requested.

Findings addressed in the round-7 fix pass:

- durable task status, implementation report, work log, and review log were
  stale after the round-6 docs-only fix;
- snapshot state bytes were accepted even when the decoded state's first-field
  ID differed from the internal snapshot aggregate ID;
- aggregate events with contradictory producer IDs and payload first-field IDs
  were accepted instead of rejected;
- non-positive snapshot versions were accepted on write and read;
- `appendEvents()` accepted aggregate-version gaps instead of requiring the next
  version to equal the previous version plus one; and
- aggregate event identity checks still coerced distinct primitive IDs such as
  `9` and `"9"` through strings.

Verification after the round-7 fix pass passed: focused aggregate-storage
tests, `typecheck`, `lint`, `format:check`, and `docs:check`.

All five round-7 reviewers were closed after their reports were collected.

### Round 8

Reviewer sub-agents:

- code style/maintainability:
  `019f20f1-13b7-7270-90a9-a8f386db4ef5`;
- documentation: `019f20f1-3dbd-7c52-8d0d-dfaa31e26c99`;
- TypeScript/API docs: `019f20f1-630d-7231-8f10-dfd0bbd691d9`;
- security: `019f20f1-87d9-7732-906d-daec79b8c298`;
- performance/reliability:
  `019f20f1-afec-72f1-9316-032dc92f1f6c`.

Result: changes requested.

Findings addressed in the round-8 fix pass:

- repository event route calculation still preferred producer ID over the
  payload first-field ID when both were present and contradictory.

All five round-8 reviewers were closed after their reports were collected.

### Round 9

Reviewer sub-agents:

- code style/maintainability:
  `019f20f5-9e85-7e03-bfea-4e282087bf0a`;
- documentation: `019f20f5-c529-7081-bd9a-a1e5275b309d`;
- TypeScript/API docs: `019f20f5-ebae-74d0-894f-d8c151a714f5`;
- security: `019f20f6-102d-7ed3-9b8b-9fe1d892ae75`;
- performance/reliability:
  `019f20f6-3666-7d61-86d4-0bbb73e06910`.

Result: changes requested.

Findings addressed in the round-9 fix pass:

- durable logs still described the round-8 repository route fix as in progress
  after commit `f684ad1`; and
- stored aggregate event history rejected duplicate versions but still accepted
  gaps such as versions `1` and `3`.

Verification after the round-9 fix pass passed: focused aggregate-storage and
repository-routing tests, `typecheck`, `lint`, `format:check`, `docs:check`,
and `git diff --check`.

All five round-9 reviewers were closed after their reports were collected.

### Round 10

Reviewer sub-agents:

- code style/maintainability:
  `019f20fb-b79b-7ab0-96bb-b921c41de1f3`;
- documentation: `019f20fb-df5d-7681-8c55-019c50f0341c`;
- TypeScript/API docs: `019f20fc-04de-72f1-b16a-e3ecfe2e9383`;
- security: `019f20fc-3183-70a3-9b6b-3dff181258e9`;
- performance/reliability:
  `019f20fc-55b1-7e91-a5a0-6a0f9e11adf3`.

Result: changes requested.

Findings addressed in the round-10 fix pass:

- task/current-state and top-level README status text were stale after the
  round-8 and round-9 fix commits; and
- aggregate append accepted duplicate event IDs even though the backing
  event-store record storage replaces by ID.

Verification after the round-10 fix pass passed: focused aggregate-storage and
repository-routing tests, `typecheck`, `lint`, `format:check`, `docs:check`,
and `git diff --check`.

All five round-10 reviewers were closed after their reports were collected.

### Round 11

Reviewer sub-agents:

- code style/maintainability:
  `019f2101-9f96-73a1-b08c-06c1a1ae7500`;
- documentation: `019f2101-cb85-7dd0-b7a3-814bd3bfa700`;
- TypeScript/API docs: `019f2101-f473-7bd2-a716-76be09e7c1b4`;
- security: `019f2102-1aab-7813-961e-31bd6b03ac82`;
- performance/reliability:
  `019f2102-4963-7d21-aa63-0f4303ae35cc`.

Result: changes requested.

Findings addressed in the round-11 fix pass:

- duplicate event-ID validation was aggregate-local instead of event-store-wide;
- the task brief still said round-10 fixes were in progress after verification;
  and
- the top-level README deferred list omitted import bus and scheduler.

Verification after the round-11 fix pass passed: focused aggregate-storage and
repository-routing tests, `typecheck`, `lint`, `format:check`, `docs:check`,
and `git diff --check`.

All five round-11 reviewers were closed after their reports were collected.

### Round 12

Reviewer sub-agents:

- code style/maintainability:
  `019f2107-a2ce-7161-ac17-00a3641e3643`;
- documentation: `019f2107-d1c9-7390-a654-5d2a3b6758aa`;
- TypeScript/API docs: `019f2107-fc6e-79c2-add1-ee1dde4cc59a`;
- security: `019f2108-2c11-7651-884c-8bb0eea1dd78`;
- performance/reliability:
  `019f2108-54fa-78f1-a1cd-5a5a68392bd1`.

Result: changes requested.

Findings addressed in the round-12 fix pass:

- server expected exports were checked against the root barrel but not against
  TypeDoc JSON;
- `registeredRepositories()` documentation still described the views as being
  for later routing slices; and
- the task brief still said the round-11 event-ID fix was in progress.

Verification after the round-12 fix pass passed: focused aggregate-storage and
repository-routing tests, `typecheck`, `lint`, `format:check`, `docs:check`,
and `git diff --check`.

All five round-12 reviewers were closed after their reports were collected.

### Round 13

Reviewer sub-agents:

- code style/maintainability:
  `019f210d-b732-7480-9b27-b17b14e1b59c`;
- documentation: `019f210d-e92c-7e81-ab8f-aa816fe72e73`;
- TypeScript/API docs: `019f210e-123d-7a52-9bae-3257304b2f19`;
- security: `019f210e-4731-7392-83f7-8dc563e2426e`;
- performance/reliability:
  `019f210e-6f79-7420-a64b-bd9165431e22`.

Result: changes requested.

Findings addressed in the round-13 fix pass:

- server TypeDoc JSON export checks were based on the global TypeDoc name set
  instead of the direct server module children;
- the task brief still said the round-12 fix was in progress;
- API docs did not describe server TypeDoc JSON coverage;
- aggregate appends were not serialized; and
- unreadable producer IDs were treated as absent.

Verification after the round-13 fix pass passed: focused aggregate-storage and
repository-routing tests, `typecheck`, `lint`, `format:check`, `docs:check`,
and `git diff --check`.

All five round-13 reviewers were closed after their reports were collected.

### Round 14

Reviewer sub-agents:

- code style/maintainability:
  `019f2118-9c2d-7023-89bd-8662ad194049`;
- documentation: `019f2118-d0bd-7a51-97c1-1be382579a66`;
- TypeScript/API docs: `019f2119-0dc1-7fb0-a625-7fc074004505`;
- security: `019f2119-42f6-7701-a242-9a407caf65b5`;
- performance/reliability:
  `019f2119-7048-7a40-a2bc-f0fe4ba9dd0a`.

Result: changes requested.

Findings addressed in the round-14 fix pass:

- stale task-status wording;
- mutable append iterables queued by reference;
- fabricated child handler records becoming authentic through parent metadata;
- repository event-route validation happening after event storage;
- duplicate event IDs across event-store instances sharing one backend; and
- in-memory storages opened from one factory/spec not sharing backing records.

Verification after the round-14 fix pass passed: focused storage event-store
and factory tests, server event-bus/API tests, handler metadata tests,
aggregate-storage tests, repository-routing tests, `typecheck`, `lint`,
`format:check`, `docs:check`, and `git diff --check`.

All five round-14 reviewers were closed after their reports were collected.

### Round 15

Reviewer sub-agents:

- code style/maintainability:
  `019f2124-7193-7061-abc0-77ab42cc787c`;
- documentation: `019f2124-7232-70f3-9b64-37927b869abb`;
- TypeScript/API docs: `019f2124-72b4-7c32-960e-6dd8ea6b2596`;
- security: `019f2124-733b-7463-9b26-6e7e7758184c`;
- performance/reliability:
  `019f2124-73d3-7970-bb7d-71ff5344cc22`.

Result: changes requested.

Findings addressed in the round-15 fix pass:

- same-batch duplicate event IDs were not rejected;
- event-store and aggregate append queues captured mutable event objects;
- shared in-memory backing ignored context names;
- aggregate snapshot storage used a fresh `RecordSpec` per storage instance;
- handler records from another registration builder could be reused;
- custom dispatcher `accept()` ran before repository event validation;
- storage TypeDoc export checks only inspected the root barrel;
- public API, user-guide, and architecture docs were stale; and
- this work/review log was stale.

Verification after the round-15 fix pass passed: focused storage event-store,
storage factory, storage index, server event-bus, server bus API, server root
API, handler metadata, aggregate-storage, and repository-routing tests,
`typecheck`, `lint`, `format:check`, `docs:check`, and `git diff --check`.

### Round 16

Reviewer sub-agents:

- code style/maintainability:
  `019f2131-06f4-7011-97cf-1eadc614b11d`;
- documentation: `019f2131-0784-7da2-a519-14f83c4b602b`;
- TypeScript/API docs: `019f2131-0807-7890-a8d9-10a1c67ee448`;
- security: `019f2131-089e-7641-90a1-b4d881e8e19d`;
- performance/reliability:
  `019f2131-092b-7241-8cbf-959f0ce9ebdb`.

Result: changes requested.

Findings addressed in the round-16 fix pass:

- cross-instance aggregate appends were not serialized by aggregate ID;
- `EventStore` opened temporary append storages without closing them;
- in-memory tenant keys could collide between single-tenant storage and a
  multitenant tenant named `__single__`;
- `EventStore` allowed blank event IDs;
- storage adapter backing-sharing invariants were underdocumented; and
- storage guide and work-log current-state text were stale.

Verification after the round-16 fix pass passed: focused storage event-store,
storage factory, storage index, server event-bus, server bus API, server root
API, handler metadata, aggregate-storage, and repository-routing tests,
`typecheck`, `lint`, `format:check`, `docs:check`, and `git diff --check`.

### Round 17

Reviewer sub-agents:

- code style/maintainability:
  `019f2137-8337-7ca1-a8b9-8cf648207d7f`;
- documentation: `019f2137-83e7-7393-a704-cac992afbbf5`;
- TypeScript/API docs: `019f2137-846e-7313-93a6-aa6c323266db`;
- security: `019f2137-84f7-7883-acdd-d254386ae188`;
- performance/reliability:
  `019f2137-8569-79e1-a828-2d30150a01e0`.

Result: changes requested.

Findings addressed in the round-17 fix pass:

- dispatcher `accept()` ran before event-store identity validation;
- aggregate storage captured multitenant context at construction;
- storage adapter close-independent handle semantics were underdocumented;
- in-memory sharing docs omitted tenant mode and tenant ID in several places;
- the implementation report still had stale pending text;
- whitespace-only event IDs were accepted; and
- EventStore TypeDoc wording was awkward.

Verification after the round-17 fix pass passed: focused storage event-store,
storage factory, storage index, server event-bus, server bus API, server root
API, handler metadata, aggregate-storage, and repository-routing tests,
`typecheck`, `lint`, `format:check`, `docs:check`, and `git diff --check`.

Round-17 fix commit: `822d358`.

### Round 18

Diff package:
`.superpowers/sdd/review-d7b9245..822d358.diff`.

Reviewer sub-agents: pending.

Result: pending.
