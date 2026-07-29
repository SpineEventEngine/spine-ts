# T-0080I: Migrate the Chat example family

## Status

Complete.

## Parent And Dependency

- Parent: T-0080.
- Depends on: T-0080A-C.
- Required by: T-0080D and T-0080J/K.

## Objective

Move the Chat application, web client, Chat model, and Users model beneath one
`examples/chat/` family; cut over to publishable example package coordinates;
and provide one foundational family README without mixing in semantic
TSDoc/function remediation.

## Classification

High-risk. This changes package coordinates, workspace/build discovery,
generated-code inputs, Proto import topology, and public example entry points.

## Human-Imposed Requirements Ledger

- Multi-module examples use a common parent and foundational `README.md`.
- Chat becomes `examples/chat/{app,model,users-model,web}`.
- Package names are `@spine-event-engine/example-chat-app`,
  `@spine-event-engine/example-chat-model`,
  `@spine-event-engine/example-chat-users-model`, and
  `@spine-event-engine/example-chat-web`.
- The Users model remains independently packaged inside the Chat family.
- Example packages are visibly distinct from production packages.
- Single-module examples remain flat.
- Generated output is regenerated and never hand-edited.
- No Spine JVM build or launch.

## Ownership

- Physical relocation of the four existing Chat-related trees.
- `pnpm-workspace.yaml`, root `tsconfig` references, ESLint TypeScript globs,
  TypeDoc excludes/entries, root package scripts, Proto workflow/path consumers,
  hard-coded migration tests/docs, package manifests, and lockfile changes
  required solely by the move.
- `examples/chat/README.md` as the family entry point.
- Exact checker-debt path migration with no new/broadened entry.

## Acceptance Criteria

1. No old top-level `examples/chat-model`, `examples/chat-web`, or
   `examples/users-model` package remains; the former app occupies
   `examples/chat/app`.
2. Workspace discovery includes both flat single-module examples and one-level
   nested multi-module example packages without matching arbitrary deeper
   directories.
3. Root TypeScript, ESLint, TypeDoc, generation, formatting, release-readiness,
   cleanup, and package-metadata paths discover the new modules and contain no
   stale old Chat paths.
4. All four package names use the approved `example-chat-*` convention and all
   workspace dependencies, Proto manifests/config, generated import mappings,
   filters, tests, and docs use those exact coordinates.
5. Cross-model Proto imports and explicit registry composition resolve from the
   nested layout after clean generation.
6. The lockfile contains the new workspace package identities and no old Chat
   package coordinate.
7. The foundational README introduces the whole family, module boundaries,
   dependency direction, generation, server, browser client, authentication
   topology, commands, queries, subscriptions, tests, and best-effort delivery
   limitations with accurate commands.
8. App/model/users-model/web focused build and existing tests pass from the new
   paths before semantic remediation begins.
9. The move preserves file history where Git can detect it and never edits
   generated output by hand.

## Exclusions

- No authored Proto rename/comment sweep; T-0080J owns model remediation.
- No app/web TSDoc, function-ownership, or semantic-name cleanup; T-0080K owns
  it.
- No runtime, auth, delivery, or browser behavior change.
- No package publication.

## Verification And Review

- Workspace/package discovery, clean Chat generation, generated build
  typecheck, package/import/path tests, all Chat tests, docs commands/links,
  generated cleanliness, lint/format, and `git diff --check`.
- Documentation and TypeScript/API-doc lanes are relevant.
- Style/maintainability is relevant to module/package structure.
- Performance/reliability is relevant only to claims or changes affecting
  runtime topology/lifecycle; otherwise record N/A with the no-behavior-change
  evidence.

## Implementation Assignment

- Existing role: implementer.
- Ownership: the four Chat-family relocations, package-coordinate and path
  cutover, exact debt-path migration, foundational family README, and focused
  migration evidence only.
- Expected/configured model: `gpt-5.6-terra`.
- Expected/configured reasoning: medium.
- Both fields are explicit in dispatch.
- The implementation owner must preserve history with Git-aware moves where
  practical, establish red path/package regressions before the cutover, and
  never edit generated output by hand.
- Runtime metadata is recorded when exposed; otherwise the immutable configured
  role/profile and self-introspection limitation are accepted absent visible
  mismatch or fallback.

## Implementation Evidence

- RED: `scripts/chat-family-migration.test.mjs` failed before the relocation
  because `pnpm-workspace.yaml` did not discover `examples/*/*`.
- GREEN: the same focused test passed after the Git-aware move and package,
  workspace, and TypeScript-reference cutover.
- The immutable dispatched implementation profile is `gpt-5.6-terra` /
  medium. This surface exposes no independent runtime model metadata; no
  mismatch or fallback was visible.
- `pnpm install --lockfile-only --offline --link-workspace-packages=true`
  refreshed the lockfile without downloads. A subsequent dependency-link
  restoration attempted registry resolution for uncached artifacts and is a
  current focused-validation limitation; generation and broader test commands
  require a restored local dependency installation.
- The direct authored Proto quality check passes after exact debt entries map
  only the four relocated Chat paths back to their immutable pre-move baseline
  paths. `git diff --check` and Node syntax checks for the changed workflow and
  checker scripts also pass.
- RED: the migration regression failed because root Vitest and ESLint TypeScript
  discovery were flat-only. GREEN: it passes after bounded
  `examples/*/*/{src,test}` discovery and coverage patterns were added. The
  root Chat app/web test command now discovers all intended files. Its current
  execution failure is environmental only: the recovered installation lacks
  `jose`, `@connectrpc/connect-web`, and `jsdom`; a corrected relocated interop
  path no longer appears in the rerun diagnostics.
- RED: the browser-harness import regression exposed the still-one-level-short
  Envoy renderer path. GREEN: the regression passes with the exact relocated
  path, and `node --test` passes both lightweight browser-run and harness
  lifecycle files (5/5). The topology test is discovered but cannot load the
  missing local `@connectrpc/connect-web` dependency.
- RED: Playwright exposed a one-level-short browser TypeScript `extends` path;
  the configuration audit found the interop-browser path was similarly short.
  GREEN: the migration regression and `tsc --showConfig` both browser configs
  pass with the exact five- and six-parent paths. `tsc --noEmit` reaches only
  the missing local `@playwright/test` type dependency, and `test:browser`
  reaches Playwright startup but cannot find the package-local executable.
- RED: the documentation checker rejected the family README without its
  authoritative browser/authentication guide. GREEN: the exact relative guide
  link is present; the docs checker, migration regression, repository format
  check, and `git diff --check` pass.
- RED: repository ESLint parsed nested generated output because only flat
  example generated paths were ignored. GREEN: the exact one-level nested
  generated exclusion is regression-covered. Scoped lint of moved configured
  Chat `.ts` and `.mjs` files, direct cleanup/TSDoc enforcement, and
  `git diff --check` pass. The root ESLint configuration's lack of a `.tsx`
  TypeScript files pattern is existing tooling scope, not a migration change.

## Acceptance

- The Chat family now resides under
  `examples/chat/{app,model,users-model,web}` with the approved package
  coordinates and one foundational family README.
- Workspace, TypeScript, Vitest, ESLint, Proto workflow, publication recovery,
  generated freshness, package manifests, lockfile, docs, exact debt paths, and
  current tests use the nested layout.
- All three relevant review lanes are CLEAN after one consolidated correction
  batch. Performance/reliability is N/A because runtime behavior did not
  change, supported by the focused runtime/topology/browser evidence.
- Final change-sensitive verification passes 63/63 focused workflow,
  generated-clean, and migration tests; four Chat TypeScript projects; 57/57
  Chat integration tests with local-loopback permission; scoped lint;
  formatting; authored Proto quality; cleanup/TSDoc enforcement; documentation
  snippets; and `git diff --check`.
- Three additional Proto-tools packed-fixture tests remain unavailable only
  because the recovered dependency installation lacks Buf runtime modules.
  Direct regeneration is similarly unavailable because `protoc-gen-es` is
  absent. Earlier clean-generation evidence and the focused corrected-path
  fixtures cover the T-0080I behavior.
- No Spine JVM build or launch ran. Generated output was not hand-edited.
- Review Wave 1 correction RED: move-corrected registry fixtures failed against
  the old flat staging and publication-journal paths. GREEN: staging, freshness
  fixtures, and the allowlist use `examples/chat/app`; 63 focused
  workflow/generated-clean/migration tests and the docs checker pass. Generation
  and generated-clean regeneration remain blocked by missing local
  `protoc-gen-es`; formatting and `git diff --check` pass with no generated
  output changed. The immutable `gpt-5.6-terra` / medium assignment remains the
  only visible runtime metadata; this surface exposes no independent
  self-introspection and no mismatch/fallback appeared.
