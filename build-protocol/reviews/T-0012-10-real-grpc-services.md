# Review Log: T-0012.10 Real gRPC Services

Status: round 1 fixes verified
Task log: `build-protocol/tasks/T-0012-10-real-grpc-services/TASK.md`
Branch: `task/T-0012-10-real-grpc-services`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-10-real-grpc-services`
Baseline commit: `caec16a`

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

Review round 1 completed with findings in performance/API/security,
performance/reliability/security, TypeScript/API contract, style, and
documentation lanes. The implementation was updated to:

- defer subscription delivery until `Activate`;
- clean up subscription delivery on cancel and stream finalization;
- route commands from built command type registrations instead of
  dispatch-probing contexts;
- validate command/query/subscription tenancy before dispatch/read/activation;
- sanitize public command/query error messages;
- preserve Stand-recorded entity versions in `QueryService.Read`;
- reject malformed or unsupported subscription topics with gRPC invalid
  argument errors;
- move DOM ambient typing from the shared base config to the server package; and
- refresh user/API/architecture/task/review logs.

Round 1 fixes passed the final required verification pass and await commit.
