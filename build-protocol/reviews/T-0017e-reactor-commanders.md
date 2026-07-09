# T-0017e Review Log

Status: complete; all review lanes clean and coordinator full verify passed

Scope: command-producing handler execution, event-reactor execution, generated
registry metadata, framework-owned wrapping, post-commit dispatch, docs/API
boundary, security, and reliability.

## Required Lanes

| Lane                       | Reviewer ID                            | Status | Result                         |
| -------------------------- | -------------------------------------- | ------ | ------------------------------ |
| Code style/maintainability | `019f448f-015a-7a71-b4c2-dfcf11eb81b6` | Closed | FINDINGS, addressed            |
| Documentation completeness | `019f448f-2217-79c0-a17f-9c80f438c91f` | Closed | FINDINGS, addressed            |
| TypeScript/API docs        | `019f448f-3ba5-77f1-98ad-5f08189ae848` | Closed | FINDINGS, addressed            |
| Security                   | `019f448f-56a8-7dd0-9a0d-857ecac66dfa` | Closed | FINDINGS, addressed            |
| Performance/reliability    | `019f448f-7503-7921-916d-14ea75a0ff04` | Closed | FINDINGS, addressed            |

## First-Round Findings Closure

- Code style/maintainability: `AggregateEventExecution.run()` was refactored
  into explicit intake, per-entity execution, handler invocation, storage, and
  command-posting steps. Aggregate load, instantiation, default state, replay,
  and produced-signal normalization are now grouped in shared aggregate
  execution support used by command and event execution.
- Naming/API style: `RepositoryRuntime.postCommand` was renamed to
  `onPostCommand` through bounded-context registration.
- Documentation: `packages/server/README.md` now states that generated
  two-argument execution covers command assignees, event subscribers, command
  reactions, and event reactors.
- Security: commands produced by event reactors now carry `CommandContext.origin`
  derived from the source event ID/type URL, source actor context, and source
  grand origin when present.
- API boundary: emitted schemas are stored in framework-owned handler metadata
  sidecar state and accessed through `handlerMetadataAccess`, not exposed on
  public exported handler metadata record types.
- Analyzer/API validation: build-time analysis rejects generated `@React`
  producer records with `void`/empty emitted schemas.
- Reliability: produced event dispatch from event reactors now uses event-bus
  follow-up work appended to the active runtime queue; it is drained before
  close and cannot be overtaken by later external posts. Managed/no-applier
  aggregate event execution now rejects unsnapshotted history like command
  execution.

## Fix Worker

- Fix worker ID: `019f4493-512c-7300-80e9-dddd1ef67704`.
- Participation: implemented first-round review fixes only; left
  `human-review-1-jul.md` untouched; made no commit.
- Closure status: focused red/green regression tests passed after fixes;
  broader verification is recorded in the work log and fix report.

## Second Re-Review Findings Closure

- Style/public surface: `SingleProcessServerRuntime.enqueueFollowUp()` is no
  longer a public method. Follow-up scheduling now goes through package-owned
  `runtimeAccess.enqueueFollowUp(runtime, work)` backed by module-local
  authority and used by `EventBus`.
- API public surface: generated registry record and registry contract types are
  no longer re-exported from `packages/server/src/index.ts`. Public loader and
  ingestor signatures erase generated registry values to `unknown`, generated
  code imports the contract through the internal subpath
  `@spine-ts/server/internal/generated-handler-registry`, and the API docs
  checker now forbids those contract names in public TypeDoc.
- API public surface: public `Assign`/`Command`/`Subscribe`/`React` overloads no
  longer include schema-bearing forms, and build-time app-source analysis
  rejects schema-bearing handler decorators.
- Reliability: runtime close now enters a drain mode that rejects external
  intake while accepting framework follow-up work from already-running runtime
  items, waits for a quiescent tail including follow-ups appended during drain,
  and `BoundedContext.close()` drains the event bus before closing the command
  bus so event-side work can post internal commands.

## Second Fix Worker

- Fix worker ID: `019f44a6-2ce2-7170-9f91-878a07f7d9e1`.
- Participation: implemented only the four remaining re-review findings; left
  `human-review-1-jul.md` untouched; made no commit.
- Closure status: focused regression tests, type/lint/docs/format/generated
  checks, and diff whitespace checks passed; details are recorded in the work
  log and second fix report.

## Third Re-Review Findings Closure

- Docs drift: `packages/server/README.md`, `docs/api/README.md`, and
  `docs/architecture/README.md` now describe public decorators as bare-only.
  Schema-bearing handler metadata is documented as generated/internal tooling
  and framework materialization state, not as a public compatibility decorator
  surface.
- Reliability: `BoundedContext.close()` now begins by closing public command
  and event intake, drains command and event bus runtimes in a cross-bus loop,
  allows only package-owned internal produced-command and stored-event dispatch
  posts during that drain, and finishes bus/resource close after quiescence.
  A focused regression covers accepted command work committing an event during
  close and verifies the event reaches dispatchers before shutdown resolves.

## Third Fix Worker

- Fix worker ID: `019f44b6-2ea9-7332-8af8-ceb49fc9c6e7`.
- Participation: implemented only the final docs-drift and reliability
  findings; left `human-review-1-jul.md` untouched; made no commit.
- Closure status: red/green regression, focused shutdown tests,
  type/lint/docs/format checks, and diff whitespace checks passed; details are
  recorded in the work log and third fix report.

## Re-Review Lanes

| Round | Lane                       | Reviewer ID                            | Status | Result              |
| ----- | -------------------------- | -------------------------------------- | ------ | ------------------- |
| 1     | Code style/maintainability | `019f44a2-226a-7da1-9583-22ff54b998bb` | Closed | FINDINGS, addressed |
| 1     | Documentation completeness | `019f44a2-4597-7d21-9221-fe3477de8cb7` | Closed | CLEAN               |
| 1     | TypeScript/API docs        | `019f44a2-643c-7ca0-951a-aa6072436dc0` | Closed | FINDINGS, addressed |
| 1     | Security                   | `019f44a2-87c3-74b3-a861-75cc0b0a2835` | Closed | CLEAN               |
| 1     | Performance/reliability    | `019f44a2-a492-7811-8367-762235759dff` | Closed | FINDINGS, addressed |
| 2     | Code style/maintainability | `019f44b3-28b5-7d43-a934-7343359b8984` | Closed | CLEAN               |
| 2     | Documentation completeness | `019f44b3-73a6-74a2-961b-2135aac3f16e` | Closed | FINDINGS, addressed |
| 2     | TypeScript/API docs        | `019f44b3-4dc4-7e40-b3b2-b8e6824dff56` | Closed | CLEAN               |
| 2     | Performance/reliability    | `019f44b3-9270-7f70-a37d-a80d2ffff6a9` | Closed | FINDINGS, addressed |
| 3     | Documentation completeness | `019f44c1-96fc-7b11-b68d-bab9c545711f` | Closed | CLEAN               |
| 3     | Performance/reliability    | `019f44c1-b3a3-7a42-9871-9c34cc7c7ff6` | Closed | CLEAN               |

## Review Policy

- Every formal reviewer lane must be run by a separate sub-agent.
- Findings must be fed back to an authoring/fix sub-agent.
- Re-review continues until all lanes are clean before integration.
- All participating sub-agents must be closed after their result is recorded.

## Coordinator Verification Closure

- Full `pnpm --config.verify-deps-before-run=false verify` passed after review
  closure: static checks, cleanup enforcement, formatting, 53 normal test
  files with 971 tests, coverage suite with 90% branch coverage, TypeDoc/API
  checks, Buf/proto linting, and generated-output cleanliness.
- TypeDoc emitted only the existing invalid `origin` remote warning.
