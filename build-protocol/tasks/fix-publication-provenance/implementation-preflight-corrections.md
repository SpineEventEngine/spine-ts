# Implementation preflight corrections

Apply in the existing implementation context after the delivery slice returns.
Main records additional confirmed findings here; this is not a new reviewer.

## Checkpoint CI findings to correct before the next push

GitHub run `36861863987` failed at ESLint for checkpoint `f5f6cce81`.
The earlier focused lint selection did not cover all changed files; it was not
equivalent to the release gate. Correct these deterministic findings in the
existing implementation context, then lint every changed TypeScript file
against the extension baseline, not merely the latest tuning slice:

- `memory/in-memory-entity-commit.ts`: callable-only interface at line 52;
  forbidden non-null assertions at lines 228 and 231.
- PostgreSQL `entity-commit.ts`: returning a void expression at line 246;
  unnecessary conditional at line 393.
- Datastore `entity-history.ts`: returning void expressions at lines 187 and 216.
- Server `repository-routing.test.ts`: returning void expressions at lines
  14932, 14954 and 15011.

Preserve behavior, error propagation and retry semantics. These mechanical
corrections do not require reopening architecture review. Source:
https://github.com/SpineEventEngine/spine-ts/actions/runs/36861863987/job/110367766885.

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

Additional source-backed candidate for the existing implementer, after the
Stand metadata experiment: Stand's `#prepareUpdate` calls `EntityRecords.pack`
to prepare the state record. Each repository commit then calls the same packer
again for the same accepted state/version/lifecycle, instead of using that
prepared record. `AnyMessages.pack` validates the state on both calls; the
in-post profile identifies registry preparation as significant work. Investigate
reusing the actual prepared record through the existing internal deferred-update
result, rather than preparing, validating and encoding the same immutable value
twice. This is not permission to set `validate: false`, skip transition or
packing validation, expose a public result type, or trust mutable caller state.
Preserve ID/schema checks, exact state/version/lifecycle bytes, input isolation,
subscription snapshots and failure cancellation for every affected Entity
family. Test invalid state and mutation while preparation awaits. Measure the
same workload before retaining the correction. This candidate is supported by
source but its actual speed benefit remains unmeasured.

The Inbox conditional-update comparison has another small candidate without
removing any check: `StoredRecords.equal` currently normalizes, creates a second
tagged tree and JSON-encodes each complete record solely to compare the resulting
strings. The existing `StoredValues.compare(left.record, right.record) === 0`
already compares normalized trees. Establish equivalence for the admitted
value kinds (including bytes, nested objects, property order, undefined, NaN,
infinities, signed zero, bigint and sparse arrays versus explicit undefined
elements) before using that existing comparison. Do
not remove either delivery snapshot/CAS check, introduce a new equality service,
change record keys/query ordering, or retain an ineffective change. Measure
this separately from prepared-record reuse.

If comparison equivalence fails (sparse arrays are a likely distinction), do
not change equality semantics. A smaller alternative within the same measured
path is to remove the intermediate normalized tree from canonical key encoding.
`encode`/`encoded` are used only by `key` and recursively by themselves in this
module. They can potentially emit the same tagged JSON representation directly
from raw values, with sorted object keys and unchanged handling of bytes,
bigint, numbers, undefined and array holes. This should replace the existing
encoder, not add a second service or cache. Prove identical key strings against
the current algorithm over all supported value kinds and nested combinations,
then measure; record layout, keys, comparisons and malformed-input behavior
must not change. The worker profile's repeated normalization/encoding work is
the evidence for this candidate, not a claim of a guaranteed speed improvement.
Include numeric-looking object keys: the old normalization inserts sorted keys
into an object, whose subsequent enumeration puts array-index keys in numeric
order before other keys. A direct encoder must preserve that order, not merely
map over a lexicographically sorted key list. Include `__proto__`, object
prototypes, non-enumerable/symbol properties and sparse-array holes in the
equivalence evidence. Reject any alternative that only agrees on ordinary
string-keyed examples.

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
