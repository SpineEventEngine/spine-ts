# T-0038a: Canonical Fallback Type URLs

Status: Independent review assigned

Started: `2026-07-14T01:50:36Z`

Baseline commit: `75340852`

Branch: `task/T-0038a-canonical-fallback-type-urls`

Worktree: `.worktrees/T-0038a-canonical-fallback-type-urls`

Parent: T-0038 accepted-capability audit at planning checkpoint `9addd3b0`.

This `Status` header is canonical for T-0038a. Work/review mirrors must agree.

## Objective

Reject malformed caller-supplied fallback type-URL prefixes before public
prefix selection or derivation can return a noncanonical URL, while preserving
every accepted Spine-option, default, and valid custom fallback result.

## Human-Imposed Requirements Ledger

- Continue autonomously until the child is integrated or a real blocker occurs.
- Implement this child in its own branch/worktree with one Terra Medium author,
  TDD, focused inner checks, relevant independent reviews, final task verify,
  main merge/post-merge verify, push, and clean worktree removal.
- `getTypeUrlPrefix(schema, fallbackPrefix)` and
  `deriveTypeUrl(schema, { fallbackPrefix })` are the only custom-fallback input
  paths. Do not claim or add a fallback option to packing or registry APIs.
- When a schema has no Spine `type_url_prefix`, normalize permitted trailing
  `/` separators, then reject a fallback whose remaining prefix is empty or
  contains whitespace. At minimum `""`, whitespace-only, `/`, and `///` reject
  with one deterministic `TypeError`.
- Preserve valid bare and trailing-slash custom prefixes, the default
  `type.googleapis.com`, and Spine file-option precedence. An unused malformed
  fallback must not invalidate a valid file option.
- Keep validation in one existing owner. Add no helper export, public error
  class, new option, generated facade, Protobuf change, or unrelated refactor.
- Update concise public TSDoc and `packages/core/README.md` only for the accepted
  validation/compatibility contract. Broader guide reconciliation stays T-0039.
- Preserve generated-output policy and public export count; generated files
  remain ignored and untracked.
- Run only relevant reviewer lanes and record concrete N/A dispositions. No
  per-task security lane; carry validation relevance to T-0041.
- Reviewer prompts must ignore superseded historical text unless current child
  records or changed active docs claim it.
- Explicitly dispatch model/reasoning and accept only matching immutable role
  metadata. Subagents must not spawn subagents.
- Never read, modify, stage, or delete the user-owned root
  `human-review-1-jul.md` file.

## Exact Contract

- Validate fallback only when the schema file supplies no Spine prefix option.
- Remove trailing `/` separators for validation/canonicalization; the remaining
  prefix must be non-empty and contain no whitespace.
- Valid `type.example.test`, `type.example.test/`, and repeated trailing slash
  forms produce exactly `type.example.test/<schema.typeName>`.
- A schema's valid Spine option wins even when the unused fallback argument is
  malformed.
- Omitted fallback continues to use `DEFAULT_TYPE_URL_PREFIX`.
- `getTypeUrlPrefix()` and `deriveTypeUrl()` share one policy owner and
  deterministic `TypeError`; no new error hierarchy.
- `packAny()` / `packCommand()` / `packEvent()` and implicit
  `TypeRegistry.register()` expose no custom fallback. Their unchanged
  canonical behavior is regression evidence only.

## TDD Acceptance

- RED table proves malformed fallback forms currently return or derive invalid
  text, then GREEN proves exact `TypeError` class/message.
- Valid custom bare/trailing-slash forms, default fallback, and Spine-option
  precedence remain exact.
- Packing, implicit registry default derivation, and explicit valid registry
  URLs remain unchanged.
- Public TSDoc and core README state normalization/rejection without broadening
  the API or claiming behavior beyond current code.
- Core focused tests, generated build typecheck, scoped ESLint, docs/API checks,
  Prettier, generated-clean, and diff checks pass before review.

## Scope

- Likely source/test: `packages/core/src/index.ts`,
  `packages/core/test/index.test.ts`.
- Likely docs: `packages/core/README.md` and public TSDoc in the source file.
- This task/work/review record set.
- Exclude server, transport, storage, example, Protobuf source, generated output,
  public exports, package manifests, and unrelated docs.

## Planning And Model Disposition

- Selective Sol High planning was completed and accepted in parent checkpoint
  `9addd3b0`; do not re-plan the child.
- Existing implementer role: explicit expected `gpt-5.6-terra` / medium, no
  subagents. Terra High is reserved for correctness/API/reliability review.
- Author owns source, focused tests, narrow docs, and these child records only;
  no commits, pushes, merges, or worktree operations.

## Skill Applicability Check

- Session inventory, repo expected-skill manifest, readable user entrypoints,
  and installed lock are available. Orchestrator selected/read
  `subagent-driven-development`, `using-git-worktrees`,
  `requesting-code-review`, and `verification-before-completion` earlier in the
  session.
- Implementer must perform its own canonical check and read
  `test-driven-development` plus required references, `implement`,
  `typescript-advanced-types` if needed, and `verification-before-completion`
  before governed actions. Server/JVM inspection is N/A because no server code
  changes.

## Implementer Skill Applicability Record

- `2026-07-14`: Existing implementer, expected profile `gpt-5.6-terra` /
  medium, no subagents. This bounded runtime bugfix requires
  `test-driven-development`, `implement`, and `verification-before-completion`;
  all were read before the RED test. `typescript-advanced-types` is N/A: the
  change has no advanced type-level logic. Server/JVM inspection is N/A because
  no server code changes.
- Acceptance focus: for a no-option schema, public fallback input `""`,
  whitespace-only, `"/"`, and `"///"` must deterministically throw the same
  `TypeError`; a file option must bypass malformed unused fallback input; valid
  canonical and regression paths must remain exact.

## Implementer TDD Record

- RED: after normal `proto:generate` and generated build prerequisites,
  `corepack pnpm exec vitest run packages/core/test/index.test.ts --passWithNoTests`
  collected 30 tests and failed the four required table cases. Each failure was
  `AssertionError: expected function to throw an error, but it didn't` at the
  public `getTypeUrlPrefix(AnySchema, fallbackPrefix)` assertion; 26 tests
  passed. An initial pre-build attempt could not resolve ignored
  `@spine-ts/proto` entrypoints and is excluded from behavioral evidence.
- GREEN: the same focused command reported `1 passed`, `34 passed (34)` after
  one existing prefix-selection owner strips trailing `/` separators, rejects
  empty or whitespace-containing remaining fallback values with
  `TypeError: Fallback type URL prefix must be non-empty and contain no whitespace.`,
  and leaves a present Spine file option ahead of fallback validation.
- Docs are deliberately narrow: public option/function TSDoc and core README
  state trailing-separator normalization and empty/whitespace rejection only.
  No packing or registry custom-fallback option was added.

## Implementer Handoff

- Status: `DONE_WITH_CONCERNS`. Changed paths are exactly the three assigned
  records plus `packages/core/src/index.ts`, `packages/core/test/index.test.ts`,
  and `packages/core/README.md`; no user-owned root file was read or changed.
- Fresh focused evidence: `corepack pnpm typecheck:build:generated` exited 0;
  `corepack pnpm exec vitest run packages/core/test/index.test.ts --passWithNoTests`
  exited 0 with `1 passed`, `34 passed (34)`; scoped ESLint exited 0;
  `corepack pnpm docs:check:generated` exited 0 and retained 28 expected core
  exports; exact-six-file Prettier exited 0; and
  `corepack pnpm proto:check-generated` exited 0 with ignored, untracked,
  freshly regenerated outputs.
- `git diff --check` exited 0; `git status --short` and `git diff --name-only`
  list only the six assigned paths; the public-export diff contains no added or
  removed `export` declaration. No full `pnpm verify`, commit, push, merge, or
  reviewer dispatch was performed, per assignment.
- Actual runtime profile metadata is not surfaced to this implementer context.
  The dispatched expectation is `gpt-5.6-terra` / medium; no subagents were
  spawned. The orchestrator must perform immutable-metadata acceptance and the
  pending recorded reviewer dispositions. No code-behavior uncertainty remains
  within the focused evidence; those process gates are the remaining concern.

## Immediate Next Action

Dispatch the Terra Medium implementer for strict RED/GREEN and narrow docs,
then run focused coordinator verification and all relevant reviewers.

## Coordinator Pre-review Finding

- `2026-07-14T01:59:03Z`: accept/close actual Terra Medium implementer from
  explicit dispatch plus immutable role metadata, no subagents. Coordinator
  rerun passes 34/34 core tests, generated build, scoped ESLint, docs/API with
  28 core exports, generated-clean, Prettier, and diff integrity.
- Before review, synchronize all three status headers; add the promised explicit
  `deriveTypeUrl()` throw contract for a selected malformed custom fallback;
  and repair awkward multi-line inline-code spans in durable RED/GREEN evidence
  without changing behavior or evidence.

## Independent Review Assignment

- `2026-07-14T02:02:08Z`: accept/close actual `gpt-5.6-terra` / medium
  implementer from explicit dispatch plus immutable role metadata, no
  subagents. Fresh coordinator gate passes 34/34 tests, generated build,
  TypeDoc/API with 28 core exports, formatting, status, and diff checks.
- Assign documentation at explicit `gpt-5.6-luna` / medium and style,
  TypeScript/API docs, and performance/reliability at explicit
  `gpt-5.6-terra` / high. All are read-only, no subagents. Security remains
  deferred to T-0041; full verify remains reserved for clean final acceptance.
