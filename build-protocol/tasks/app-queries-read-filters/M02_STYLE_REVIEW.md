# M02 code style and maintainability review

Existing `style_maintainability_reviewer` role, explicitly dispatched with
`gpt-6-sol` / `medium` reasoning. Runtime model self-introspection was not
exposed; the configured role/profile and explicit dispatch are the available
metadata. Reviewed the current tracked and untracked M02 changes against
`3227be3ac`, the active TASK.md ledger, M02.md, `CODE_QUALITY.md`, and the
affected Command/Event paths. No production files were edited and no tests were
rerun.

## Actionable findings

### P2 — Event test adds a user ID as an entity producer ID

`packages/server/test/bus/event-bus.test.ts:208,214` newly populate
`EventContext.producer_id` with `UserIdSchema` and the value `aggregate-1`.
`packages/proto/proto/spine/core/event.proto:142-146` defines that field as
the ID of the entity that generated the Event. A user ID and an aggregate ID
represent different domain concepts; the new fixture would keep passing even
if producer-ID handling wrongly accepted a user identity. Use a producer entity
ID message appropriate to these Review events. The older helper at
`event-bus.test.ts:1289,1303` has the same mismatch, so adjust it as needed to
keep this test's inputs coherent. This is the repository's explicit
domain-correct Proto fixture rule, not a Proto wire-shape concern.

### P2 — Constructor TSDoc still limits a broadened error to payloads

`packages/server/src/bus/command-errors.ts:39-43` now constructs errors for
both incomplete Command envelopes and invalid payloads, but the constructor
parameter is still documented as "structured payload validation details."
That contradicts the class summary and `checkEnvelope()` use in the same file.
`CODE_QUALITY.md` requires semantic TSDoc for modified production methods;
describe the parameter as Command validation details across both cases.

## Disposition

No other independent P0-P2 style or maintainability findings. The modified
callables remain within the 35-physical-line limit, and the shared registry
inventory is reused without a signal-specific registry or additional public
facade. No P3 advice. M03 and later behavior was excluded. The already-fixed
preflight `#post` length finding was not repeated.
