# T-0017h Security Review Round 1

Reviewer: T-0017h security reviewer
Date: 2026-07-09
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0017h-delivery-scheduler-retry`
Branch: `task/T-0017h-delivery-scheduler-retry`
Review basis: working-tree diff from base commit `35134c3`

## Canonical Skill Applicability Check

- Protocol source checked before runtime diff review:
  `build-protocol/BUILD_PROTOCOL.md`, especially `Skills and Tooling` and
  `Review Loop`.
- Task ledger checked:
  `build-protocol/tasks/T-0017h-delivery-scheduler-retry/TASK.md`, including
  the full Human-Imposed Requirements Ledger.
- Session skill inventory evidence: the session exposed task-relevant skills
  including `security-best-practices`, `code-review-excellence`,
  `verification-before-completion`, `review`, `requesting-code-review`,
  `typescript-advanced-types`, `nodejs-backend-patterns`,
  `javascript-testing-patterns`, `stride-analysis-patterns`, and
  `threat-mitigation-mapping`.
- Task-provided skill cues: the review assignment explicitly requested the
  T-0017h security reviewer role and stated this is not a threat-model request.
- Expected-skill manifest checked:
  `build-protocol/skills/EXPECTED_SKILLS.md`.
- User-installed skill entrypoints enumerated with:
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`.
  This was a bounded full-directory entrypoint check.
- Installed-skill lock checked:
  `/Users/armiol/.agents/.skill-lock.json`, including entries for
  `code-review-excellence`, `review`, `requesting-code-review`,
  `typescript-advanced-types`, `nodejs-backend-patterns`,
  `stride-analysis-patterns`, and `threat-mitigation-mapping`.
- Selected skills read fully before governed review/completion actions:
  `/Users/armiol/.codex/skills/security-best-practices/SKILL.md`,
  `/Users/armiol/.agents/skills/code-review-excellence/SKILL.md`, and
  `/Users/armiol/.agents/skills/verification-before-completion/SKILL.md`.
- Security reference triage: `security-best-practices/references` contains
  JavaScript/TypeScript references for Express, Next.js, Vue, React, jQuery,
  and general frontend security. None matched this library-only delivery-loop
  runtime diff, which adds no Express/Next/frontend surface, so no framework
  reference file was selected.
- Skipped relevant-looking skills: `review` was skipped because that skill runs
  a broader standards/spec review, while this assignment is the single
  protocol-required security lane; `stride-analysis-patterns` and
  `threat-mitigation-mapping` were skipped because the prompt explicitly says
  this is not a threat-model request; `requesting-code-review`,
  `typescript-advanced-types`, `nodejs-backend-patterns`, and
  `javascript-testing-patterns` were not read because this lane is not
  implementing code, API typing, backend architecture, or test-authoring work.
- Governing rule: installed skills are advisory only. `BUILD_PROTOCOL.md`, the
  T-0017h task ledger, project docs, sandbox rules, and the review assignment
  govern conflicts.

## Mandatory Checks

- Human-Imposed Requirements Ledger: checked. The diff keeps
  `human-review-1-jul.md` untouched, preserves generated/proto files, and adds
  only the small delivery loop surface requested for this task.
- InboxStorage dedup: no bypass found. `DeliveryLoop` delegates to
  `Delivery.drain()`, which marks successes through `Inbox.markDelivered()` /
  `InboxStorage.markDelivered()` and therefore keeps exact-message and dedup
  guard behavior.
- Shard locking: no bypass found. Each loop iteration calls
  `Delivery.drain()`, which uses `ShardedWorkRegistry.pickUp()` and releases in
  `finally`; skipped claims do not invoke endpoints.
- Tenant validation and process-manager replay guards: no bypass found. The
  existing `LocalProcessManagerInbox` path still uses `Delivery.drain()` and
  `#replay()` label/target validation. The new loop is not wired into tenant
  validation or process-manager replay.
- End-user access to internals: no new broad handler/internal API found beyond
  the intentionally exported `DeliveryLoop` and its option/result types.
- Endpoint errors: no unsafe delivered marking found. Endpoint and
  `markDelivered()` failures remain in `DeliveryRun.failures`, are aggregated
  into `DeliveryLoopRun.failures`, increment `failed`, and leave rows
  `TO_DELIVER` for retry.
- Network/listener, secret, filesystem, generated-code policy: no new runtime
  network/listener, secret handling, filesystem access, or generated/proto
  modification found in the delivery-loop diff.

## Findings

### S-001 - Low - API docs still deny the newly exported scheduler loop

File: `docs/api/README.md:298`

Rationale: The updated API docs correctly state that `DeliveryLoop` repeats
`Delivery.drain()` until idle, skipped, stopped, or `maxFailures`. The same
paragraph then says, "This slice does not run scheduler loops." After this diff,
that claim is stale and contradicts the new execution boundary. For this
security lane, the risk is boundary confusion: readers could miss that the
exported local loop runs endpoint callbacks and retry attempts, or misinterpret
which scheduler forms are intentionally deferred.

Concrete fix: Change the deferred claim to distinguish the unsupported pieces,
for example: "This slice does not run transport-backed scheduler loops, retry
monitors, conveyor/stations, ..." or remove "scheduler loops" from the deferred
list.

## Clean Security Checks

Aside from S-001's documentation-boundary wording, the runtime diff is clean for
the requested security checks. I found no dedup bypass, shard-lock bypass,
tenant/process-manager guard bypass, unsafe endpoint-error swallowing, new
network/listener/secret/filesystem surface, or generated-code policy
regression.
