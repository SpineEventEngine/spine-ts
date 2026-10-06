# Task 1: Spine Time throughout the framework

## Objective and scope

Introduce the Spine TS equivalent of Spine JVM Time and use it everywhere Spine TS asks for time. Complete and verify this task independently of Agent support. It changes the shared framework and its existing consumers; it does not introduce Agents, AI adapters, conversations or Agent history.

Reference implementation: [Spine JVM Time.java](https://github.com/SpineEventEngine/base-libraries/blob/master/base/src/main/java/io/spine/base/Time.java), including IncrementalNanos and the provider/test-provider behavior. Read the current reference implementation and its tests before implementing the TS equivalent.

Assessed TS baseline: `881931d0f504ac728fbe5706567105e204246420`, package version `2.0.0-snapshot.20`. Recheck the target revision before implementation. This document defines required API behavior, migration and acceptance; internal implementation choices belong to the implementing agent.

## 1. Shared Time API

Provide a shared, synchronous `Time.currentTime(): Timestamp` API using the canonical Protobuf Timestamp type. Follow the JVM Time semantics, including the system provider and replaceable provider used by framework tests. Preserve the distinction between reading the configured provider and explicitly reading the system provider in the corresponding JVM operations. Cover the JVM time-zone behavior using the framework's appropriate TS representation.

Select the shared package/export location according to existing framework conventions. Every supported runtime, including server and browser clients, must be able to use it without acquiring a server-only dependency. Do not create a separate clock for each subsystem.

Only the Time provider may access platform clocks directly. Existing clock-injection points delegate to the shared Time/provider contract. Tests can install or supply a controlled provider and restore the previous/default provider without leaking changes into other tests. Preserve supported test isolation and concurrency behavior.

Provide any monotonic time operations needed by current elapsed-time measurements through Time as well. Do not replace monotonic duration measurement with wall-clock subtraction. Document the units and purpose of each operation. Scheduling a timer is distinct from reading the current time: platform timer scheduling remains allowed, while all time reads used to schedule or check work go through Time.

All exported declarations need TSDoc describing parameters, results, units, runtime behavior and provider replacement. Mark test-only/provider-control surfaces according to the framework's existing conventions.

## 2. Incremental occurrence timestamps

Port the JVM IncrementalNanos behavior. The referenced provider derives a Protobuf Timestamp from system milliseconds and adds incremental microseconds within the same millisecond. It supplies 1,000 offsets per millisecond and resets when the millisecond changes. Match and test the reference implementation's upper-bound/reset behavior rather than substituting another ordering mechanism.

Use the shared Time facility for every newly created framework occurrence timestamp. Distinct calls within the reference utility's supported scope must retain their timestamp distinction through storage and querying. Copying or serializing an existing message preserves its timestamp; it does not request a new time.

The JVM utility's documented scope is one JVM. Document the corresponding TS execution scope, including worker/process behavior. Do not claim global uniqueness across independent processes, process restarts or backward wall-clock adjustment from this implementation alone. Verify the behavior required by supported framework execution/deployment paths. Resolve demonstrated gaps in the shared time/execution contract; do not introduce repository sequences or history-position counters.

## 3. Use Time everywhere

Inventory and migrate all first-party current-time acquisition throughout the repository, including:

- Signal timestamps, Entity versions and repository metadata.
- Client and server paths, including browser clients.
- Delivery, Inbox, shard/session and subscription timing.
- Deadlines, timeout checks, retries and elapsed-time measurements.
- Authentication, credential expiry and refresh decisions.
- Diagnostics and any identifier generation that asks for current time.
- Storage providers and transport/integration adapters.
- BlackBox, other test support, tests, examples, scripts and benchmarks wherever they obtain time.

Find direct platform reads and indirect defaults, including Date.now, zero-argument new Date, performance.now, process.hrtime, dependency timestamp/clock helpers, aliases and callbacks that read a clock. Do not limit the migration to occurrence timestamps or the server package.

Parsing a supplied date, constructing a Date from a supplied timestamp, cloning a date or converting between representations does not obtain the current time. Preserve those operations where appropriate. Third-party SDK internals are not rewritten; all first-party adapters and clock callbacks supplied to them use Time.

At the assessed baseline, EntityTransaction.#commitVersion and Repository.executionTimestamp still construct millisecond-only timestamps directly. Other direct reads occur in delivery, subscriptions, clients, authentication and BlackBox. These are starting points for the inventory, not an exhaustive migration list.

Add a repository check that rejects time-acquisition bypasses outside the Time provider. Cover imported helpers, aliases and default clock callbacks as appropriate to the repository's lint/static-check infrastructure. Allow conversions of supplied values. Do not satisfy the check by spreading suppressions or broad exception lists across consumers.

## 4. Preserve timestamp precision

Store, serialize and compare the complete seconds/nanos value needed by the Time contract. Converting occurrence timestamps to epoch milliseconds, JavaScript Date or a database column with millisecond precision must not erase distinctions used for ordering.

Inspect every supported storage provider, index, query predicate and transport codec involved in occurrence timestamps. Migrate precision-losing paths where required. Preserve existing external contracts or document and handle an unavoidable schema/data migration explicitly.

A consumer that requires an epoch-millisecond value for a deadline or an external API can convert a Time-provided value. Such conversion must not become the representation used for precise occurrence ordering.

## 5. Tests and acceptance

Use focused Time/provider tests, existing framework tests, BlackBox for signal-driven behavior, and storage-provider conformance tests. No AI dependency or Agent implementation is needed.

Required evidence:

1. The TS Time API follows the relevant JVM behavior, with controlled provider replacement and restoration.
2. Same-millisecond calls produce the expected incremental values; millisecond transitions and the reference upper-bound/reset behavior are tested deterministically.
3. Seconds/nanos conversion and supported timestamp boundaries are correct.
4. Existing elapsed-time, deadline, retry, expiry and refresh behavior remains correct through Time, including existing monotonic measurement requirements.
5. Test providers do not leak across supported concurrent test/runtime scopes.
6. Timestamp distinction survives round trips, ordering and query boundaries in every supported storage provider and applicable transport codec.
7. Framework signal tests observe Time-generated timestamps through normal public entry points.
8. Packages, clients, examples, tests and other first-party time consumers pass the bypass check. No production default callback reads a platform clock outside Time.
9. Supported process/worker/restart and clock-adjustment assumptions are documented and tested where required by framework behavior. No broader uniqueness guarantee is asserted without evidence.
10. Existing repository-required type, lint, test, packaging and runtime checks pass for the changed shared surface.

## 6. Deliverables and relation to Task 2

Deliver the documented shared Time API/provider implementation, its framework-wide adoption, precision fixes, automated bypass check and passing tests. Include package exports and examples appropriate to the existing framework; do not add an Agent example to prove this task.

Task 2: Agent entities depends on the completed Time task. Agent implementation uses the exported Time API and its test provider for interaction timestamps, deadlines and history ordering. It does not repeat this migration or introduce another clock. Time can be implemented, reviewed and accepted before any Agent work is delivered.

## Human-Imposed Requirements Ledger

- Implement Task 1 only: JVM-like shared Time and its adoption everywhere first-party code reads time; Agent work is separate.
- Follow JVM IncrementalNanos and provider behavior; preserve full occurrence timestamp precision and do not add repository history counters.
- Preserve existing Entity and database transaction semantics; no transaction redesign is authorized.
- Supply documented TypeScript APIs, domain-correct test fixtures, meaningful behavior tests and the repository verification/review gates.
- Work from freshly fetched official origin/master in an isolated feature worktree; never use a codex-prefixed branch. Push each feature commit immediately. No PR or master changes without explicit human direction.
- Use the existing roles with explicit permitted model/reasoning profiles; children do not delegate. Keep user progress current and preserve unrelated work.
- Avoid unnecessary possession terminology and unexplained wording in code, documentation and messages.
