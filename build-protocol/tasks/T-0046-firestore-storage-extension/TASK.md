# T-0046: Firestore-compatible storage extension

Status: Completed, merged, post-merge verified, and pushed

## Objective

Implement a separate Firestore-compatible storage package using the analysis in
[`docs/firestore-storage-extension-analysis.md`](../../../docs/firestore-storage-extension-analysis.md)
and the pinned JVM `gcloud-jvm/datastore` source as the compatibility authority.

## Human-Imposed Requirements Ledger

- The adapter package is named `@spine-ts/storage-datastore`, matching the JVM
  module and Cloud Datastore terminology; no `storage-firestore` package is
  introduced.
- Target the Cloud Firestore Datastore-compatible model, not Firestore Native
  mode.
- Inspect and pin the latest JVM `gcloud-jvm/datastore` source before deciding
  TypeScript behavior, configuration, credentials, testing, or portability.
- Produce a detailed, implementation-ready plan before any module code; the
  implementer must execute that plan without making significant architectural
  decisions.
- Preserve the JVM principle that storage is a port: applications can select a
  Datastore adapter or another `StorageFactory` without domain/framework code
  depending on a concrete persistence provider.
- Determine emulator testing and production credential/configuration patterns
  from the JVM module first.
- Do not modify the protected `human-review-1-jul.md`.
- The human approved a minimal provider-neutral `RecordSpec` read-only schema
  accessor, because external storage adapters need the existing Protobuf schema
  to encode and decode records. It must expose no Datastore types or behavior.
- After the adapter is ready, add a separate test-oriented orders/SKUs/sales
  example with exactly 2 aggregates, 2 process managers, 10 projections, and
  independent gRPC performance scenarios at 10, 100, and 1,000 users.
- Approved remediation decisions: use strict finite query materialization with
  provider pushdown and an overflow error rather than an unlimited scan or a
  new generic cursor API; support only exact signed 64-bit indexed Datastore
  integers and reject out-of-range bigint values before RPC; retain the
  datastore-orders load-runner cancellation repair as T-0046's final
  example-quality slice.
- Project-management and broad coverage-policy edits are a distinct prerequisite
  task, T-0048. T-0046 must resume only after T-0048 is complete, merged,
  post-merge verified, and pushed.

## Follow-on datastore orders app acceptance

- `examples/datastore-orders` is a generated-Protobuf, test-oriented app with
  exactly two aggregates (`Order`, `Sku`), two process managers, and ten
  projections. Its explicit topology inventory and runtime registration must
  both assert those counts.
- The application receives a generic `StorageFactory` at bounded-context
  composition. Its Datastore entrypoint creates `DatastoreStorageFactory` and
  passes it only through `withStorageFactory`; domain handlers do not import or
  inspect Datastore implementation types.
- Focused loopback tests prove a real gRPC command acknowledgement, eventual
  query visibility, and correlated subscription delivery. They use the
  in-memory factory only as a test double for the generic composition seam;
  Datastore behavior remains adapter-tested in its own package/emulator suite.
- Load users are independent asynchronous gRPC clients with distinct command,
  query, subscription, and cleanup lifecycles. The runner multiplexes their
  HTTP/2 transports over a bounded pool and executes sustained waves of at most
  ten actors; it does not alter logical-user independence. Supported CLI levels
  are exactly `10`, `100`, and `1000`; the focused test runs the 10-user smoke
  level.
- Runtime behavior follows TDD. This task log records the focused RED and
  GREEN commands and outcomes in the same change sequence.

## Planning assignment

- Existing role: `requirements_splitter` acting as the requested
  architect-planner.
- Scope: source-grounded storage-port compatibility analysis and a phased
  implementation plan only; no production implementation.
- Expected model/reasoning: `gpt-5.6-sol` / `high`.
- Acceptance requires explicit dispatch fields and runtime metadata matching
  the expected profile, recorded in the work log before the plan is accepted.

## Required sequence

1. Pin and inspect the JVM module; produce a mapping/compatibility matrix.
2. Confirm the TS storage seam is sufficient without expanding core exports.
3. Design key, tenant, serialization, query, cursor, transaction, CAS, batch,
   retry, and close semantics.
4. Write emulator-first RED tests, implement the adapter, and add opt-in cloud
   verification only if credentials are available.
5. Run canonical docs/API/type/reliability review and record exclusions.

## Accepted implementation contract

`docs/firestore-storage-extension-analysis.md` is the binding plan. It was
written from the pinned JVM source after the architect-planner child did not
return a usable result. Implementation must follow its package boundary,
configuration, namespace, codec, query, CAS, batch, emulator, credential, and
documentation decisions without widening the generic storage port.

## Current implementation boundary

- The human-approved `RecordSpec.schema` accessor is available in the current
  worktree. It is the only generic-storage change authorized for this adapter;
  preserve the existing edit and make no further generic storage or server
  changes without explicit human approval.
- The current owner writes only `packages/storage-datastore/**`,
  `docs/USER_GUIDE.md`, and T-0046 durable task/work/review records. The
  orders/SKUs/sales example begins only after adapter readiness evidence is
  recorded.
- Runtime changes follow behavior-focused TDD: each adapter behavior requires
  focused RED evidence before its minimal implementation and focused GREEN
  evidence after it.

## Non-goals

No replacement of the in-memory adapter, no Firestore-specific APIs in the
generic storage package, no implicit credentials, and no claim of transparent
cross-adapter transaction semantics until proven by tests.

## 2026-07-20 resumption boundary

- T-0048 is complete on `origin/main` at closure commit `1d4d94c5`; its
  prerequisite is satisfied.
- Main owns the communication rule and final project-management runner/coverage
  behavior. T-0046 discards its superseded local project-management runner
  hunk during integration and retains only Datastore-specific work.
- The shared proto-workflow test keeps main's lint correction plus T-0046's
  Datastore generated-target additions.
- Remaining implementation follows the approved remediation plan in order:
  canonical IDs and typed/finite queries; CAS/lifecycle/emulator evidence;
  TypeDoc/API docs; datastore-orders cancellation and instrumented coverage.

## Remediation milestone 1 execution record — 2026-07-20

- Assigned scope is only `packages/storage-datastore/**` and T-0046
  task/work/review records; no generic-storage/server contract change, generic
  cursor, unlimited scan, example cancellation work, commit, or subagent.
- Canonical skill applicability: `test-driven-development` and
  `verification-before-completion` apply and were fully read before governed
  action. Debugging, advanced-TypeScript, and error-handling skills are not
  selected because no unexpected failure or new public type/recovery policy has
  been introduced; the approved plan specifies the bounded-error behavior.
- Acceptance evidence must include focused RED then GREEN behavior tests for
  A–C, package build/typecheck, focused ESLint/Prettier, and `git diff --check`.

- Result: A–C focused RED/GREEN and requested mechanical evidence are recorded
  in `build-protocol/work-logs/T-0046.md`; emulator verification, CAS/lifecycle
  hardening, TypeDoc/API checks, and the datastore-orders slice remain pending.

## Remediation milestone 2 execution record — 2026-07-20

- Transaction credential/payload redaction, rollback-attempt behavior, opt-in
  emulator scenarios, and Datastore TypeDoc/API registration are recorded in
  the work log. The live emulator run remains pending external loopback access;
  no cloud credential fallback is authorized.

## Transaction-conflict remediation — 2026-07-20

- A bounded code-10 transaction-conflict retry is covered by focused RED/GREEN
  unit behavior and requires a fresh emulator-capable root rerun before the
  persistence finding can be closed.

- The contention scenario uses a local 15-second emulator timeout, calibrated
  from the root's isolated 3.15-second passing execution; no global test-timeout
  or production retry-policy change was made.

- Pre-review tooling TS7023 is repaired in the CAS test fake with explicit void
  callback return types; the complete generated/tooling typecheck is recorded
  green in the work log.

- The private CAS retry-bound name is cleanup-compliant and `lint:generated`
  passed after its behavior-neutral rename.

## Combined adapter review-fix result — 2026-07-20

- All accepted adapter findings are implemented with focused RED/GREEN evidence
  and clean generated typecheck/lint/format/diff gates. Live emulator acceptance
  remains assigned to the root environment because child loopback access is
  denied; no cloud fallback is permitted.

- Safe Datastore integer decoding now preserves source bigint through private
  unindexed column-type metadata, with focused filter/order/continuation
  regressions. Root must rerun the expanded live emulator gate.

## CAS contention backoff — 2026-07-20

- The post-bigint root gate passed 27/28 and isolated synchronized immediate
  retry as the final CAS failure. Exact-code-10 retries now use a bounded 100 ms
  exponential base plus jitter while retaining three total attempts and all
  existing classification/redaction semantics.
- Deterministic unit RED/GREEN and generated typecheck/lint evidence are green.
  Root live emulator repetition remains required before acceptance.

## Final combined adapter re-review remediation — 2026-07-20

- All provider reads now request wrapped integers, preserving exact signed-64
  bigint endpoints without changing safe untagged numeric semantics. CAS is
  split into a bounded retry policy and one transaction-attempt helper.
- Seven opt-in emulator scenarios now include signed-64 read/query/CAS and the
  501-row batch/lifecycle/client-ownership boundary, with unique kinds and
  targeted cleanup. Query and emulator documentation matches the implemented
  fixed-sentinel/local-reconciliation design.
- Focused unit and generated typecheck/lint/docs gates pass in the child
  environment. Root live emulator verification and accepting re-review remain
  required before closure.

## Unsafe-number closure residual — 2026-07-20

- Ordinary finite numbers now use explicit Datastore double representation on
  writes and filters, preventing wrapped reads from changing unsafe integer
  numbers into bigint. Bigint remains an exact signed-64 Datastore integer with
  private type metadata.
- Provider-faithful unit RED/GREEN covers `Number.MAX_SAFE_INTEGER + 1`
  round-trip/equality/order beside both bigint endpoints; the live emulator
  scenario carries the same regression. Focused unit and generated
  typecheck/lint/docs checks pass in the child environment.
- Prior adapter/example implementation and the 31/31 root live gate are
  complete. Root live repetition for this final numeric assertion and focused
  closure re-review remain before commit acceptance.

## Canonical codec coverage closure — 2026-07-20

- Private codec tests now cover all supported identifier kinds across canonical
  round-trip, equality, ordering, independent storage handles, and sanitized
  malformed persisted identifiers. Symbol/function identifiers explicitly fail
  instead of colliding with undefined.
- Focused coverage passes the unchanged repository thresholds at 102/102 codec
  branches (100%), 34 more covered branches than the prior global 68/96 record.
  Focused tests pass 29/29, with generated typecheck and lint/cleanup green.
- No coverage threshold/exclusion, public export, example, or unrelated behavior
  changed. Closure acceptance remains with the root review flow.

## Canonical decoder alias remediation — 2026-07-20

- Fixed canonical tags now require exact array arity, bigint decimal text must
  be canonical, and object entries must be exact pairs in strictly ascending
  unique-key order. Variadic arrays and valid own `__proto__` objects remain
  supported.
- Persisted alias/malformed cases surface only the sanitized Spine identifier
  error. Focused tests pass 29/29; private codec coverage is 113/113 branches;
  generated typecheck and lint/cleanup pass.
- No public API/export, threshold/exclusion, docs/example, or unrelated behavior
  changed. Closure acceptance remains with the root review flow.

## Integration closure — 2026-07-20

- Task commit `cca9978e` was pushed to
  `origin/task/T-0046-storage-datastore` immediately after commit.
- Merge commit `12ed11e8` was pushed to `origin/main` immediately after merge.
- Fresh post-merge `pnpm --config.verify-deps-before-run=false verify` passed on
  `main`: 80 test files / 1,855 tests, with 2 files / 8 tests intentionally
  skipped. Coverage remained 94.41% statements, 90.09% branches, 94.68%
  functions, and 94.85% lines; every generated, type, lint, cleanup, format,
  documentation/API, proto, and release-readiness gate passed.
- The explicit post-merge Datastore emulator run passed 2 files / 36 live
  tests. Cloud smoke remains intentionally unclaimed because no explicit cloud
  credentials were authorized.
- Main's pre-existing dependency virtual store did not materialize the locked
  `async-mutex` to `tslib` link after incremental and forced installs. The
  existing generated dependency tree was preserved, a clean frozen-lockfile
  install rebuilt the virtual store from the local package cache, and the full
  post-merge gates then passed.
