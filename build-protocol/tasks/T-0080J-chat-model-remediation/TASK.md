# T-0080J: Remediate Chat model modules

## Status

Planned.

## Parent And Dependencies

- Parent: T-0080.
- Depends on: T-0080D, T-0080H, and T-0080I.
- Required by: T-0080K and T-0080O.

## Objective

Make the Chat and Users model modules fully compliant in authored Proto and
TypeScript, regenerate them from authored sources, and preserve their separate
package/type-registry boundary.

## Classification

High-risk. Authored Proto names/comments and package public model contracts can
change serialized/API contracts.

## Human-Imposed Requirements Ledger

- Every authored example Proto declaration and field has a concise useful
  comment.
- Authored Proto and TypeScript names have at most four semantic components.
- Exported authored TypeScript declarations/members have complete concise
  TSDoc.
- Standalone functions require cohesive ownership or exact necessity
  dispositions.
- Original copied Spine JVM Proto definitions/names remain unchanged.
- Users model remains a separately packaged Chat-family dependency.
- Generated output is regenerated and never hand-edited.
- No Spine JVM build.

## Ownership

- `examples/chat/model` and `examples/chat/users-model` authored Proto,
  authored TypeScript, manifests/config, tests, docs, and quality partitions.
- Exact generated-symbol consumer repairs in Chat app/web when an authored
  model name changes; no unrelated app/web cleanup.

## Acceptance Criteria

1. Owned authored Proto has zero comment/name debt; copied Spine sources are
   byte-unchanged.
2. Owned authored TypeScript has zero TSDoc/name debt and exact dispositions for
   remaining standalone functions.
3. Proto renames preserve field numbers, wire types, service/RPC semantics, and
   package/type-URL intent; all generated consumers and registry tests use the
   new names.
4. Model dependency direction remains acyclic: Chat model may consume Users
   model as recorded, while package/registry identities stay independently
   composable.
5. Clean generation produces compilable ignored output and both model package
   payload/manifests remain publishable.
6. Focused model, Proto-module, manifest, type-URL, and generated-package tests
   pass.

## Exclusions

- No Chat server/browser behavior or broad source cleanup.
- No copied Spine Proto edit.
- No hand-edited generated output.
- No central all-example generation closure.

## Verification And Review

- Focused Proto checks/generation, model package tests, generated typecheck,
  package payload/import checks, TypeDoc/lint/format, checker partitions,
  generated cleanliness, and `git diff --check`.
- Documentation and TypeScript/API-doc lanes are relevant.
- Style/maintainability is relevant for model TypeScript ownership.
- Performance/reliability is N/A absent runtime behavior/resource changes.
