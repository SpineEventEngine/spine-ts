# Implementation Report: T-0226 Async Handlers, Process Manager Queries, And BlackBox Signals

Status: Ready for human review
Branch: `feature/async-handlers-querying-black-box`
Baseline: `437cafcf380da33222d852f86a802200ef5ddc41`
Final verified implementation HEAD: `102922bf9`
Release version: `2.0.0-snapshot.10`

## What Changed

Signal handlers may now return their normal value directly or return one
built-in `Promise` of that value. This works for `@Assign`, `@Command`,
`@React`, and `@Subscribe`. The framework waits for the promise before it
commits state or publishes output. If the promise rejects, the state change and
provisional output are rolled back.

Process Managers now have protected, read-only projection querying. A handler
can select a projection type and use typed filters, logical groups, ordering,
field masks, limits, `findById()`, `all()`, and `read()`. The query uses the
active actor and tenant. Aggregates do not receive this capability. Reads are
eventually consistent and return at most 1,000 states.

BlackBox now supports `postExternalEvent()`, `assertCommands()`, and
`assertEvents()`. The two assertion methods return immutable snapshots of
Commands and committed Events produced by the tested context, in production
order. They exclude setup inputs, received external Events, and rolled-back
output.

## Safety And Compatibility

- Existing synchronous handlers keep their behavior.
- Only the built-in `Promise` type is accepted; lookalike and nested promise
  return types are rejected during build-time analysis.
- Process Manager queries cannot mutate Stand, override tenancy, or continue
  after their runtime context is released.
- Query predicate graphs have cycle, depth, and node-count limits.
- External HTTP or service side effects still cannot be rolled back; this is
  documented clearly.
- No new production dependency was added.

## Documentation

The main user guide, server documentation, testing documentation, public TSDoc,
and TypeDoc inventories explain async handlers, Process Manager querying, and
the BlackBox additions with beginner-level examples.

## Review

The architecture pass and the complete style, API, reliability, documentation,
and security review lanes are recorded in the task directory and review log.
All accepted P1 and P2 findings were corrected. The final focused API review
reported no P0-P2 findings.

## Verification

- Final affected-scope preflight: all generated, strict, policy,
  documentation, package-consumer, and readiness gates passed; 526 tests passed
  in 19 files.
- Final `pnpm verify:release`: 289 test files and 4,637 tests passed.
- Coverage: 93.22% statements, 90% branches, 92.79% functions, and 94.39%
  lines. Every configured threshold passed.
- All 18 exact `2.0.0-snapshot.10` framework tarballs were packed, installed,
  compiled, and imported by the release consumer checks.

The feature branch is pushed to the official `origin`. No pull request or merge
was created.
