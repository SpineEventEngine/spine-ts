# M01 performance and reliability review

Existing `performance_reliability_reviewer` concern; dispatched with explicit
`gpt-6-sol` / `medium` in `REVIEW.md`. Runtime model metadata is not exposed on
this surface. Read-only review of the M01 shared-validation diff against
`856119900`, including the untracked validation module, test, and Proto fixtures.

## P0–P2 findings

None confirmed.

The new path calls the pinned validator first, then traverses only declared
`(validate)` message edges to supplement annotated `Any` resolution and required
collection members (`packages/core/src/index.ts:602–616`,
`packages/core/src/validation/registry-validation.ts:86–113`). At a locally
known `Any`, the pinned validator supplies payload constraint violations and
the supplement skips a second payload validation; it still checks malformed
bytes and required members (`registry-validation.ts:166–186`). At a registry-only
`Any`, the supplement decodes and validates the payload once, prefixing its
violations with the root path. The pinned validator's `Any` implementation
silently skips unknown or undecodable payloads, so the added malformed-known
check closes that gap. The facade copies and redacts placeholders from both
sources and converts validator exceptions to a sanitized technical error.

No changed path mutates the message or registry. The traversal and violation
accumulation are synchronous and finite for finite generated messages; its work
scales with the visited fields, collection entries, and decoded packed payloads.
No new persistence, retry, or shutdown mechanism is part of M01.

## P3 test gaps

- Add a case with a registry-only application payload containing an annotated
  nested `Any` and a required collection member. The current tests cover those
  behaviors separately, but not their composition
  (`packages/core/test/validation-registry.test.ts:28–102,145–198`). This would
  guard root-relative paths and single reporting across two packed boundaries.
- Add a facade test whose application-registry lookup throws, asserting the same
  sanitized technical error as the existing upstream-throw test
  (`packages/core/test/validation-facade-boundary.test.ts:90–111`). This protects
  the newly added lookup failure path and its error classification.

No production files were edited and no tests were run during this review.

## Targeted correction re-review

The correction at `registry-validation.ts:136–145,285–299` skips null and
undefined values during annotated `Any` descent and reports them through the
required-member rule. It preserves numeric `0` and boolean `false` as present.
The new tests cover those cases, a root-relative required-member violation
under nested application `Any`, and sanitized technical classification when
the application registry lookup throws
(`validation-registry.test.ts:205–287`). Those additions close both P3 gaps
recorded above. The supplied correction verification reports 79 tests, at
least 90% scoped coverage, generated build/lint/format/TSDoc, and a packed
core consumer passing. This reviewer did not rerun that suite.

### P2 — Sparse required list member becomes a technical error

`RegistryValidation.entries()` creates list tuples with `value.map(...)`
(`registry-validation.ts:308–311`). JavaScript `map` preserves holes, so
`requiredMembers()` destructuring the resulting iterable throws before it can
report the missing member (`registry-validation.ts:264–266`). An application
can supply a generated message with a sparse repeated array through the public
`Validate.message()` API. With the published `IdFilterSchema`, this direct
reproduction returns no upstream violations but throws `Validation runtime
failed.` from the shared facade:

```js
const m = create(IdFilterSchema);
m.id = Array(1);
validate(IdFilterSchema, m); // [] from the pinned validator
Validate.message(IdFilterSchema, m); // throws "Validation runtime failed."
```

This is a missing required member, so it should be a constraint violation at
`id[0]`, consistent with null and undefined members. Iterate list indices
explicitly so holes become undefined entries, and add a sparse-list regression
case. The same tuple construction also affects annotated repeated-message
descent, so the fix should cover both consumers of `entries()`.

### P2 resolution confirmation

Resolved by dense indexed tuple creation with `Array.from()` in
`registry-validation.ts:308–315`. It supplies an `undefined` entry for each
sparse hole, allowing `requiredMembers()` to emit the field violation and
`scanValues()` to skip absent `Any` entries. Regression cases cover both a
required numeric list and an annotated required `Any` list
(`validation-registry.test.ts:243–280`). A direct rerun of the published
`IdFilterSchema` reproduction against the current core build returned
`{"valid":false,"paths":[["id","0"]]}`. The supplied focused verification
reports 81 tests, at least 90% scoped coverage, affected core compile/lint/
format/diff checks, and a repacked installed consumer with sparse assertions
passing. No further reliability finding remains for this targeted correction.
