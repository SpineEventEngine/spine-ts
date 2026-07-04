# Review Log: T-0012.10 Real gRPC Services

Status: in progress
Task log: `build-protocol/tasks/T-0012-10-real-grpc-services/TASK.md`
Branch: `task/T-0012-10-real-grpc-services`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-10-real-grpc-services`
Baseline commit: `63216fe`

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Review Focus

Reviewers must verify:

- exact Spine JVM protobuf service contracts for `CommandService`,
  `QueryService`, and `SubscriptionService`;
- real gRPC runtime wiring, not simulation;
- thin adapters over the existing command bus, direct `Stand`, and subscription
  handles;
- opaque subscription IDs and explicit activation/cancellation semantics;
- strict read-side/write-side segregation;
- small JVM-familiar public API and names;
- generated code remains ignored and reproducible; and
- coverage remains at or above 90%.

## Current State

Task setup is in progress. No implementation review has run yet.
