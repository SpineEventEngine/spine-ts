# T-0080I: Migrate the Chat example family

## Status

Planned.

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
