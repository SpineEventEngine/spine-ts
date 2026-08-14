# T-0185: Beginner Interface-Routing Documentation

Status: Release verification complete; integration ready
Start: `2026-08-14 WEST`
End: Pending
Task-start baseline: `696bbac3`
Branch: `task/T-0185-beginner-docs`
Worktree: `.worktrees/T-0185-beginner-docs`
Classification: Standard documentation milestone after public contracts stopped moving

Implementation owner: existing `implementer`, explicit `gpt-5.6-terra` / medium.
Desktop runtime telemetry does not expose independent child model metadata; the
immutable configured role/profile is the available evidence.

## Objective

Teach the accepted D-0113 and Wave 11 TypeScript interface-routing contract to
beginners using the real To-Do model, while keeping dense API and compiler
details in package references.

## Required Inputs

- `AGENTS.md` and `build-protocol/BUILD_PROTOCOL.md`;
- `build-protocol/DECISION_LOG.md` D-0113;
- `build-protocol/planning/WAVE_11_TS_TYPE_ROUTING_PLAN.md`;
- integrated T-0180 through T-0184 contracts and tag `T-0184`.

## Human-Imposed Requirements Ledger

1. Explain the Proto declaration and the difference between generated and
   authored TypeScript interfaces.
2. Explain that the same exported name is a TypeScript interface in type
   position and a runtime routing token in value position.
3. Explain the same-model-module interface and parent boundary, while external
   property types remain allowed.
4. Show `.route(Schema, ...)` and `.route(Token, ...)` with exact schema, first
   registered matching token, then replacement/default precedence.
5. Explain route-once admission and durable stored-target replay without
   rerouting. Distinguish read-side catch-up, which intentionally rebuilds.
6. State that TypeScript uses `ts_type`, ignores Java-only option fields, and
   creates no transport semantic tags.
7. Explain generated-file provenance and the no-copyright policy.
8. Use generated `TaskEvent`, authored `TaskAssignmentEvent`, and exact
   `TaskReassigned`; never mention or create `TaskReassignmentEvent`.
9. Provide the runnable create, assign, reassign, and unassign journey with zero,
   one, and two targets and the stored-target replay observation.
10. Explain the assignment rejection table and the To-Do snapshot reset / no
    automatic migration boundary from T-0184.
11. Preserve the existing README look and feel; move dense detail to references.
12. Do not introduce `routeSemantic()`, `@Route`, multiple-Gateway behavior, or
    Cloud Run support.

## Owned Reader Documents

- `README.md`;
- `docs/USER_GUIDE.md`, `docs/api/README.md`, `docs/architecture/README.md`;
- `packages/core/README.md`, `packages/core/REFERENCE.md`;
- `packages/proto/README.md`, `packages/proto/REFERENCE.md`;
- `packages/proto-tools/README.md`, `packages/proto-tools/REFERENCE.md`;
- `packages/server/README.md`, `packages/server/REFERENCE.md`;
- `examples/todo/README.md`, `examples/todo/USER_GUIDE.md`,
  `examples/todo/REFERENCE.md`.

Historical build-protocol narrative is not reader-documentation ownership.

## Acceptance

- Every owned document has a truthful `changed` or `reviewed-no-change`
  disposition in the work log.
- The To-Do guide gives a runnable path from Proto declaration through
  `pnpm proto:generate`, expected `generated/interfaces/` artifacts, type/value
  imports, `.route(...)`, lifecycle behavior, rejection outcomes, and replay.
- TypeScript snippets compile against generated declarations without permissive
  stubs.
- Local links, API inventory, reader-audience, generated provenance,
  prohibited-name, and formatting checks pass.
- `verify:task -- --no-tests` passes after cheap preflight.
- Documentation/TSDoc and TypeScript/API documentation review are required.
  Style/maintainability and performance/reliability are N/A because T-0185
  changes prose/snippets only and no runtime lifecycle, persistence, or source
  structure. Security is N/A because no trust boundary changes; T-0186 owns the
  final Wave security review.

## 2026-08-14 Accepted Review Corrections

- The runnable To-Do sequence must directly identify the existing public
  black-box proof for create, assign, reassign, and unassign, including the
  observable zero/one/two target states and the persisted Inbox stored-target
  replay/no-reroute observation. It must distinguish `catchUpReadSide()` as a
  read-side clear-and-rebuild operation.
- Root and architecture reader material must keep Cloud Run and multiple
  Gateways explicitly unsupported/out of scope; this is a boundary statement,
  not a new topology claim.
- Authored `ts_type` interface discovery is after realpath resolution: only the
  requested authored interface is a top-level named export. Recursive `extends`
  parents resolve to interfaces in the same model module but need not be named
  exports or top-level. External property types remain valid.
- Assigned reviewer profiles were `documentation_reviewer` (`gpt-5.6-luna` /
  medium) and `typescript_api_docs_reviewer` (`gpt-5.6-terra` / high). Desktop
  telemetry does not expose independent child runtime metadata; configured
  profiles are the available durable evidence.

## 2026-08-14 Final Verification

- Final reviewed content hash: `e446d592811ef3da315dc0c5472403b2a3256eeb`.
  Task-start baseline: `696bbac3`; prior accepted correction checkpoint:
  `078a24e7`; final targeted API residual: `e446d592`.
- Documentation review confirmation: CLEAN, existing `documentation_reviewer`,
  configured `gpt-5.6-luna` / medium. TypeScript/API review confirmation:
  CLEAN, existing `typescript_api_docs_reviewer`, configured `gpt-5.6-terra` /
  high. Desktop runtime telemetry exposes no independent child runtime metadata;
  configured profiles are the durable evidence.
- Final cheap docs preflight and one converged
  `pnpm verify:task -- --no-tests` completed with no generated residue and a
  clean worktree. Integration may proceed; this task does not authorize merge
  or tag creation.
