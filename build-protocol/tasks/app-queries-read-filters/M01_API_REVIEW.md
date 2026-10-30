# M01 TypeScript/API documentation review

Scope: changed public and package-internal validation contracts, declarations, exports, Proto fixtures, documentation, and runtime/type agreement. Reviewed against `856119900`, including the untracked validation module and tests. Existing `typescript_api_docs_reviewer` profile: explicitly dispatched `gpt-6-sol` / `medium`; runtime self-introspection was not exposed.

## Actionable findings

### P2 — Missing numeric and boolean members of required collections pass validation

`packages/core/src/validation/registry-validation.ts:284-290` returns `true` for every scalar other than string and bytes. Thus a runtime value such as `counts: [undefined]` or `flags: [null]` passes `requiredMembers`, while the upstream `(required)` rule checks only whether the collection is nonempty. `Validate.message` can consequently return `valid: true` for missing-valued members despite the new public README/REFERENCE guarantee and M01 requirement. The tests cover `0` and `false` defaults, but not absent numeric/boolean entries (`packages/core/test/validation-registry.test.ts:146-182`). Check scalar member presence before accepting valid defaults, and add a focused case proving `0`/`false` remain valid while `null`/`undefined` are violations.

### P2 — Missing recursively validated `Any` collection members become technical errors

`packages/core/src/validation/registry-validation.ts:136-142,174` casts every repeated/map `Any` entry and immediately reads `packed.typeUrl`. For a missing member (`null` or `undefined`) under `(validate)`, this throws; `Validate.message` catches it and throws the sanitized technical `Error` (`packages/core/src/index.ts:608-616`). If the collection is also `(required)`, the supplement first records a missing-member violation but discards it when the scan throws. That breaks the new invalid-input versus validator-failure contract for a missing client value. Skip or classify absent entries before calling `any()`, retaining the `(required)` violation when declared, and test a repeated or mapped `Any` with both options.

## Disposition

No P0 or P1 findings. The optional `TypeRegistryLookup` argument is reflected in the generated `dist/index.d.ts` and package entrypoint; the new internal module is not a package export. TSDoc and core README/REFERENCE describe the changed error channel and registry parameter. The new Proto fixtures represent project criteria and read requests without authored `optional` fields. The installed packed-core proof and focused test/preflight results were supplied by the orchestrator; this review did not repeat them. TargetFilters declaration migration is explicitly deferred to M03.

No P3 observations.

## Targeted re-review after corrections

- **P2 missing scalar collection members — resolved.** `RegistryValidation.present()` now rejects `null` and `undefined` before accepting numeric and boolean defaults (`registry-validation.ts:285-294`). The new test checks absent `counts` and `flags` entries while retaining valid `0` and `false` (`validation-registry.test.ts:205-225`).
- **P2 missing recursively validated `Any` members — resolved.** `scanValues()` skips absent entries before reading `typeUrl` (`registry-validation.ts:136-144`), leaving `(required)` member violations intact. The new fixture declares both options on repeated and mapped `Any`, and the test asserts the two field paths (`validation-registry.test.ts:227-241`).
- The related nested application `Any` case asserts one root-relative path with no duplicate (`validation-registry.test.ts:243-261`). A throwing registry lookup remains a sanitized technical error (`validation-registry.test.ts:263-286`). No new API finding in this targeted re-review.

The orchestrator supplied the corrected 79-test, coverage, generated build, static-check, and packed-consumer results; this review inspected the corrected source and behavior tests without rerunning those checks.
