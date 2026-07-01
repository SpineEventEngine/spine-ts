# T-0012.1: Cleanup Enforcement Baseline

Status: Started
Start: `2026-07-01 17:01 WEST`
Baseline commit: `a65ac4d`
Branch: `task/T-0012-1-cleanup-enforcement-baseline`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-1-cleanup-enforcement-baseline`
Parent task: `T-0012 Corrective Cleanup And Roadmap Reset`

## Objective

Make the human reset rules executable before more framework behavior is added.

This task must enforce:

- no tracked generated Protobuf-ES output under package `src`;
- generated output belongs under `packages/<package>/generated/` and is ignored
  by Git;
- tests live under `packages/<package>/test/` and mirror the corresponding
  `src` folders;
- line length is capped at 120 characters;
- code names have at most four semantic components;
- callback names start with `on` and callback type names start with `On`;
- package code does not continue to grow flat `src` trees unchecked.

## Scope

Allowed:

- move generated output workflow from `packages/proto/src/generated` to
  `packages/proto/generated`;
- remove generated files from version control if they are currently tracked;
- update imports, tsconfig, package exports, TypeDoc, tests, and scripts needed
  by the generated-code path move;
- move existing package tests from `src` to `test`, preserving relative
  structure;
- add or tighten automated checks/scripts/ESLint/Prettier configuration for the
  reset rules;
- update docs/logs/API docs as needed.

Not allowed:

- add new framework features;
- redesign `BoundedContext`, storage, buses, repositories, delivery, `Stand`, or
  gRPC service behavior;
- delete runtime behavior except where generated-code/test relocation requires
  path/import changes;
- continue the abandoned command-execution-first roadmap.

## Acceptance Criteria

- No tracked file remains under `packages/*/src/generated`.
- No `*.test.ts` file remains under any package `src`.
- Generated folders under `packages/*/generated` are ignored by Git.
- Automated checks fail on co-located tests and committed generated code.
- Automated checks enforce line length, callback naming, and semantic component
  name count.
- Existing tests, typecheck, lint, docs checks, proto workflow, and generated
  cleanliness checks pass.
- Docs and durable logs record the new enforcement.

## Required Skills

- `test-driven-development`: add failing checks/tests for old forbidden layout
  before or alongside fixes.
- `typescript-advanced-types`: advisory only if TypeScript config or typed
  imports change.
- `verification-before-completion`: required before completion claims.

## Review Lanes

Required independent reviewers:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

No blocking human question is known.
