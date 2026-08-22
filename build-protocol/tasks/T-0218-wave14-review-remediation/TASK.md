# T-0218: Wave 14 Review Remediation

Status: In progress
Start: `2026-08-22 Europe/Lisbon`
Baseline commit: `da40d2cafc39c3aa8c631363308502f1496f7ba9`
Branch: `codex/T-0218-wave14-review-remediation`
Worktree: `.worktrees/T-0218-wave14-review-remediation`
Authoring agent/function: existing `implementer` role
Configured dispatch: `gpt-5.6-terra` / `medium` (explicit)

Task classification: High-risk

The task changes shared child-process lifecycle behavior and narrows a public
TypeScript testing surface. It therefore requires behavior-first regression
tests, reliability and TypeScript/API review, and `verify:release` after review
convergence.

## Objective

Resolve the repository findings from the fresh Wave 14 review, except findings
that concern the disposable external publisher wrapper, which the human
explicitly excluded.

## Scope And Acceptance Criteria

1. Tarball-consumer test timeouts terminate and reap the complete child process
   tree; a regression test proves no descendant survives.
2. The public `@spine-event-engine/server/testing` entrypoint does not expose
   helpers documented as package-only or `@internal`, while retained public test
   helpers remain usable by their real consumers.
3. `BrowserClientOptions.baseUrls` requires at least one URL at compile time and
   retains its runtime validation.
4. T-0217 records and the project completion plan agree with the integrated,
   published Wave 14 state.
5. Remote-branch closure claims are reconciled with the actual protocol without
   deleting or rewriting unrelated, unmerged remote work.
6. Focused tests follow RED/GREEN, the complete relevant review wave converges,
   the mandatory cheap preflight passes, and one final `verify:release` passes.

## Human-Imposed Requirements Ledger

- Fix every fresh Wave 14 review finding except the disposable publisher
  wrapper findings.
- Do not modify, publish, authenticate, or otherwise rely on the disposable
  external publication wrapper.
- Work autonomously under `AGENTS.md` and `BUILD_PROTOCOL.md`.
- Use Standard speed and explicit project model routing; do not use Max or
  Ultra.
- Preserve unrelated user changes in the primary checkout.
- Push every feature-branch commit to configured `origin` immediately.
- Do not delete unmerged remote work solely to satisfy a cleanup claim.

## Finding Dispositions Before Implementation

- Accepted: timed-out external-consumer checks can leave descendant processes.
- Accepted pending usage audit: the server testing entrypoint exports helpers
  whose source documentation says package-only or `@internal`.
- Accepted: the `baseUrls` type permits an empty array despite its documented
  and runtime-enforced non-empty contract.
- Accepted: T-0217 status, end state, and integration result are stale.
- Accepted: the completion plan contains a pre-publication prohibition that is
  now contradicted by the recorded manual snapshot publication.
- Rejected as stated: `BUILD_PROTOCOL.md` does not require deleting every remote
  branch. The remaining `origin/codex/t0213-release-closure` is unmerged,
  unrelated work and must be preserved. Records will state the narrower,
  protocol-backed cleanup result.
- Excluded by the human: disposable wrapper trust, checkout cleanliness, and
  signal-cleanup findings.

## Assignment Gate

| Existing role/function | Bounded ownership | Explicit model | Explicit reasoning | Child spawning | Runtime metadata |
| --- | --- | --- | --- | --- | --- |
| `implementer` | All tests, runtime/API changes, documentation, and task records for this remediation branch | `gpt-5.6-terra` | medium | Prohibited | Desktop dispatch fields are explicit; self-telemetry may be unavailable. |

## Verification Plan

- RED/GREEN focused tests for process-tree cleanup, exports, and non-empty URL
  typing.
- Deterministic documentation/status checks and affected TypeScript checks.
- Relevant style/maintainability, TypeScript/API, documentation, and
  performance/reliability review; security is N/A because the publisher is
  excluded and no authentication boundary changes.
- Mandatory cheap preflight, then one converged `pnpm verify:release`.

## Work Log

- `2026-08-22`: The orchestrator verified the review against `origin/main`,
  preserved the dirty primary checkout, created this isolated worktree, and
  recorded the implementation assignment before authoring changes.

## Review Dispositions

- Code style/maintainability: pending.
- Documentation completeness: pending.
- TypeScript/API docs: pending.
- Performance/reliability: pending.
- Security: N/A; the human excluded the publisher and this task changes no
  credential, authentication, deserialization, dependency, or tenant boundary.

## Integration Result

Pending.
