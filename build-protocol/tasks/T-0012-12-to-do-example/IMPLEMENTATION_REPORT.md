# Implementation Report: T-0012.12 To-Do Example

Status: splitting in progress
Branch: `task/T-0012-12-to-do-example`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12-to-do-example`
Baseline commit: `89868e9`

## Summary

This task starts from the existing `examples/todo` placeholder and must produce
a real runnable to-do example over the current framework. The example is the
final corrective-roadmap deliverable after `T-0012.11` completed missing
framework details.

## Initial Evidence

- `build-protocol/TODO_EXAMPLE_SPEC.md` requires a fully fledged app with real
  gRPC, query, and subscription behavior; in-memory storage is acceptable.
- `examples/todo` currently exports only skeleton metadata and explicitly says
  it is not runnable.
- `T-0012.11` integrated aggregate command execution, projection event updates,
  projection list queries, validation/refusal wiring, and a black-box fixture.

## Splitting Requirement

The next action is a requirements-splitting sub-agent. It must split this task
into small slices, identify any missing framework feature exposed by the
example, and select the first non-blocked implementation slice.

## Current State

- Branch/worktree is created from `main@89868e9`.
- Durable task/report/review/work logs are being created before implementation.
- No code implementation has started.

## Verification

Pending.
