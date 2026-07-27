# T-0073: Proto Model Modules and External Generation Tooling

Status: Complete

Implementation status: implemented, fully reviewed, merged into `main`,
post-merge verified, and remotely synchronized. The task endpoint is
`5240b44f`, the merge is `7eb1a616`, and the post-merge correction is the commit
containing this completion record.

## Objective

Give independently published Spine TS and application-owned model packages a
canonical Protobuf source, generated TypeScript, dependency, and runtime type
registration contract. Prove the contract with fresh external-repository
fixtures and migrate every maintained example to it.

## Classification

High-risk. This task creates shared build tooling, package and generated-source
contracts, transitive model dependency semantics, dynamic `Any` decoding, and
new end-user workflows across the monorepo and independently packed npm
artifacts.

## Human-Imposed Requirements Ledger

- Wave 3 is exclusively the approved Proto model-module layout and tooling.
- A small application may use one combined model package; larger applications
  may use one model package per Bounded Context.
- A model package must work when copied to a fresh GitHub repository with no
  Spine TS workspace present and all framework dependencies obtained as npm
  packages.
- Application-owned model packages may import Proto types from other
  application-owned model packages, such as `tasks-model` importing `UserId`
  from `users-model`.
- Any application code may use Spine-native or application-owned generated
  messages and pack/unpack `Any` values for all registered types.
- Each model package is independently usable and publishes its own canonical
  Proto sources, generated ESM/declarations, manifest, and registry
  contribution.
- Applications have one explicit composition point for their top-level model
  modules; transitive model dependencies are traversed and deduplicated.
- Do not use runtime `node_modules` scanning or mutable global registration.
- Packing remains schema-directed. Known-type unpacking remains
  schema-directed; dynamic unpacking uses an explicit composed registry.
- Generation must reject duplicate Proto paths/type names/type URLs,
  undeclared dependencies, incompatible versions, dependency cycles, and
  escaping imports.
- Acceptance must exercise packed npm tarballs in fresh repositories without
  workspace/file-relative dependencies and must prove cross-package Proto
  imports and dynamic `Any` unpacking.
- Use the resulting workflow in all maintained example applications.
- Use only the `@spine-event-engine/*` npm scope.
- Do not publish to npm in this wave; local tarballs simulate the registry
  payload.
- Wave 4 is browser access/interoperability, Wave 5 is storage-neutral
  packaging/deployment, and Wave 6 is cluster-complete horizontal
  subscriptions. Do not implement them in Wave 3.
- Preserve unrelated files and never read or modify
  `human-review-1-jul.md`.
- Push `origin` immediately after every commit.

## Planning Gate

- Existing role: `requirements_splitter`.
- Scope: produce a smallest dependency-ordered Wave 3 task split, public
  package/tool contracts, TDD acceptance fixtures, ownership boundaries,
  reviewer relevance, and blockers without reopening approved product
  decisions.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: `high`.
- Model and reasoning must be explicit in dispatch. The role is read-only and
  may not edit, commit, push, merge, or spawn children.

## Implementation Gate

- Existing role: `implementer`.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- One bounded writer owns overlapping production and test files in each
  dependency-ordered slice. Model and reasoning must be explicit in dispatch;
  the owner may not commit, push, merge, or spawn children.

## Required Review Concerns

- Style/maintainability: generation/linker cohesion, package boundaries, and
  avoidance of speculative abstractions.
- Documentation: external-repository workflow, package authoring,
  configuration, cross-model imports, application composition, and examples.
- TypeScript/API: public manifests/modules/registries, package exports,
  declarations, generated imports, and `Any` behavior.
- Performance/reliability: deterministic resolution, bounded traversal,
  conflict/cycle failures, reproducibility, and registry memory behavior.
- Security is a final Wave 3 gate because generation consumes dependency
  manifests and files, and dynamic `Any` unpacking crosses a serialized-data
  boundary.

## Acceptance Criteria

- `@spine-event-engine/proto` ships Spine source/generated artifacts, a
  versioned manifest, and `spineProtoModule`.
- `@spine-event-engine/proto-tools` exposes a reproducible, safe `spine-proto`
  workflow for independently published model packages.
- `TypeRegistry.from()` composes transitive `ProtoModule` dependencies and
  `unpackAnyUsing()` dynamically decodes only exact registered type URLs.
- Cross-package Proto imports generate npm package imports without generating
  or shipping dependency-owned duplicates.
- Every maintained example uses the workflow; Chat proves two application
  model packages and a cross-model `UserId` import.
- Fresh packed-tarball repositories build and run with no monorepo-local
  dependency or path.
- Configuration/conflict/cycle/path/symlink/unknown/malformed failure behavior
  is deterministic and covered.
- Public guide/package/API/example documentation contains compile-checked code
  snippets for the complete workflow.
- Focused and full native verification, at least 90% branch coverage, all four
  specialist concerns, and final Wave 3 security review are clean.
