# T-0016g Review Log

Status: first-round findings fixed; formal re-review pending

Scope: small framework-owned server lifecycle owner for real local
gRPC-compatible services, lifecycle docs, example/test migration, and public API
docs.

Review note: all required reviewer lanes must be run by separate sub-agents.
Each participating implementation, fix, and reviewer sub-agent must be closed
after its role is complete.

## Required Lanes

| Lane                       | Status                        | Result                                                                                               |
| -------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| Code style/maintainability | First-round finding fixed     | Primary `Server` declaration now precedes supporting public interfaces in `server.ts`.               |
| Documentation completeness | First-round bookkeeping fixed | Work log, review log, and implementation report updated for first-round review-fix actions.          |
| TypeScript/API docs        | First-round findings fixed    | Public lifecycle TypeDoc now documents ownership, idempotence, and aggregate failure behavior.       |
| Security                   | First-round finding fixed     | `RunningServer.close()` now bounds graceful HTTP/2 session drain and destroys non-draining sessions. |
| Performance/reliability    | First-round finding fixed     | Direct `Stand` close now rejects new work, drains accepted reads/updates, then clears subscriptions. |

## Findings

### First Round

- Code style/maintainability: `packages/server/src/server/server.ts` placed
  supporting public interfaces before the primary declaration matching the file
  name. Status: fixed in review-fix pass by moving `Server` before
  `ServerOptions` and `RunningServer`.
- TypeScript/API docs: `Server.add(context)` did not state server ownership of
  added contexts or that `RunningServer.close()` closes them. Status: fixed.
- TypeScript/API docs: `RunningServer.close()` did not document idempotence or
  aggregate close failure behavior. Status: fixed.
- TypeScript/API docs: public close hooks on `BoundedContext`, `CommandBus`,
  `EventBus`, and `Stand` did not document idempotence/failure behavior enough
  for generated API docs. Status: fixed.
- Security/reliability: `RunningServer.close()` could hang indefinitely while an
  HTTP/2 stream/subscription stayed active. Status: fixed with bounded
  graceful session drain followed by `session.destroy()`, covered by an active
  HTTP/2 stream regression test.
- Performance/reliability: direct `Stand` operations were not deterministic
  when `close()` raced with an in-flight update. Status: fixed with in-flight
  operation tracking, close-begin rejection for new operations, and a delayed
  update regression test.
- Documentation/log bookkeeping: review log did not record first-round
  findings, work-log participants were stale, and implementation report did not
  include review-fix actions. Status: fixed in this pass.

Formal clean re-review of these fixed first-round findings remains pending for
the orchestrator unless it is run after this review-fix pass. Review-fix
verification passed, including the required focused native listener/lifecycle
suite, `typecheck`, `lint`, `format:check`, `docs:check`, `git diff --check`,
and full native `pnpm --config.verify-deps-before-run=false verify`.

## Review Policy

- Every formal reviewer lane must be run by a separate sub-agent.
- Findings must be fed back to an authoring/fix sub-agent.
- Re-review continues until all lanes are clean before integration.
- All participating sub-agents must be closed after their result is recorded.
