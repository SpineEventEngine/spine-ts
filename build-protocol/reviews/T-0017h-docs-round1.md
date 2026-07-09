# T-0017h Documentation Completeness Review - Round 1

Result: FINDINGS

Reviewer: T-0017h documentation completeness reviewer
Worktree: `.worktrees/T-0017h-delivery-scheduler-retry`
Branch: `task/T-0017h-delivery-scheduler-retry`

## Canonical Skill Applicability Check

- Created this review report as the durable review log before recording findings.
- Session skill inventory exposed task-relevant review/documentation skills including `review`, `code-review-excellence`, `doc-coauthoring`, `requesting-code-review`, and `verification-before-completion`, plus implementation-adjacent TypeScript/backend skills.
- Task-provided skill names/paths: none explicitly named beyond the BUILD_PROTOCOL skill applicability requirement and this documentation-completeness reviewer role.
- Checked `build-protocol/skills/EXPECTED_SKILLS.md`; expected installed skills include `subagent-driven-development`, `using-git-worktrees`, `requesting-code-review`, `verification-before-completion`, `planning-with-files`, `architecture-decision-records`, `typescript-advanced-types`, and `nodejs-backend-patterns`.
- Enumerated readable user-installed skill entrypoints with `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`; this checked the full readable user-installed skill directory.
- Inspected `/Users/armiol/.agents/.skill-lock.json` for installed skill source repositories and local paths.
- Selected and fully read `/Users/armiol/.agents/skills/review/SKILL.md` because the assignment is an explicit review of branch/worktree changes. Its two-axis sub-agent process is advisory here; the human/orchestrator assigned a narrower documentation-completeness lane and required this exact report path, so BUILD_PROTOCOL, the task ledger, and the prompt govern.
- Skipped `doc-coauthoring` because this is a review, not documentation drafting. Skipped `code-review-excellence` because the lane is documentation completeness rather than general code review. Skipped `verification-before-completion` because this review does not claim implementation verification beyond inspecting durable verification records.

## Scope Checked

- Human-Imposed Requirements Ledger in `build-protocol/tasks/T-0017h-delivery-scheduler-retry/TASK.md`.
- Public docs changed in `docs/USER_GUIDE.md`, `docs/api/README.md`, `docs/architecture/README.md`, and `packages/server/README.md`.
- Public server exports in `packages/server/src/index.ts` and API-doc guard expectations in `scripts/check-api-docs.mjs` for consistency with documented public API.
- Durable task/work/review logs, especially `build-protocol/work-logs/T-0017h.md`, `build-protocol/work-logs/T-0017.md`, and `build-protocol/reviews/T-0017h-delivery-scheduler-retry.md`.

## Findings

### [P2] Deferred-scheduler wording contradicts the new public `DeliveryLoop`

Files/lines:
- `docs/USER_GUIDE.md:194-199`
- `docs/api/README.md:289-301`
- `docs/architecture/README.md:443-445`

Rationale:
The task adds and documents a public `DeliveryLoop` around `Delivery.drain()`, and the ledger requires docs to honestly describe the supported loop while not claiming broader production parity. The current docs still say "scheduler/catch-up loops remain deferred" or "This slice does not run scheduler loops" near the new `DeliveryLoop` text. That makes the public status ambiguous: readers can reasonably conclude that no delivery scheduler/loop exists, even though `DeliveryLoop` is now exported and described a few lines later.

Concrete fix:
Replace the broad wording with narrower production-language, for example "transport-backed/background scheduler workers and catch-up orchestration remain deferred" and "This slice does not start process-wide scheduler workers, retry monitors, conveyor/stations..." Keep the current `DeliveryLoop` wording as the supported small local loop.

### [P2] Public docs do not consistently document `DeliveryLoop.stop()` behavior

Files/lines:
- `docs/api/README.md:289-292`
- `docs/USER_GUIDE.md:1101-1104`
- `packages/server/README.md:106-109`

Rationale:
`DeliveryLoop` has public `stop()` and `close()` methods. The task acceptance criteria and mandatory review checks call out clean shutdown/stop behavior. The API README documents `close()` but not `stop()`, while the user guide and package README mention a stopped status without explaining that `stop()` prevents future drain starts and allows an in-flight drain to finish. This leaves changed public API behavior underdocumented.

Concrete fix:
Add one consistent sentence to the delivery docs: "`stop()` prevents future drain starts and reports `STOPPED`; it does not interrupt an in-flight `Delivery.drain()`. `close()` calls `stop()` and waits for the current drain, if any, to finish." Include it at least in `docs/api/README.md` and `packages/server/README.md`; mirror the same behavior in the user guide if it remains a public feature overview.

### [P2] Review log verification snapshot is stale and no longer interruption-safe

File/line:
- `build-protocol/reviews/T-0017h-delivery-scheduler-retry.md:64-66`

Rationale:
The review log says full `format:check` remains blocked by `packages/server/test/context/process-manager-handoff.test.ts`, but the work log later records that the file was formatted and `pnpm --config.verify-deps-before-run=false format:check` passed at `build-protocol/work-logs/T-0017h.md:170-174`. A future reviewer resuming from the review log would see a stale blocker and could repeat unnecessary investigation. The mandatory review check also asks work/review logs to be durable enough for interruption recovery and mention verification concerns.

Concrete fix:
Update the review log verification snapshot to the current state: note the earlier blocker, the targeted formatting follow-up, and the successful rerun. Also add a short JVM-inspection pointer in the review log snapshot, or link to the work-log JVM evidence, so a reviewer can recover the design basis without reconstructing it from scratch.
