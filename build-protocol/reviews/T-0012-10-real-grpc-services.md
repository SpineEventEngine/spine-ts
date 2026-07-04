# Review Log: T-0012.10 Real gRPC Services

Status: round 3 fixes verified
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

Round 1 fixes passed the final required verification pass and were committed.

## Round 2

Review round 2 left three issues in performance/reliability, documentation,
and TypeScript/API behavior. The implementation was updated to:

- expire never-activated subscription records after a configurable inactive
  TTL, defaulting to 30 seconds;
- bound each active subscription update queue with a configurable queue limit,
  defaulting to 100, and close/remove slow consumers when the limit is exceeded;
- preserve explicit activation semantics plus deterministic cancel and iterator
  cleanup;
- validate `Topic.id`, `Topic.context`, and `Target.criterion` before accepting
  a subscription topic, even when the target type is registered;
- refresh the top service-slice summaries in the user guide, API guide, and
  architecture overview;
- correct the architecture guide to state that the package root exports
  `SpineServices`; and
- update the proto package README to mention `Ack`, `Response`, and the
  `spine/client` command/query/subscription service contracts.

Focused service tests now cover abandoned inactive subscription cleanup,
slow-consumer queue closure, and known-target malformed topic rejection.
Round-2 fixes passed the final required verification pass.

## Round 3

Review round 3 left three issues in security, task documentation, and proto
README API wording:

- tenant validation must treat `TenantId.domain` and `TenantId.email` as present
  tenant variants, not just `TenantId.value`;
- `TASK.md` must reflect the round-3 state instead of the stale round-1 state;
  and
- the proto README must clarify that copied service/support protos are generated
  and available through generated subpaths, while package-root exports remain
  curated.

The implementation now treats all valid `TenantId` oneof variants as tenant
presence. `TenantId.value` keeps its raw value key; `TenantId.domain` and
`TenantId.email` derive stable `domain:<value>` and `email:<value>` keys for
Stand read/subscription options. Single-tenant command/query/subscription
services reject any tenant variant with the existing stable contract errors.

Focused service tests cover command, query, and subscription domain/email
variants. Round-3 fixes passed the requested relevant verification pass.
