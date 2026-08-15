# T-0190: Production Normalized-Plan Execution

Status: In progress
Baseline: `e2ab42d2`
Branch: `codex/wave-12-query-plans`

## Scope and acceptance

High-risk runtime correction (provider persistence, tenant/group containment,
and public query behavior). Implement the accepted D-0114 matrix: the base
provider seam fails closed for nonempty plans; omitted candidate limit means
10,000; MySQL admits and executes IDs, comparisons, nested ALL/EITHER,
ordering, limit, and mask as bound SQL; Datastore admits only genuine legal
overlap and rejects unsupported shapes before provider access. Preserve D-0098
bound parameters and D-0111 typed value mapping. No browser or Inbox lifecycle
files are in scope.

## Assignment and durable constraints

- Existing role: `implementer`; explicit `gpt-5.6-terra` / `medium` dispatch.
  Runtime telemetry is unavailable; configured profile is the evidence.
- Use production-path RED tests without replacing `queryPlanEntries()`.
- Provider-bearing resources run sequentially and live MySQL/emulator evidence
  is recorded separately from V8 coverage. Changed executable code requires
  > =90% lines and branches.
- Canonical inputs read: AGENTS, BUILD_PROTOCOL, completion/Wave 12 plans,
  T-0187 task/dispatch/handoff, and D-0098/D-0111/D-0114.

## Coverage Ownership Transfer

The initial existing `implementer` exhausted its execution window after the
durable live-provider and contract endpoint `33fccfce`. It is inactive. A
replacement existing `implementer` continues the same query/provider file
ownership with explicit `gpt-5.6-terra` / medium dispatch, no subagents, and
no Inbox/browser scope. Desktop runtime model/token/latency telemetry remains
unavailable; the immutable configured profile is the evidence.

## Initial evidence and next action

Records created before product edits. Next: frozen dependency install and a
production-path RED proving baseline MySQL comparison rejection and
equality/ID full-group fallback; Datastore unsupported-shape behavior is a
diagnostic, not a presumed failure.

## TDD evidence

The focused production MySQL equality/order/limit test first failed at actual
baseline policy admission (`Storage provider does not support ordering`), with
no monkey-patched plan method. It is GREEN after the minimal MySQL capability
and bound-SQL implementation. The clean-worktree missing-generated-package
error was repaired by normal generation/build setup and is not RED evidence.
