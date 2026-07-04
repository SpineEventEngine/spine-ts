# Implementation Report: T-0012.10 Real gRPC Services

Status: in progress
Branch: `task/T-0012-10-real-grpc-services`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-10-real-grpc-services`
Baseline commit: `63216fe`

## Summary

This task starts the real public gRPC service slice after storage, buses,
bounded context, repositories, delivery/inbox, and direct `Stand` are in place.

The implementation must stay small: service adapters over existing runtime
objects, exact Spine protobuf contracts, no client DSL, no example app, and no
service simulation.

## Initial Evidence

- Parent `main` verification passed after `T-0012.9` with 43 test files, 503
  tests, and global branch coverage 90.07%.
- `T-0012.9` added direct storage-backed `Stand` read and subscription support
  and intentionally deferred gRPC service adapters to this task.
- Current package manifests do not include a gRPC or Connect service runtime.
- The parent roadmap selects `T-0012.10 Real gRPC Services` as the next
  non-blocked task.

## Skill Applicability

Implementation and reviewers must apply the installed skills where needed:

- `subagent-driven-development` for worker/reviewer separation.
- `test-driven-development` and `javascript-testing-patterns` for service
  behavior and streaming/cancellation tests.
- `nodejs-backend-patterns` for real Node service lifecycle concerns.
- `cqrs-implementation` for read-side/write-side segregation.
- `api-design-principles` and `typescript-advanced-types` for public service
  API shape and generated Protobuf-ES types.
- `verification-before-completion` before claiming task completion.

## Planned Shape

- Copy missing Spine service `.proto` files verbatim and generate Protobuf-ES
  code through the existing Buf workflow.
- Add a narrow service runtime package dependency only if required by the real
  service implementation, recording the decision and alternatives.
- Add semantic server source/test folders for service adapters.
- Expose only the smallest public construction API required for tests and later
  example wiring.

## Current State

Task setup is in progress. Implementation, review rounds, and verification have
not started yet.
