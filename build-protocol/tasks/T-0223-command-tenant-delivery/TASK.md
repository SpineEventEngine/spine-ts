# T-0223: Command Tenant Delivery

Status: Ready for human review
Baseline: `origin/master@5d61f65178c71921fc8934f0622dabd4bfbe5409`
Branch: `fix-command-tenant-delivery`
Worktree: `.worktrees/official-repository-workflow`

## Objective

Correct tenant-aware environment delivery so that a `HANDLE_COMMAND` inbox
message is decoded as a Command, rather than first being decoded as an Event.
Preserve the existing Event routes and pending-row behavior for tenant
mismatches.

## Acceptance criteria

1. A realistic multi-tenant Command containing its required envelope and actor
   metadata is admitted only to the runtime for its actor tenant.
2. A realistic Command for another tenant remains pending and is not replayed
   by the configured runtime.
3. `HANDLE_COMMAND` selects Command decoding directly; Event delivery labels
   select Event decoding directly. The implementation does not probe one
   envelope with the other envelope's schema.
4. Existing imported-event and past-message tenant routing remains unchanged.
5. No public, wire, persistence, or registry contract changes.

## Classification and verification

This is a standard, narrow runtime-correctness correction. Use TDD: first make
the existing matching-tenant test realistic and observe the expected failure,
then apply the smallest label-directed decoding change. Run the focused
environment-delivery tests, changed-file lint/format/typechecking and coverage,
then one `pnpm verify:release` after review convergence because delivery is
shared server runtime behavior.

## Agent routing

- Implementation owner: existing `implementer` role, explicitly dispatched as
  `gpt-5.6-terra` with medium reasoning. Owns the focused test fixture and
  `environment-delivery-worker.ts`; no subagents.
- Mechanical verification: orchestrator-dispatched function using
  `gpt-5.6-luna` with low reasoning when delegated; no new verifier role.
- Reliability/correctness review: existing
  `performance_reliability_reviewer`, explicitly dispatched as
  `gpt-5.6-terra` with high reasoning; read-only, no subagents.
- Style/maintainability review: existing `style_maintainability_reviewer`,
  explicitly dispatched as `gpt-5.6-terra` with high reasoning; read-only, no
  subagents.
- Documentation, TypeScript/API documentation, and security concerns are N/A
  unless the implementation expands: the planned correction changes no reader
  documentation, public declarations, credentials, or trust boundary.

The Desktop dispatch surface supports the explicit profiles above. Runtime
self-introspection may be unavailable; the immutable configured role/profile
is the acceptance evidence in that case.

## Human-Imposed Requirements Ledger

- Work from official `master` on a regular feature branch that does not use the
  `codex/` prefix.
- Keep the correction focused on the careless delivery decoding routine; do not
  introduce registry, public API, Protobuf/wire, or persistence changes.
- Use behavior-focused TDD: establish the realistic Command failure before
  changing production code, and retain that regression coverage.
- Preserve Event origin routing for imported and past-message Events, as well
  as the pending-row behavior for a tenant mismatch.
- Preserve concurrent and human-owned changes outside this task's explicitly
  assigned files.
- This feature branch must include a version-only commit for
  `2.0.0-snapshot.7`, which was verified unused for all 18 public packages on
  2026-09-02. The commit updates every workspace manifest's top-level `version`
  field only and uses the exact message `Bump version -> 2.0.0-snapshot.7`;
  dependency pins and the lockfile belong in a separate commit.
- The human's “OK, start” authorizes implementation and local commits. Do not
  push this correction until the human explicitly asks for a push.
