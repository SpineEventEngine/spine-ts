# T-0012: Corrective Cleanup And Roadmap Reset

Status: Started
Start: `2026-07-01 16:48 WEST`
Baseline commit: `a9769d4`
Branch: `task/T-0012-cleanup-replan`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-cleanup-replan`

## Objective

Abandon the over-engineered command-execution-first branch line and reset the
framework implementation from trunk toward a simpler Spine JVM-aligned design.

## Human Answers Recorded

- Corrective cleanup must happen before further feature work.
- The previous T-0012 roadmap is replaced by the human-provided order recorded
  in `D-0047` and `TECHNICAL_SPEC.md`.
- Cleanup may be very aggressive; no external users depend on the current code.
- Whole modules/tests may be deleted or replaced when they encode wrong
  abstractions.
- Source files must be grouped by each package's own semantics. Package-root
  `src/` folders should contain only a few top-level files.
- Tests must live under `packages/<package>/test/` and mirror the
  corresponding `src/` folder structure.
- Generated Protobuf-ES output must live under `packages/<package>/generated/`,
  be ignored by Git, and be removed/regenerated on each build.
- Production code may import generated files directly.
- Generated message prototype/interface extensions are acceptable when behavior
  belongs to one generated message instance; such extensions live in regular
  `src` code where the equivalent helper would live.
- Prefer JVM names and short concepts over very precise long TypeScript names.
- Public standalone functions are disallowed unless a strong reason is recorded.
- Use simple errors/exceptions for programmer/configuration problems and small
  result objects only for runtime signal outcomes.
- `BoundedContext` must be shaped by the Spine JVM implementation rather than
  invented snapshot/conflict-detail concepts.
- The to-do example may use in-memory storage but must run with real gRPC,
  query, and subscription support.

## Negative Examples

- `bounded-context.ts` is a representative over-engineering example.
- Names such as `BoundedContextRepositorySnapshotErrorDetails` and
  `BoundedContextRepositoryRegistrationConflictErrorDetails` are forbidden
  unless JVM source and task scope justify them.

## Required First Outcome

Before more framework capability is added, create an autonomous cleanup plan
and enforce the new quality gates for:

- generated-code location and Git ignore policy;
- package/test layout;
- naming and line-length rules;
- no committed generated output;
- no co-located tests under `src`;
- short JVM-aligned APIs;
- corrected implementation order.

No blocking human question is known.
