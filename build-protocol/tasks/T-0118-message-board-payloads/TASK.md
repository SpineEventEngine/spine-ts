# T-0118: Message Board Payload-First Synchronization

Status: Implementation complete; managed Chromium smoke and review pending

## Objective

Applies complete subscription update payloads directly to the Message Board
view and uses authoritative queries only for initial state and recovery.

## Classification

High-risk example behavior. The change owns asynchronous update/query races,
identity and board validation, atomic batches, ordering, reconnect recovery,
and user-visible logging across the browser/server boundary.

## Baseline And Isolation

- Baseline: `origin/main@f7065f58`.
- Branch: `task/T-0118-message-board-payloads`.
- Worktree: `.worktrees/T-0118-message-board-payloads`.
- The dirty primary checkout remains coordination-only and untouched.

## Acceptance Ledger

1. Initial board state comes from one Query.
2. A valid `state` update is decoded, identity-checked, board-checked, upserted,
   and sorted oldest-first without a Query.
3. `noLongerMatching` decodes the Entity ID, removes it idempotently, and does
   not Query.
4. A multi-update batch is fully validated before any visible row change.
5. Wrong update kind or `Any` type, missing/undecodable ID or state, identity
   mismatch, foreign-board state, or unusable empty batch schedules one
   coalesced authoritative recovery Query.
6. Reconnect and `gapPossible` recovery replace the complete row set.
7. A successful post relies on valid live updates while connected and performs
   one authoritative Query while disconnected.
8. Every valid live batch advances an update generation. An older recovery
   result cannot replace rows after a newer live batch, board switch, or
   unmount; a live batch during required recovery schedules one coalesced
   follow-up Query.
9. Logging identifies applied payloads and explicit recovery reasons without
   leaking credentials or raw transport internals.
10. React tests cover update/upsert/removal/batching/order/malformed recovery,
    query counts/post behavior/unmount/stale completion/live-vs-recovery and
    board-switch races.
11. A real local backend/frontend Chromium smoke proves startup, query, post,
    payload-first live rendering, and useful console logging.
12. The reducer remains example-local; `client-react` and framework APIs do not
    gain a speculative abstraction. Broad docs remain T-0119.

## Implementation Assignment

- Existing role: implementer `/root/t0118_impl`.
- Ownership: Message Board web synchronization/reducer/logging, focused React
  tests, and task records.
- Expected and explicitly dispatched model: `gpt-5.6-terra`.
- Expected and explicitly dispatched reasoning: `medium`.
- Runtime self-introspection limitation or available metadata must be recorded
  before accepting results. The owner may not spawn subagents.

## Review Dispositions

- Style/maintainability: relevant to keeping the reducer example-local and
  understandable.
- Documentation: relevant only to changed inline/source claims; broad README
  work is T-0119.
- TypeScript/API docs: relevant to generated update decoding and client types.
- Performance/reliability: required for coalescing, stale-query suppression,
  atomic batches, lifecycle, and query counts.
- Security: N/A unless logging or decoding introduces sensitive-data or
  untrusted-input exposure.

## Verification Profile

Focused React coverage, app/web typechecks, managed local Chromium smoke, and
changed-line coverage precede review. Example/runtime integration requires one
converged `verify:release` gate.

## Implementation Evidence

- The example-local reducer validates complete `EntityStateUpdate` batches,
  applies valid state/removal payloads atomically, and returns explicit
  recovery reasons without entering `client-react`.
- `useBoardSync` preserves the initial authoritative Query, applies valid
  payloads without querying, coalesces malformed/gap recovery, and guards
  recovery completion with update generation and board identity.
- A successful post performs no Query while the subscription is connected and
  relies on its live payload. Without a connected subscription it performs one
  coalesced authoritative Query. Failed posts keep their current feedback and
  do not refresh.
- Focused web tests, app/web typechecks, changed-production lint, cleanup,
  TSDoc, formatting, and diff checks are complete. Chromium smoke and
  specialist review remain deliberately pending.
