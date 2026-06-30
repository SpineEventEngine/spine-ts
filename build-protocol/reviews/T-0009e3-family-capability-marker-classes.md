# Review Log: T-0009e.3 Family Capability Marker Classes

Task log:
`build-protocol/tasks/T-0009e3-family-capability-marker-classes/TASK.md`
Work log: `build-protocol/work-logs/T-0009e3.md`
Branch: `task/T-0009e3-family-capability-marker-classes`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009e3-family-capability-marker-classes`
Baseline commit: `26aa510`

## Review Requirements

Every review round must include separate sub-agents for:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

Reviewers must inspect the committed range for this subtask, report findings
with file/line references when possible, and explicitly state whether their
role is clean. The orchestrator must close every reviewer after result capture.

## Rounds

### Round 1

Round 1 review completed across the required lanes after implementation commit
`3e0571e`.

Findings returned to the review-fix worker:

- Code style/maintainability: `readonly entityFamily = ...` class fields in
  `packages/server/src/entity.ts` compile to writable own properties at runtime,
  so the marker was not durable under JavaScript mutation.
- Security: the same runtime-mutability issue allowed caller code to spoof an
  entity family marker on an instance.
- Performance/reliability: the same runtime-mutability issue made the reported
  family unreliable after reassignment.
- Documentation: durable logs still described T-0009e.3 implementation or
  review as pending.

Round 1 fixes have been applied and verified by the review-fix worker. A
follow-up review round is still required; this log does not claim a clean final
review.

### Round 2

Round 2 review found two remaining issues:

- Documentation: durable T-0009e.3 and parent T-0009e task headers still
  understated the current state as started rather than implemented with fix
  passes pending follow-up review.
- Security: getter-only inherited `entityFamily` remained forgeable through
  `Object.defineProperty(instance, "entityFamily", { value: ... })`, and the
  inherited prototype accessor remained configurable.

Round 2 fixes install a non-configurable, non-writable own `entityFamily`
marker from each family base constructor, preserve literal TypeScript marker
types, and add regression coverage for reflective own-property spoofing,
descriptor shape, and prototype descriptor tampering. Durable status headers and
parent logs now state that Round 2 fixes are applied and follow-up review is
still pending.

Required verification passed before the Round 2 fix commit:

- `corepack pnpm vitest run packages/server/src/entity.test.ts
packages/server/src/index.test.ts`: 2 test files / 38 tests passed.
- `CI=true corepack pnpm verify`: typecheck, lint, format check, 15 test files /
  158 tests, coverage, TypeDoc/API checks, proto lint/generate, and
  generated-output clean passed.

### Round 3

Round 3 reviewed the full subtask range through commit `462e9a6`, including the
Round 1 and Round 2 fixes. All five required lanes returned clean and were
closed by the orchestrator.

| Role                       | Reviewer ID                            | Result | Closure |
| -------------------------- | -------------------------------------- | ------ | ------- |
| Code style/maintainability | `019f162f-6b28-7c70-851c-46fe7df1bf35` | Clean  | Closed  |
| Documentation              | `019f162f-97e9-72c3-841a-015771638a00` | Clean  | Closed  |
| TypeScript/API docs        | `019f162f-b985-7ca2-ba43-f208d2ce2975` | Clean  | Closed  |
| Security                   | `019f162f-e309-7232-a6df-78bf8ffff6d0` | Clean  | Closed  |
| Performance/reliability    | `019f1630-1526-73a3-a8d1-d2ceac94ae6f` | Clean  | Closed  |

Final subtask verification passed on `2026-06-30 02:40 WEST` with 15 test files
/ 158 tests, coverage 97.25% statements / 91.41% branches / 99.16% functions /
97.19% lines, TypeDoc/API checks with 72 expected server exports, proto
lint/generate, and generated-output clean.
