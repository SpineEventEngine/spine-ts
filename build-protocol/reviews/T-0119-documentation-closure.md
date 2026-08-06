# T-0119 Review Log

Status: First review wave complete; correction batch accepted

## Implementation Inventory

- Server README/reference, framework user guide, and architecture notes:
  paired domain/System Contexts, bus/store separation, optional system storage,
  and Stand query/subscription responsibilities.
- Message Board web/example and distributed topology: complete payload-first
  local updates, bounded authoritative recovery, one Gateway/two equal nodes,
  and separate simple-delivery coordination/subscription fan-in.
- Historical Wave 6/T-0113 records: explicitly superseded wording preserved as
  evidence rather than presented as current behavior.

## Scope

Reviews current documentation of domain/System EventBus separation, optional
system-event storage, Stand queries/subscriptions, payload-first live updates,
recovery behavior, and the single-Gateway/multi-node topology.

## Planned Dispositions

| Concern                 | Existing role/profile   | Status                                                                                         |
| ----------------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| Style/maintainability   | `gpt-5.6-terra` / high  | N/A: no production/test source structure changes; deterministic Markdown rules are mechanical. |
| Documentation           | `gpt-5.6-luna` / medium | Clean.                                                                                         |
| TypeScript/API docs     | `gpt-5.6-terra` / high  | One P2 accepted: a Stand paragraph collapses the two EventBus paths.                           |
| Performance/reliability | `gpt-5.6-terra` / high  | One P1 accepted: the distributed README command test relies on stale line indexes.             |

Every dispatch states the existing role, expected model, and expected
reasoning. Actual runtime metadata or the immutable configured-profile
limitation is recorded before accepting a result.

## Fresh Reader Test

Status: PASS — eight reader questions answered correctly.

The fresh reader used explicit `gpt-5.6-terra` / `medium`. Independent runtime
metadata is not exposed, so the immutable configured profile is the accepted
metadata evidence. One improvement was accepted: the server README now shows
the exact `BoundedContext.singleTenant(...).persistSystemEvents().build()`
builder chain. No runtime or Proto change was needed.

## Pre-Review Evidence

- `pnpm verify:task -- --no-tests` passes after the normal fresh-worktree
  Proto/declaration build: tooling TypeScript, cleanup, TSDoc, formatting,
  audience policy, release readiness, and 294 relative Markdown links are
  clean.
- A bounded `rg` audit finds no task/wave/review jargon in changed human docs
  and no current refresh-hint or domain-EventBus placement claim. The only
  matching domain-bus rejection text is a runtime test outside this docs task.
- Status, changed-path inventory, and the no-runtime-change boundary are
  current. No speculative adapter, scheduler, replay, exactly-once, or
  cluster-complete guarantee is claimed.

## First Review Wave

All reviewers used the expected existing role/profile. Runtime
self-introspection was unavailable, so explicit dispatch and immutable
configured-profile metadata are the accepted evidence.

Accepted correction batch:

1. **P1 — brittle README command test.** The distributed topology test checks
   continuation backslashes at hard-coded README line indexes. The new Mermaid
   section shifted valid commands, so the test fails. Locate and assert the
   commands structurally, then rerun it.
2. **P2 — collapsed EventBus wording.** One server README paragraph says Stand
   observes domain events and committed entity-state changes “from the
   EventBus.” Name the domain EventBus path for exposed domain events and the
   paired System Context EventBus path for `EntityStateChanged` explicitly.

No finding is rejected. Documentation is clean. API and reliability require
targeted confirmation after correction; the mechanical test refactor does not
make production style/maintainability relevant.
