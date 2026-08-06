# T-0119: Documentation And Correction Closure

Status: Complete; merged, post-merge verified, and pushed

## Slice Evidence

- `3891ff99` updates server README/reference, architecture, and user-guide
  surfaces for paired contexts, separate buses/stores, optional persistence,
  and Stand's read/subscription role.
- `df6cfaab` updates Message Board and distributed topology documentation for
  payload-first local application and separate delivery/subscription concerns.
- The final record slice audits historical Wave 6 wording and marks superseded
  claims without changing its evidence.

## Objective

Updates every current public and internal claim affected by the System Context
correction and Message Board payload-first synchronization, then closes the
approved correction sequence.

## Classification

Standard documentation milestone with reliability-sensitive architecture and
lifecycle claims. It changes no runtime or serialized contract, but incorrect
guidance could teach users the wrong persistence, event-bus, subscription, or
deployment model.

## Baseline And Isolation

- Baseline: `origin/main@a13ad590`.
- Branch: `task/T-0119-documentation-closure`.
- Worktree: `.worktrees/T-0119-documentation-closure`.
- The protected dirty primary checkout remains coordination-only and untouched.

## Acceptance Ledger

1. The server README and agent reference explain the paired domain/System
   Contexts and EventBuses, including which events belong to each bus and why
   system events do not enter the domain EventStore.
2. Human documentation explains that system-event persistence is configurable
   and optional without confusing it with domain-event persistence.
3. The framework user guide introduces commands, domain events, system events,
   queries, Stand, and subscriptions gradually, with current code snippets and
   diagrams that match the implementation.
4. Message Board documentation explains payload-first live updates: normal
   complete payloads update local rows directly; authoritative queries are for
   initial state and recovery after reconnects, possible gaps, malformed
   payloads, or disconnected posting.
5. Distributed Message Board documentation shows one Gateway serving multiple
   equal application nodes plus the simple delivery server, and separates
   command delivery coordination from subscription propagation.
6. Current Wave 6 decisions/completion records no longer place
   `EntityStateChanged` on the domain EventBus or describe every update as a
   query-refresh hint. Historical evidence is preserved but clearly marked as
   superseded where required.
7. Human-facing README/user-guide prose contains no task/wave/review jargon.
   Package `REFERENCE.md` files may use precise agent-oriented terminology but
   must link from their human README.
8. Commands, package names, paths, public APIs, Mermaid diagrams, snippets, and
   relative links pass deterministic checks and match the current tree.
9. A fresh-context reader test can correctly explain the bus boundary, Stand's
   query/subscription responsibilities, payload-first behavior, recovery
   triggers, and distributed topology without relying on conversation context.
10. The completion plan records T-0114 through T-0119 as complete only after
    review, release verification, integration, and remote synchronization.

## Documentation Assignment

- Existing bounded owner: implementer.
- Expected and explicitly dispatched model: `gpt-5.6-terra`.
- Expected and explicitly dispatched reasoning: `medium`.
- Ownership: affected README/REFERENCE/user-guide/architecture/topology and
  correction records, task/work/review records, and deterministic docs fixes.
- The owner may not spawn subagents and must not edit runtime TypeScript or
  Protobuf contracts without returning a concrete blocker.

## Skill Applicability

- Selected: `/Users/armiol/.agents/skills/doc-coauthoring/SKILL.md`, fully read
  by the orchestrator. The approved planning record supplies context and
  structure; autonomous drafting replaces another user interview, and a fresh
  reader agent supplies the required reader test.
- `requesting-code-review` and `verification-before-completion` remain governed
  by the repository review and verification gates already selected for this
  task.
- Library search is N/A because the task changes only prose/diagrams/records
  and must describe existing runtime rather than introduce infrastructure.

## Review Dispositions

- Style/maintainability: N/A because no production/test source structure is in
  scope; deterministic Markdown style is mechanical.
- Documentation: required for beginner flow, completeness, audience, and
  reader-context independence.
- TypeScript/API docs: required for snippets, package/API names, and exact
  public contract claims.
- Performance/reliability: required for EventBus persistence, Stand lifecycle,
  payload/recovery, and distributed topology claims.
- Security: N/A unless the audit changes authentication/trust-boundary guidance.

## Verification Profile

Run deterministic documentation, link, snippet, prohibited-wording, and status
checks before review. The planning contract requires one final
`verify:release` after review convergence because this milestone closes the
runtime/example correction sequence.
