# T-0114: EventBus Persistence Policy

Status: Review corrections verified; re-review and integration pending

## Objective

Makes storing and forgetting explicit internal EventBus behavior while keeping
the existing public storing constructor unchanged. Forgotten events must still
be validated and dispatched, but must never open or append an EventStore.

## Classification

High-risk. This task changes event persistence and dispatch ordering in shared
server runtime code. It does not add a public API or build the System Context;
those belong to T-0115.

## Baseline And Isolation

- Baseline: `origin/main@b233d06e`.
- Branch: `task/T-0114-system-event-policy`.
- Worktree: `.worktrees/T-0114-system-event-policy`.
- The dirty primary checkout remains coordination-only and untouched.

## Human-Imposed Requirements Ledger

1. System events are forgotten by default and may be persisted only through
   the later narrow Bounded Context option.
2. A forgotten event is validated and dispatched normally without touching
   event storage. It is not treated as an already-stored event.
3. Domain EventBus behavior remains storing, including duplicate-ID handling.
4. Direct public `new EventBus(eventStore)` construction retains its call shape
   and storing behavior.
5. The forgetting selector is package-internal; T-0114 adds no public setting
   or settings hierarchy.
6. Stored replay and stored follow-up behavior remain available for actual
   already-persisted domain events.
7. Do not build or modify Spine JVM.
8. Do not publish to npm or push to the future migration remote.
9. Push every feature-branch commit to canonical `origin` immediately.
10. Preserve user-owned files, especially `human-review-1-jul.md`.

## Acceptance

- Focused tests visibly fail before production changes and distinguish storing,
  already-stored, and forgotten posting.
- Forgetting owns no EventStore and does not construct, open, append, read, or
  close event storage.
- Validation and dispatcher notification remain identical after admission.
- The server package root and generated TypeDoc expose no new policy symbol.
- Existing EventBus tests and changed-source coverage pass.

## Implementation Assignment

- Existing role: implementer.
- Agent task name: `/root/t0114_impl`.
- Scope: EventBus policy, focused tests, and current TSDoc/task records only.
- Expected model, explicitly dispatched: `gpt-5.6-terra`.
- Expected reasoning, explicitly dispatched: `medium`.
- Runtime metadata: the immutable implementer role/profile confirms
  `gpt-5.6-terra` / medium. Independent child self-introspection was not
  exposed, and no visible mismatch occurred.

## Skill Applicability

- Inventory sources: session skill inventory, bounded
  `find ~/.agents/skills -maxdepth 2 -name SKILL.md`,
  `build-protocol/skills/EXPECTED_SKILLS.md`, and
  `~/.agents/.skill-lock.json`.
- Selected and fully read by the orchestrator: `using-git-worktrees`,
  `executing-plans`, `subagent-driven-development`, and
  `test-driven-development`.
- The repository protocol supersedes the generic subagent skill where it asks
  for per-task generic reviewers or a `.superpowers` ledger: this project uses
  its existing specialist roles and durable task/work/review logs.
- `requesting-code-review` and `verification-before-completion` become
  applicable at their later gates and must be read before those actions.
- `event-store-design`, `cqrs-implementation`, and `architecture-patterns`
  were triaged by name and metadata but are not selected: the approved plan
  already fixes the architecture, and this slice adds no storage schema or new
  CQRS boundary.
- No dependency is needed. The policy belongs to the existing EventBus; an
  external library would enlarge the runtime without solving a common
  infrastructure problem.

## Review Dispositions

- Style/maintainability: relevant because production EventBus structure changes.
- Documentation: N/A unless implementation changes public prose; current work
  changes only narrow TSDoc and durable internal records.
- TypeScript/API docs: relevant to proving no accidental public export and
  preserving constructor compatibility.
- Performance/reliability: relevant to persistence, ordering, and EventStore
  avoidance.

## Verification Profile

Focused EventBus tests and changed-source coverage run before review. Because
shared runtime persistence behavior changes, the converged task uses
`verify:release` once after review.

## Review-Correction Verification

- The forgetting assembly seam now accepts only dispatchers and creates an
  EventBus with no owned EventStore. Public `new EventBus(eventStore,
dispatchers?)` remains the storing construction path.
- Focused RED tests failed before production correction because the former
  factory still consumed an EventStore and close invoked its lifecycle hook.
- Focused GREEN evidence is 38 passing EventBus tests, including zero backing
  storage creation/access/close through construction, post, and close;
  validate-to-accept-to-dispatch-to-subscriber order; and validation/admission
  failure suppression.
- Changed-source coverage: 97.15% statements, 92.64% branches, 98.38%
  functions, and 97.43% lines for `packages/server/src/bus/event-bus.ts`.
