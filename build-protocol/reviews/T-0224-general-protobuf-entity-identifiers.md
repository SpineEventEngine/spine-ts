# T-0224 Review Log

Status: Accepted after correction
Baseline: `5b7c6d1e55706363fef52162b0d0d995f504a3e2`

## Canonical concerns

- Specification and DDD/JVM compatibility: clean after correction.
- Routing, persistence, and canonical-ID correctness: clean after correction.
- Style and maintainability: clean after correction.
- TypeScript/public API documentation: clean after correction.
- Performance and reliability: clean after correction.
- Reader documentation: clean after fresh-review correction.
- Security: N/A as a separate per-task lane; malformed external data remains in
  correctness scope and the final project security gate remains unchanged.

## Review waves

The frozen review endpoint was `5465277ed`. All reviewers received explicit
existing roles or concern functions and the required model profiles.

- Correctness found that an inherited `$typeName` could pass shallow message
  recognition.
- Reliability found that `Identifiers.pack()` deliberately skips schema
  validation, so routing had to call the established `Validate.check()` first.
- Maintainability found an obsolete one-field route-result wrapper and brittle
  numeric descriptor positions in the composite test fixture.
- TypeScript/API documentation found that the codec documentation did not
  distinguish shallow message recognition from the legacy scalar adapter.

The existing implementation owner applied one consolidated correction in
`2693e120b`. The focused re-review endpoint was that commit. Correctness,
reliability, and API-documentation re-reviews were clean. Maintainability found
one redundant own-property check; deterministic cleanup `61695d43c` removed it
without changing behavior. Its narrow tests, ESLint, TSDoc, tooling typecheck,
formatting, and diff checks passed, so it did not reopen a semantic lane.

Runtime self-introspection was unavailable. The explicitly dispatched profiles
and immutable specialist role profiles are the accepted metadata:

- correctness/compatibility: `gpt-5.6-terra`, high;
- style/maintainability: `gpt-5.6-terra`, high;
- TypeScript/API documentation: `gpt-5.6-terra`, high;
- performance/reliability: `gpt-5.6-terra`, high.

## Release gate

After version alignment, the first release run exposed two stale snapshot.7
test assertions and no implementation finding. Their focused correction passed
23 tests. The complete rerun passed 287 test files and 4,552 tests with 90.01%
branch coverage; all other global coverage measures exceeded 92%.

## Fresh two-axis review

The fresh comparison used the fixed branch baseline
`5b7c6d1e55706363fef52162b0d0d995f504a3e2` and reviewed the actual complete
diff without relying on prior review conclusions.

### Standards

The Standards reviewer found that the public `MessageId` behavior was absent
from the server package README and REFERENCE. Commit `f0d8c2aa8` adds concise
beginner guidance and detailed contract documentation. Re-review was clean.

### Specification

The Specification reviewer found three missing explicit proofs: generated
one-field `uuid` routing, custom composite Command routing, and composite
Command Entity Inbox handoff/replay. Commit `f0d8c2aa8` adds all three; the
focused suite passes 262 tests. Re-review confirmed all three requirements are
satisfied.

The reviewer initially questioned whether the reader documentation exceeded
scope, then withdrew that finding after rechecking the full branch. Runtime
routing now accepts complete message IDs that were previously rejected, which
satisfies the requirements review's documentation exception; `CODE_QUALITY.md`
also requires current package documentation for changed public behavior.

Both fresh review axes are clean and no finding remains open.

## Human-superseding compatibility correction

The human superseded the prior exact scalar-wrapper compatibility decision: no
message candidate is converted automatically to a primitive Entity ID. The
implementation removes the adapter and proves that generated `TaskId` is
rejected for a primitive target unless a custom route deliberately returns
`message.id.value`. No backward compatibility was requested.

Affected correctness and standards re-review is clean after the superseding
correction. The final release gate passed 287 test files and 4,557 tests with
90.01% branch coverage; artifact inspection and the isolated external consumer
also passed.
