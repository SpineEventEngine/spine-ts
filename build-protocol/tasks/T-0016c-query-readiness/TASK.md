# T-0016c Query Readiness And Stand Metadata

Branch: `task/T-0016c-query-readiness`

Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0016c-query-readiness`

Baseline: `667dcf6`

Start: `2026-07-08T09:48:56Z`

## Objective

Close the first query-readiness gap by making `QueryService.Read` behavior
explicit, small, and JVM-shaped.

## Acceptance Criteria

- `QueryService.Read` supports the documented minimal Spine TS query profile:
  ID-filter point reads and projection-state `Target.include_all = true` reads.
- Unsupported query features are rejected explicitly before storage reads:
  column filters, unsupported response-format features, missing criteria, and
  inactive query shapes not implemented by this slice.
- Read-side state version metadata is persisted or a deliberate scoped
  exception is recorded. If the current in-memory Stand version map remains,
  docs must say exactly that it is process-local and in-memory only.
- Query behavior remains tenant-aware and keeps single-tenant/multitenant error
  semantics covered by tests.
- Public package docs, user guide, architecture/API docs, and TypeDoc comments
  are updated for changed query/Stand behavior.
- Focused tests cover supported queries, explicit unsupported-query errors,
  version metadata behavior, and to-do example query behavior.

## Human-Imposed Requirements Ledger

- Do not spawn sub-agents.
- Do not revert unrelated changes; preserve unrelated task-log work.
- Keep `human-review-1-jul.md` untouched.
- Generated Protobuf output remains ignored/uncommitted.
- Keep code small, JVM-shaped, and not overengineered. No generic query engine,
  no broad abstractions, no long names.
- Query service should be a thin router/error translator; query-shape
  validation belongs at the smallest suitable existing boundary.
- Follow style rules: primary declaration first, no `Utils`, names max four
  semantic components, callbacks start with `on`, line length <= 120, prefer
  generated message clone APIs.

## Canonical Skill Applicability Check

Session skill inventory source:

- The active session exposed skill metadata for repo and user-installed skills,
  including `implement`, `verification-before-completion`, `codebase-design`,
  `javascript-testing-patterns`, `cqrs-implementation`, and
  `projection-patterns`.
- Checked user-installed entrypoints with
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`.
- Checked installed-skill lock with
  `sed -n '1,220p' /Users/armiol/.agents/.skill-lock.json`; the selected
  skill names and sources were visible in the lock output.
- Checked repo expected-skill manifest at
  `build-protocol/skills/EXPECTED_SKILLS.md`.

Task-provided skills:

- Required by prompt and read before task actions:
  `implement`, `verification-before-completion`, `codebase-design`,
  `javascript-testing-patterns`, `cqrs-implementation`,
  `projection-patterns`.

Selected skills and application:

- `implement`: drive the requested code/docs/tests and commit the branch.
- `verification-before-completion`: no completion or passing claims without
  fresh command evidence.
- `codebase-design`: keep the module interface small and avoid speculative
  seams.
- `javascript-testing-patterns`: use focused Vitest behavior tests around
  supported and rejected query shapes.
- `cqrs-implementation` / `projection-patterns`: apply only the read-side
  separation guidance; do not introduce a broad query engine.

Skipped relevant-looking skills:

- `subagent-driven-development`, `requesting-code-review`, and `review` are
  relevant to the broader protocol, but skipped for this implementing session
  because the prompt explicitly forbids spawning sub-agents.
- `test-driven-development` / `tdd` overlap with
  `javascript-testing-patterns`; tests will still be written before practical
  implementation edits.
- `architecture-decision-records` is not selected unless a new architectural
  decision becomes necessary.

Unavailable requested sources:

- `build-protocol/work-logs/T-0016c.md`,
  `build-protocol/reviews/T-0016c-query-readiness.md`, and this task file were
  absent before this implementation pass.
- `build-protocol/DECISION_LOG.md` does not contain `D-0061` in this checkout.

## JVM Inspection

Read local JVM research notes:

- `spine-jvm-docs/spine-client-api-queries-subscriptions-and-tests.md`
  query/target/filter/response-format sections.
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md` query/subscription
  delivery section.
- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md` query service
  behavior section.
- `spine-jvm-docs/spine-entities-repositories-and-state.md` query/read model
  access section.

Impact:

- `QueryService.Read` should route by target state type, remain a thin adapter,
  and delegate read-side execution to `Stand`.
- The TS slice should support ID filters and projection include-all reads only,
  and explicitly reject field/column filters and response-format features until
  a later query task implements them.

