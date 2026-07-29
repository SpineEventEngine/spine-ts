# T-0080M: Remediate the project-management example

## Status

Planned.

## Parent And Dependencies

- Parent: T-0080.
- Depends on: T-0080H.
- May run in parallel with T-0080L/N.

## Objective

Bring the flat project-management example's authored TypeScript and Proto into
full documentation, naming, and behavior-ownership compliance.

## Classification

High-risk if an authored Proto/public example contract changes; otherwise
standard.

## Human-Imposed Requirements Ledger

- The example remains flat and uses
  `@spine-event-engine/example-project-management`.
- Authored Proto declarations/fields and exported TypeScript APIs have concise,
  complete documentation.
- Authored names have at most four semantic components.
- Standalone functions require cohesive ownership or exact necessity
  dispositions.
- Existing load/example behavior and end-user API guardrails remain intact.
- Copied Spine Proto and generated output are not hand-edited.
- No Spine JVM build.

## Ownership

- `examples/project-management` authored Proto/TypeScript, docs, tests, and
  quality partitions only.
- No shared root script/workspace/API-manifest edit.

## Acceptance Criteria

1. Owned authored Proto and TypeScript have zero comment/TSDoc/name debt.
2. Every remaining standalone function has one specific necessity disposition.
3. Proto renames preserve field numbers/wire types and update generated
   consumers through clean generation.
4. Existing command/entity/query/load behavior, Proto module composition, and
   package payload remain equivalent.
5. README commands/package coordinate remain accurate and end-user API scans
   remain clean.
6. Focused example tests pass.

## Exclusions

- No new example/framework feature or package move.
- No shared tooling/generation aggregation change.

## Verification And Review

- Clean package generation/build, full project-management tests/load smoke,
  docs commands/links, end-user API scan, TypeDoc/lint/format, checker
  partitions, generated cleanliness, and `git diff --check`.
- Style/maintainability, documentation, and TypeScript/API docs are relevant.
- Performance/reliability is relevant only if moved behavior affects load,
  query, resource, or lifecycle semantics.
