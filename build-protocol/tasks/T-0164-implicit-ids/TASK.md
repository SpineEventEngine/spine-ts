# T-0164: Implicit required IDs

Status: Implementation in progress

## Objective

Apply the Spine declaration-first implicit-required convention to Command and
Entity-state IDs without changing authored Proto files or general message
validation.

## Classification

High-risk. This changes Command admission/replay and every Entity-family commit
validation path.

## Baseline and isolation

- Baseline: `origin/main@c993fdf7`.
- Branch: `task/T-0164-implicit-ids`.
- Worktree: `.worktrees/T-0164-implicit-ids`.
- Preserve the dirty primary checkout and publish only to `origin`.

## Acceptance criteria

1. Treat the first field by Proto declaration order as implicitly required for
   Command messages and descriptor-marked Entity states only when `(required)`
   is absent.
2. Preserve explicit `(required) = true` and let explicit false disable only
   the implicit rule.
3. Support string, bytes, enum, message, repeated, and map presence semantics;
   exclude numeric and boolean primitive fields.
4. Return exactly one sanitized, field-specific validation violation for an
   invalid implicit ID.
5. Apply Command validation before routing/handler dispatch at fresh admission
   and durable replay.
6. Apply Entity-state validation before Aggregate, Process Manager, or
   Projection commit.
7. Do not apply the policy to Events, rejections, or ordinary messages.
8. Cover declaration order, explicit true/false, every supported/excluded
   shape, durable replay, all Entity families, and no-side-effect failures.

## Assignment

- Frozen plan: existing requirements splitter, explicit `gpt-5.6-sol` / high.
- Implementation: primary orchestrator acting as the bounded implementation
  owner under the existing implementer function, `gpt-5.6-terra` / medium; no
  implementation subagents.
- Runtime model metadata is unavailable; configured profiles are the durable
  assignment evidence.

## Review and verification

Style, TypeScript/API, documentation/TSDoc, and performance/reliability concerns
are required. Security is N/A for this validation-only slice; final Wave 9
security review remains mandatory.
