# Delivered Inbox retention

Status: approved, local acknowledgement checkpoint implemented on
`receiver-shard-strategy`. Remote protocol scope awaits a human decision.

## Human-Imposed Requirements Ledger

- Newly received Inbox messages have no `keepUntil`.
- The first transition to `DELIVERED` establishes `keepUntil` at that transition
  time plus five seconds. Repeated or concurrent acknowledgement preserves the
  first stored deadline and returns the authoritative completed record.
- Apply this rule to the delivery mechanism uniformly. The additional protection
  for Aggregates and Process Managers is completely separate and must not change.
- Pending messages remain ineligible for delivered-record cleanup. Expiry permits
  cleanup rather than scheduling an exact-time deletion.
- Preserve the current acknowledgement boundaries, asynchronous follow-up delivery,
  receiver shard strategy, and separate delivery records for separate receivers.
- Correct retained duplicate detection across storage pages and process restart
  without backlog-sized working memory or a full-Inbox scan per pending message.
- Remote completion must establish and preserve the authoritative deadline. Do not
  claim server-side semantics that the supported server/protocol cannot provide.
- No migrations, arbitrary limits, cross-receiver transactions, or speculative
  Entity protection changes. Preserve frozen external contracts; raise conflicts.
- Use genuine domain fixtures, documented declarations, and `when_` names for
  authored Timestamp fields. Questions use the final reply's Questions section.
- Keep this work in the existing branch and worktree. Push each semantic commit
  immediately. Do not modify GitHub pull requests or issues.

## Approach

This is high-risk persistence and acknowledgement work. Test slow delivery,
repeated and concurrent completion, cleanup boundaries, receiver-specific
retention, page boundaries, restart, and supported remote acknowledgement.
Use the existing storage and delivery abstractions. Review remote protocol and
lookup requirements before extending their contracts.

The implementation must update reception, acknowledgement, downstream completion
snapshots, retained-evidence lookup, API documentation, and maintained custom
ports together. Local tests use controlled time rather than five-second waits.
The final verification profile is `verify:release` because delivery is shared
runtime. Independent maintainability, documentation, API, and reliability
reviews cover the final behavior.

## Remaining Work

The local first completion now establishes its five-second deadline, preserves
that deadline on matching repeated/concurrent acknowledgement, and supplies the
stored completed record to delivery observers. Focused Inbox, worker, Entity
Inbox, and repository tests pass, along with server typechecking and documentation
and cleanup checks. Full release verification and final independent review remain.

Reception-time deadlines remain temporarily because removing them before the
remote acknowledgement correction would eliminate remote retention. The existing
JVM RPCs provide unconditional writes, UUID reads, and timestamp shard paging;
they cannot guarantee server-authoritative acknowledgement or efficient retained
identity lookup. Resolve whether the complete remote behavior requires an
extended server, or whether corresponding JVM server work enters the scope.
Frozen Proto and additional Entity guards remain unchanged.

After that decision, complete reception cleanup, indexed retained-delivery
lookup, remote integration, custom-port contracts, documentation, independent
review, and release verification. GitHub CI requires a human-created pull request.
