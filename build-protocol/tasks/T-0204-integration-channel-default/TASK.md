# T-0204 — Integration channel default and terminology

**Status:** Complete and release-verified; isolated integration pending

## Classification and baseline

- Risk: **high** because this changes a public Production setting and shared
  transport lifecycle used by every Bounded Context in a process.
- Baseline: `e41e92d86bb34fa7a43579c2457baa5c1a213ad6`.
- Branch/worktree: `codex/t0204-integration-default` at
  `/tmp/spine-ts-t0204`.
- Owner: existing `implementer` role, senior TypeScript/server-runtime
  engineer; explicitly configured `gpt-5.6-terra`, reasoning `medium`.
- The owner must not spawn subagents. Runtime self-telemetry is unavailable
  unless the execution surface reports it; the explicit dispatch fields are
  the profile evidence.

## Objective and ownership

Rename the application-facing IntegrationBroker setting from
`transportFactory` to optional `integrationChannelFactory`. When absent in any
environment, `ServerEnvironment` creates exactly one process-wide
`InMemoryTransportFactory`, shares it across all local Bounded Context brokers,
and closes it once. A supplied custom factory remains authoritative and is also
closed once.

Owned paths:

- `packages/server/src/server/server-environment.ts`;
- the narrowly required IntegrationBroker lookup in
  `packages/server/src/context/bounded-context.ts`;
- affected server exports, TypeDoc/API inventory, and focused tests;
- this task's records.

Do not edit the generic signal-routing subsystem, ZeroMQ adapters, Gateway,
Delivery, managed deployment, examples, or unrelated BoundedContext behavior.

## Human-Imposed Requirements Ledger

| ID         | Binding requirement                                                                                                                       | Behavioral proof                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| H-001      | Production must not require an explicitly configured integration channel factory.                                                         | Production environment and normal context build succeed without the setting.                                       |
| H-002      | One shared in-memory integration channel factory is owned inside each application process when no override is supplied.                   | Two local contexts exchange an external Event, observe one factory identity, and environment close closes it once. |
| H-003      | IntegrationBroker traffic does not pass through Gateway or Node Coordinator.                                                              | Dependency/import scan and same-process broker test.                                                               |
| H-018      | Preserve all accepted Wave 13 external-event semantics and the JVM-aligned `TransportFactory` SPI.                                        | Existing broker module/lifecycle regressions remain green.                                                         |
| H-NAME     | The application setting is `integrationChannelFactory`; the underlying JVM-aligned SPI remains `TransportFactory`.                        | Public declaration/API inventory assertion.                                                                        |
| H-SIGNAL   | The obsolete generic `transport` setting is not renamed in this task; it remains for ordered deletion in T-0212.                          | Focused diff and API review.                                                                                       |
| H-REGISTRY | Production continues to require the complete generated application `typeRegistry`; only the integration channel factory becomes optional. | Production validation regression.                                                                                  |

## Required implementation method

1. Follow test-driven development: retain RED evidence before product changes.
2. Inspect the task-relevant pinned Spine JVM `ServerEnvironment`,
   `TransportFactory`, and in-memory transport ownership/lifecycle before
   changing server code; record paths and impact in `WORKLOG.md`.
3. First RED: Production configuration without the integration factory fails
   today, then succeeds with exactly one default shared factory.
4. Second RED: a supplied custom factory overrides the default and closes once.
5. Preserve all current errors unrelated to this setting and do not add a new
   public or serialized concept.
6. Update TSDoc/API inventory and all directly affected configuration fixtures.

## Verification and review gate

- Focused server environment, broker lifecycle, broker module, and public index
  tests.
- Generated build, tooling typecheck, ESLint, TSDoc/API docs, Prettier, cleanup,
  copyright, and `git diff --check`.
- At least 90% changed executable line and branch coverage.
- Because this is shared public runtime/lifecycle work, run one converged
  `pnpm verify:release` after review corrections.
- Required review concerns: style/maintainability, TypeScript/API docs, and
  performance/reliability. Documentation is N/A only if no public prose beyond
  TSDoc/API inventory changes.
- Commit and push every checkpoint to
  `origin/codex/t0204-integration-default`.

## Skill applicability

- Selected and fully read by the orchestrator: `executing-plans`,
  `subagent-driven-development`, `using-git-worktrees`, and
  `test-driven-development`.
- The implementer must fully read `test-driven-development` before product
  work. `typescript-advanced-types` and `nodejs-backend-patterns` are not
  selected: this task changes ordinary settings/lifecycle and introduces no
  advanced type algorithm or web-service framework.
- Inventory sources checked: session skill catalog,
  `build-protocol/skills/EXPECTED_SKILLS.md`, bounded
  `~/.agents/skills/*/SKILL.md` enumeration, and
  `~/.agents/.skill-lock.json`.
- No external library search is needed: the task selects the already accepted
  in-repository `InMemoryTransportFactory` and adds no dependency.
