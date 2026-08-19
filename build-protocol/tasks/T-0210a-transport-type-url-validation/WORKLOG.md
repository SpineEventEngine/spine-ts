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

## 2026-08-19 — First checkpoint and review correction

- First checkpoint `3722e725b` was pushed to
  `origin/codex/t0210a-type-url` after the original focused validation.
- The initial local evidence also completed generated build, tooling typecheck,
  targeted ESLint, TSDoc, Prettier, API/audience/snippet documentation checks,
  and `git diff --check`. The scoped `verify:task` command started and visibly
  completed its Node, Proto-generation, and generated-build stages, but the
  execution surface detached before its terminal status was observable. It is
  recorded as incomplete rather than claimed green and is not rerun as an
  expensive diagnostic loop.
- First review wave records: `typescript_api_docs_reviewer`,
  `gpt-5.6-terra`/`high`; and style/maintainability reviewer,
  `gpt-5.6-terra`/`high`. Both surfaces report runtime telemetry unavailable;
  configured profiles are the available evidence.
- Consolidated P1 finding: the first predicate rejected URI/path prefixes that
  the established `TypeUrls` syntax permits, and it accepted invalid
  dot-separated Protobuf names. P2: records had not reflected the completed
  checkpoint and preflight limitation.
- Correction RED: URI/path-prefixed
  `https://types.example/v1/spine.todo.TaskCreated` failed at the in-memory
  factory before the predicate changed.
- Correction GREEN: split at the final slash, accept a nonempty whitespace-free
  prefix that does not end in a slash, and require each suffix segment to be a
  Protobuf identifier. The shared factory conformance now covers URI/path
  acceptance and trailing, doubled, and digit-leading invalid name segments on
  both factory creation paths.
- Correction focused suite: 3 files and 34 tests passed. Generated build,
  tooling typecheck, targeted ESLint, TSDoc, Prettier, and diff hygiene passed.
  The coverage invocation reports 90.31% statements and 93.60% lines across
  the three selected historical adapter files; its 82.77% aggregate branch
  result is below the repository-wide threshold because it includes unrelated
  pre-existing branches. Every changed executable line and every branch of the
  corrected predicate is covered on both outcomes (100%).

Next: run the focused correction gates, record changed coverage, commit and
push the correction, then return it for affected re-review.
