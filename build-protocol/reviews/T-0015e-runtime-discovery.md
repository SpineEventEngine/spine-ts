# Review Log: T-0015e Generated Registry Runtime Discovery

Status: self-review passed

Task log: `build-protocol/tasks/T-0015e-runtime-discovery/TASK.md`
Branch: `task/T-0015e-runtime-discovery`
Baseline commit: `df562b3`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0015e-runtime-discovery`

Required review lanes:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability;
- JVM alignment and ADR 0001 compliance.

## Human-Imposed Requirements Under Review

- Generated registry discovery is framework-owned.
- End-user apps must not materialize decorated handlers themselves.
- No schema-bearing decorators, `@Apply`, app-owned transactions, or framework
  envelopes in ordinary handler code.
- T-0015e must not implement to-do example migration or two-argument handler
  invocation changes.
- Discovery must stay explicit/conventional, not broad package scanning.

## Rounds

- `2026-07-07 22:55 WEST` — Codex implementation sub-agent — Self-review pass.
  - Code style/maintainability: `GeneratedRegistryDiscovery` stays small and
    explicit. It loads only caller-provided module refs, offers conventional
    path/URL helpers, validates only top-level module shape, and stages
    metadata before mutating caller-owned registries.
  - Documentation: updated `build-protocol/TECHNICAL_SPEC.md`,
    `build-protocol/DEVELOPER_API.md`, `packages/server/README.md`, and the
    API-doc export guard in `scripts/check-api-docs.mjs`.
  - TypeScript/API docs: root exports updated and validated by
    `packages/server/test/index.test.ts` plus `corepack pnpm docs:check`.
  - Security: no package scanning, no process-global mutable runtime
    registration, no broad import magic; imports stay explicit and caller-owned.
  - Performance/reliability: discovery work is linear in the provided module
    list, with deterministic error codes for import failure, missing export,
    invalid module shape, and ingestion failure.
  - JVM alignment/ADR 0001: keeps handler discovery framework-owned and keeps
    end-user code away from `materializeDecoratedEntityHandlers()`.
- `2026-07-07 23:02 WEST` — Main orchestrator — Started independent review
  round 1.
  - Reviewers: code style/maintainability; documentation; TypeScript/API docs;
    security; performance/reliability; JVM alignment and ADR 0001 compliance.
  - Scope: validate the implemented T-0015e runtime discovery slice against the
    task acceptance criteria and human-imposed guardrails before any commit.
- `2026-07-07 23:13 WEST` — Main orchestrator — Completed independent review
  round 1.
  - Code style/maintainability findings: use `@spine-ts/proto` in the new test
    instead of importing another package's `src` path; inline the one-call
    `registerNewMetadata()` helper.
  - Documentation findings: none.
  - TypeScript/API docs findings: `load()` accepts unsupported numeric registry
    versions while returning `GeneratedHandlerRegistry`; shorten the five-part
    exported `GeneratedRegistryDiscoveryErrorCode` name; remove the unnecessary
    `GeneratedRegistryModuleRef` root export.
  - Security findings: reject non-`file:` URL schemes before dynamic import,
    covering `data:` and `node:` abuse cases.
  - Performance/reliability findings: snapshot `options.modules` before async
    imports and reject duplicate normalized module refs deterministically.
  - JVM alignment/ADR 0001 findings: same unsupported-version issue; otherwise
    no new `@Apply`, event-sourcing, end-user envelope, broad scanning, global
    registration, or invented server concept concerns.
- `2026-07-07 23:25 WEST` — Codex implementation sub-agent — Applied round-1
  fixes.
  - Switched the discovery test to `@spine-ts/proto`.
  - Inlined staged metadata registration.
  - Restricted registry module references to `file:` URLs or plain paths.
  - Made registry shape validation require version `1`.
  - Snapshotted module refs and rejected duplicate normalized module IDs.
  - Renamed `GeneratedRegistryDiscoveryErrorCode` to
    `RegistryDiscoveryErrorCode` and removed the root export of the plain
    `string | URL` alias.
- `2026-07-07 23:28 WEST` — Main orchestrator — Started independent review
  round 2 over the round-1 fixes.
  - Scope: confirm all first-round findings are resolved without expanding the
    slice or weakening the T-0015e guardrails.
- `2026-07-07 23:43 WEST` — Main orchestrator — Completed independent review
  round 2.
  - Code style/maintainability finding: one test fixture line exceeded the
    120-character maximum.
  - Documentation findings: docs must say filesystem paths or `file:` URLs
    rather than generic module URLs; stale wording about automatic discovery
    must be clarified.
  - TypeScript/API docs finding: Windows drive-letter paths must not be
    misclassified as URL schemes.
  - Security finding: `file:` URLs with `search` or `hash` aliases can bypass
    duplicate detection and should be rejected or normalized deterministically.
  - Performance/reliability findings: malformed URL-like strings must produce
    `GeneratedRegistryDiscoveryError`; the missing-module test must use a
    unique absent file path; Windows path handling overlaps with the API lane.
  - JVM alignment/ADR 0001 findings: none.
- `2026-07-07 23:58 WEST` — Codex implementation sub-agent — Applied round-2
  fixes.
  - Reflowed the long test fixture line.
  - Updated docs to describe filesystem paths and clean `file:` URLs only.
  - Clarified that broad automatic scanning/global loading remain out of scope.
  - Rejected `file:` URL query/hash aliases and malformed URL-like strings
    deterministically.
  - Canonicalized clean `file:` URLs through file paths before import.
  - Treated Windows drive-letter strings as filesystem paths.
  - Made the missing-module test use a unique absent temp file.
- `2026-07-08 00:01 WEST` — Main orchestrator — Started independent review
  round 3 over the round-2 fixes.
  - Scope: confirm no remaining style/docs/API/security/reliability/JVM issues
    before final verification and integration.
- `2026-07-08 00:10 WEST` — Main orchestrator — Completed independent review
  round 3.
  - Documentation findings: clarify stale technical-spec wording about runtime
    discovery and remove duplicate review-log entries that appeared after the
    round-3 start.
  - Code style/maintainability findings: none.
  - TypeScript/API docs findings: none.
  - Security findings: none.
  - Performance/reliability findings: none.
  - JVM alignment/ADR 0001 findings: none.
- `2026-07-08 00:12 WEST` — Main orchestrator — Applied doc-only round-3
  cleanup.
  - Updated `build-protocol/TECHNICAL_SPEC.md` to distinguish explicit
    T-0015e runtime loading from later broad automatic scanning/global loading.
  - Removed duplicate out-of-order implementation summaries from this review
    log.
- `2026-07-08 00:16 WEST` — Focused documentation reviewer — Re-reviewed the
  round-3 documentation cleanup.
  - Findings: none.
  - Result: review loop is clean across all required lanes.
