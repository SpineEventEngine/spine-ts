# T-0017m: Production Parity Docs And Example Positioning

Status: complete, integrated
Started: `2026-07-09`
Branch: `task/T-0017m-production-parity-docs`
Worktree:
`.worktrees/T-0017m-production-parity-docs`
Base commit: `dc0c69f`

## Objective

Update public docs and example positioning so they honestly describe the
framework state after `T-0017a` through `T-0017l` landed.

## Scope

- Align top-level README, framework user guide, architecture notes, API docs,
  package docs, and to-do example docs where they mention runtime readiness,
  production parity, deferred work, local in-memory readiness, gRPC services,
  delivery, subscriptions, server lifecycle, or ZeroMQ transport.
- Keep the current implementation unchanged unless a docs build/test exposes a
  real broken reference.
- Keep example positioning accurate: the to-do app is runnable with real
  Connect/Node gRPC-compatible command/query/subscription routes and in-memory
  storage, not a production deployment recipe.
- Update durable task and parent logs.

## Out Of Scope

- New runtime behavior.
- New public APIs.
- Production storage adapters.
- Remote/multi-host transport.
- Broker supervision, health checks, deployment automation, authentication, or
  tracing implementation.
- Rewriting generated docs output by hand.

## Human-Imposed Requirements Ledger

- Continue autonomously until all tasks are done or a real blocker appears.
- Keep `human-review-1-jul.md` untouched.
- Use this branch/worktree for this task.
- Spawn one implementation sub-agent for the task.
- Run independent reviewer sub-agents for code style/maintainability,
  documentation, TypeScript/API docs, security, and performance/reliability.
- Feed reviewer comments back to an authoring/fix sub-agent and repeat until
  all lanes are clean.
- Close every participating sub-agent once its role is complete.
- No change may be made without updating the relevant durable log.
- Keep end-user code constraints visible: no framework `Event` envelopes, no
  manual transactions, no `@Apply`, no schema-bearing decorators, and no
  application-owned handler materialization.
- Avoid over-claiming production parity. The docs must distinguish verified
  local/example readiness from remaining production hardening.
- Server-module docs that make Spine parity claims must be checked against the
  local JVM notes before changing those claims.

## Research Inputs

- `build-protocol/tasks/T-0017-runtime-gap-roadmap/TASK.md`.
- `build-protocol/work-logs/T-0017.md`.
- `docs/USER_GUIDE.md`.
- `docs/architecture/README.md`.
- `docs/api/README.md`.
- `README.md`.
- `examples/todo/README.md`.
- `examples/todo/USER_GUIDE.md`.
- Package READMEs under `packages/*/README.md`.
- Local JVM notes only where a doc makes a Spine production-parity claim.

## Acceptance Criteria

- Public docs no longer describe completed `T-0017a` through `T-0017l`
  behavior as deferred.
- Public docs still name remaining production gaps clearly and do not claim the
  whole framework is complete.
- The to-do example docs clearly say it is a real local gRPC-compatible app
  backed by in-memory storage, and not a production persistence/deployment
  example.
- The top-level README and user guide provide a short developer path for build,
  generation, docs, focused example tests, and running the example.
- Durable logs record implementation, review, and verification evidence.

## Verification Plan

- Docs consistency scans for stale deferred/runtime-readiness wording.
- Example README/user-guide inspection.
- `pnpm --config.verify-deps-before-run=false typecheck:build`.
- `pnpm --config.verify-deps-before-run=false format:check`.
- `pnpm --config.verify-deps-before-run=false docs:check`.
- `git diff --check`.
