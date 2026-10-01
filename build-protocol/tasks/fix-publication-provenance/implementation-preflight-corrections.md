# Implementation preflight corrections

Apply in the existing implementation context after the delivery slice returns.
Main records additional confirmed findings here; this is not a new reviewer.

Status: the stale MySQL assertions and focused coverage setup below are fixed;
the latest storage selection passes 590 tests. The comparison and descriptor
follow-up is implemented and tested, but the one-second target remains open
pending an uncontended measurement and independent assessment.

1. The full ordinary four-storage-package test selection ran 585 tests:
   583 passed and two failed. Both transactional/nontransactional cases in
   `packages/storage-mysql/test/mysql-factory-commit-mocked.test.ts:115` still
   expect `"committed"` from the removed Entity result. Update those assertions
   to the new Promise<void> contract. Preserve unrelated coordinator return
   values in mysql-entity-commit-contract.test.ts.
2. Rerun that bounded selection with focused coverage after the correction.
   Previous failed run produced no coverage. Exact log:
   `/tmp/entity-storage-focused-tests.log`. Do not add a trailing dot to the
   Vitest path arguments and do not use zsh's reserved `status` variable.

## Remaining delivery cost

The combined implementation still measures 1.315–1.389 seconds for each 1,000
recipient run. Profile evidence is in `/tmp/entity-delivery-profile-final.md`
and `/tmp/entity-delivery-profile.ZTRAPt/CPU.20261001.125239.14605.0.001.cpuprofile`.
The profile covers the whole benchmark process, not only its timed section;
use call stacks and bounded measurements before making causal claims.

Main's additional inclusive sample totals: `getOption` 1,593 ms,
`describeEntityMetadata` 647 ms, tenant query `selectBounded` 1,088 ms, and the
validation dependency's `createRootRegistry` 1,111 ms across the whole profile.
The latter has no supported registry argument in the installed validation API;
do not patch the dependency or skip validation. These totals overlap and must
not be added as independent costs.

Investigate and apply only behavior-preserving reductions of repeated work in
the existing paths: preparing query comparison values once instead of repeatedly
normalizing the same records, and avoiding repeated full Entity metadata
extraction merely to pack one ID when the repository's descriptor already
contains that information. Prefer the existing per-operation or storage-handle
lifetime; no unbounded global cache or new public service. Preserve complete
validation, mutable-input isolation, ordering, Unicode/numeric/object identity
semantics, continuation behavior and all coordination checks. Add focused tests
for any optimized path and rerun the identical real benchmark without coverage.

This is a bounded performance follow-up under the plan's measurement clause,
not permission for a broad redesign. Report a concrete need for a new contract
before taking that route. Do not reduce the benchmark work or change its target.

One further source-backed candidate for the same comparison path:
`CanonicalUtf8.compare()` currently allocates and fills two byte arrays even
when both strings are identical. Start with the equal-string fast path. If
needed, compare code points directly without allocating encoded arrays: UTF-8
lexicographic order follows code-point order, including the existing encoder's
handling of lone surrogate code units. Prove equivalence against the current
byte comparator over ASCII, non-ASCII, supplementary characters, prefixes and
lone surrogates before retaining a change. Preserve the documented sign of the
comparison; do not replace canonical ordering with JavaScript code-unit order.
Do not change `bytes()` or query semantics merely for speed.

The documentation function continues independently in its reserved five-file
comments-only scope. Do not edit those files until main confirms it returned.
