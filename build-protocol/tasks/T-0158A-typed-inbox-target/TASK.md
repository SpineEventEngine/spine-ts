# T-0158A: Typed Inbox Target Identity

Status: Complete; integrated and post-merge verified

## Objective

Make the server's durable Inbox identity match Spine JVM: persist the target
Entity ID as typed `EntityId(Any)` produced by core `Identifiers`, not as a
string forced into `StringValue`. Preserve existing string-ID shard behavior
and provide deterministic identity for supported non-string IDs.

## Classification

High-risk. This task corrects a shared public/in-memory delivery contract and a
serialized direct-record field used by handoff, deduplication, sharding,
providers, and restart replay.

## Baseline And Isolation

- Baseline: `origin/main@e3bd0dfa`.
- Branch: `task/T-0158A-typed-inbox-target`.
- Worktree: `.worktrees/T-0158A-typed-inbox-target`.
- Preserve the dirty primary checkout and unrelated worktrees.
- Push only to `origin`; never push the upstream remote.

## Acceptance Criteria

1. `InboxId.targetId` is a deeply copied Protobuf `Any`, equivalent to JVM
   `InboxId.entity_id.id`. No tagged/private string representation is added.
2. `InboxRecords` writes and reads the existing generated `InboxId` wire shape
   without converting typed targets to `StringValue`. String, int32, int64, and
   structured message IDs preserve exact `typeUrl` and bytes.
3. Handoff callers pack repository IDs through existing core `Identifiers`;
   replay later unpacks through the descriptor-selected identifier type.
   Stringifiers do not participate.
4. Complete Inbox identity equality and deduplication distinguish the same
   printable value encoded as string, int32, int64, or message.
5. `DeliveryStrategy` and default sharding consume complete packed identity.
   Existing valid string targets retain exact current shard assignments;
   non-string targets hash deterministic canonical Protobuf identity and remain
   stable before persistence, after provider read, and after restart.
6. Input/snapshot/storage boundaries deep-clone `Any`; caller mutation cannot
   alter stored, sharded, or delivered identity.
7. Existing unreleased string rows remain readable as `Any(StringValue)`.
   Malformed/default/mismatched values fail explicitly; no guessed fallback or
   dual representation exists.
8. Memory, MySQL, and Datastore provider conformance uses the unchanged direct
   `InboxMessage` record family; no provider production, DDL, kind, index,
   Proto, or package dependency change is introduced beyond required existing
   core/proto imports.
9. Cover JVM-shaped golden values, all four ID kinds, cross-kind inequality,
   deduplication, sharding, clone safety, corrupt rows, provider construction,
   and public TypeScript/TSDoc contracts with focused RED/GREEN tests.
10. Reach at least 90% in every changed-production-source metric; run relevant
    builds/typechecks, changed TypeScript ESLint, TSDoc/API checks, Prettier,
    `git diff --check`, and scans for the retired string-only assumptions.
11. Complete one style/maintainability, TypeScript/API documentation,
    documentation/TSDoc, and performance/reliability review wave. Security is
    N/A because no trust boundary changes.
12. Run one final `verify:task`, merge to `origin/main`, delete the merged task
    branch/worktrees, then back-merge `origin/main` into published T-0158
    without rewriting it.

## Exclusions

- Command/Event/state route selection, repository replay conversion,
  Stringifier field APIs, provider production changes, Proto schema edits,
  product Markdown, examples, and copyright headers.
- Compatibility aliases, dual string/typed fields, or migration tooling for
  unreleased branch-only data.

## Implementation Assignment

- Existing role: implementer acting as a senior TypeScript delivery/storage
  engineer.
- Ownership: the server delivery Inbox identity, direct record converter,
  sharding/handoff plumbing, direct provider-conformance tests, affected public
  exports/TSDoc, and T-0158A records.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Both dispatch fields are explicit. The implementer must not spawn subagents.

## Architecture Assignment

- Existing role: requirements splitter.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: `high`.
- Runtime self-introspection was unavailable; the immutable configured profile
  is evidence. The bounded decision is recorded in T-0158's work log.

## Review And Verification

- Style/maintainability: required; configured `gpt-5.6-terra` / high.
- TypeScript/API documentation: required; configured `gpt-5.6-terra` / high.
- Documentation/TSDoc: required; configured documentation reviewer
  `gpt-5.6-luna` / medium.
- Performance/reliability: required; configured `gpt-5.6-terra` / high.
- Security: N/A; no authentication, authorization, secret, or trust-boundary
  behavior changes.
