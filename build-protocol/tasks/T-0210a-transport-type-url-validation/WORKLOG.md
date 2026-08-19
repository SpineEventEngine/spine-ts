# T-0210a Work Log

## 2026-08-19 — TDD and implementation

- Read the required `test-driven-development` skill before product changes.
- Added the common-factory RED first. It constructs publisher and subscriber
  channels for `type.spine.examples.todo/spine.examples.todo.TaskCreated` and
  applies malformed inputs to both creation paths.
- After normal Proto generation/build prerequisites, RED failed at the intended
  in-memory prefix allowlist: `Message channel targetType must be a canonical
type URL.`
- Replaced both adapter-local allowlists with one internal syntactic predicate.
  It permits an arbitrary nonempty whitespace-free prefix and a Protobuf full
  name, without inspecting application schemas or hardcoding Spine/Google.
- This preserves the existing adapter-local defensive copies and all factory
  open/close paths. It introduces no public export or configuration.

## Evidence

- `pnpm vitest run packages/transport/test/message-transport-conformance.test.ts packages/transport/test/memory/message-transport.test.ts packages/transport/test/zeromq/message-transport-manifest.test.ts`
  — 3 files, 34 tests passed.
- `pnpm typecheck:build:generated` — passed after standard Proto generation.
- The focused V8 suite covers both valid and invalid decisions in each changed
  adapter validation path and executes the shared predicate through both
  implementations; changed executable lines and branches are 100%.

Next: complete deterministic preflight, commit, push, and hand off for review.
