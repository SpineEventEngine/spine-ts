# Release4 correction style and maintainability review

Scope: read-only review of the current correction diff from `ee7373148` and its affected test/tooling paths. I read the task's human requirements ledger, current `AGENTS.md`, `BUILD_PROTOCOL.md`, `CODE_QUALITY.md`, `REVIEW.md`, and `release4-corrections.md`. Superseded history was not used as an active contract. Configured existing role: `style_maintainability_reviewer`; explicitly dispatched model `gpt-6-sol`, reasoning `medium`, Standard speed. Actual runtime model metadata is unavailable on this surface. I did not edit source or rerun builds or tests; the recorded consolidated 18-file/483-test pass and focused static checks are the mechanical evidence.

## Finding

**P2 — Identify the failed batch row in the pending-status assertion.** `packages/server/test/context/entity-inbox.test.ts:313-315` asserts that exactly one row is `TO_DELIVER`, but matches only its status. The test title and the human processing/acknowledgement requirement require the failed `first` row to remain pending while the successful `second` row completes. If those statuses were reversed, the current assertion and `replayed` order would still pass. Match `signalId: "signal-first"` in the pending row and assert `signal-second` is absent from pending rows (or check its completed status if the storage contract retains completed rows). Keep the existing exact-error and replay-order assertions.

## Other scoped observations

The package imports, private fixture export, build cleanup path, isolated TypeScript fixture flags, and repository-root scanner adjustment fit the current package and tooling layout. The ACK fixtures and propagated-error expectations follow the active ledger. I found no other concrete style or maintainability defect in this correction diff. This review does not reopen rejected cross-record atomicity, swallowed processing failures, raw-stream reconnection, or legacy compatibility requirements.
