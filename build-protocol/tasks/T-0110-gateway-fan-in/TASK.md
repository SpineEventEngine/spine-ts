# T-0110: Multi-Node Gateway Fan-In

Status: In Progress

## Objective

Allows one standalone Spine TS Gateway to connect to a fixed configured set of
application nodes. Unary commands and queries go to exactly one healthy node,
while subscription activation fans out to every configured node and merges
best-effort notifications for the browser client.

## Classification

High-risk. This task changes public Gateway configuration, authentication
context forwarding, concurrent native subscription lifecycle, durable binding
identity, bounded-resource cleanup, and backend failure behavior.

## Baseline And Isolation

- Baseline: `origin/main@451906b7`.
- Branch: `task/T-0110-gateway-fan-in`.
- Worktree: `.worktrees/T-0110-gateway-fan-in`.
- The dirty primary checkout remains coordination-only and untouched.

## Acceptance Criteria

1. One Gateway accepts between 1 and 32 fixed application-node endpoints.
2. Each command or query is sent once to one selected node; commands are never
   retried automatically on another node.
3. Selection is bounded round-robin over the fixed node set and preserves the
   authenticated Actor and Tenant context.
4. Subscription creation and activation reach every configured node and merge
   their best-effort notifications without retaining an unbounded deduplication
   history.
5. Duplicate notifications may be forwarded. Queries remain authoritative.
6. Partial activation closes every opened backend stream, deletes shared native
   definitions and durable Gateway bindings, and releases all capacity.
7. Cancellation fans out to all activated nodes, is idempotent, and safely joins
   a concurrent cancellation or close operation.
8. Backend stream loss notifies the client and leaves other backend streams
   active; cancellation prevents reconnect.
9. Durable binding recovery uses the same fixed backend fingerprint and rejects
   incompatible topology rather than silently attaching to a different set.
10. Backend count, URL ownership, cancellation, timeouts, buffers, and listener
    lifecycle remain finite and deterministic.
11. Existing combined/single-backend deployments remain supported through the
    same APIs; dynamic discovery belongs to Wave 7.
12. Native and browser interoperability tests plus the mandatory release gate
    pass. All relevant review concerns receive durable dispositions.

## Explicit Exclusions

- No dynamic service discovery or autoscaling membership protocol.
- No command retry, exactly-once, ordered, gap-free, or cluster-complete
  subscription guarantee.
- No second Gateway requirement for ordinary multi-node deployments.
- No JVM build or JVM source change.
- No package publication or push to the future migration remote.

## Human-Imposed Requirements Ledger

| Requirement                                                         | Disposition                                                                                                                                           |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| One Gateway connects to all fixed application nodes.                | Multi-backend configuration is bounded at 32 and replaces the current single backend as the general case.                                             |
| Application nodes may scale independently of ordinary Gateway load. | The Gateway topology is one-to-many; dynamic membership is deferred to Wave 7.                                                                        |
| Authentication stays outside Bounded Contexts.                      | Gateway resolves and forwards trusted Actor/Tenant context to the one selected unary node and every subscription node.                                |
| Keep notification guarantees minimal.                               | Backend losses are reported; duplicates may pass; clients reconnect and re-query authoritative state.                                                 |
| Preserve durable subscription recovery.                             | Binding identity includes a deterministic fingerprint of the fixed backend set.                                                                       |
| Avoid over-engineering.                                             | Existing BrowserServer, UnaryGateway, SubscriptionGateway, native relay, and binding seams are extended; no parallel gateway subsystem is introduced. |

## Verification Profile

- Cheap preflight and focused native/browser tests before review.
- Relevant style, documentation, TypeScript/API, reliability, and security
  dispositions after deterministic convergence.
- One final `pnpm verify:release`, followed by merge, post-merge verification,
  closure record, and remote synchronization.
