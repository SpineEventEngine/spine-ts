# T-0195 Wave 13 Planning Ledger

## Goal

Close P-01 with Spine JVM-aligned cross-context external-event behavior while
preserving the binding human directive, protected checkout state, frozen wire
identity, and the repository build protocol.

## Baselines

- Spine TS: `d6287ae8f2219ea8b71811230289a64226b4a127`
- Spine JVM: `0779b5fa42ca5cebd0d2935fc3a3489ab47846dc`
- Isolated branch: `wave-13-external-events`

## Phases

- [completed] 1. Read canonical protocol, plans, decisions, architecture,
  API documentation, JVM guides, pinned JVM sources, contracts, and tests.
- [completed] 2. Dispatch the one required `requirements_splitter` and converge
  the human-requirements ledger, JVM matrix, substitution ledger, contract
  decision, dependency plan, ownership, and RED designs.
- [completed] 3. Review and commit the planning gate; push the checkpoint.
- [pending] 4. Capture failing-before evidence for all 22 acceptance groups.
- [pending] 5. Implement and review serialized contracts/transport seam,
  external handler semantics, and behavior harness with non-overlapping
  ownership.
- [pending] 6. Integrate the context-owned broker and lifecycle; run focused
  checks and push green checkpoints.
- [pending] 7. Converge behavior, changed coverage, cross-process proof,
  documentation, specialist review, and one correction batch.
- [pending] 8. Run cheap preflight then one release verification; integrate,
  post-merge verify, push main, and clean remote branches/tags.

## Global Constraints

- Conceptual Spine JVM parity is binding; no alternative TS architecture.
- No product code before the durable planning gate is complete and reviewed.
- TDD is mandatory at the agreed module seams; retain RED evidence.
- The primary checkout and all human changes are read-only.
- ContextTransport and SignalTransport have no broker authority.
- Exact Protobuf wire contracts are required; no JSON substitute.
- No external commands, broker-specific reliability store, ownership election,
  or later-wave feature.
- One production-code writer owns each hot file at a time; subagents may not
  spawn subagents.
- Every child dispatch records explicit role, scope, model, reasoning, and the
  runtime-telemetry limitation.

## Errors Encountered

| Error                                                           | Attempt | Resolution                                                             |
| --------------------------------------------------------------- | ------: | ---------------------------------------------------------------------- |
| Focused baseline could not resolve workspace package entries.   |       1 | Run canonical generated setup before Vitest.                           |
| `typecheck:build:generated` could not find Proto outputs.       |       2 | Run `proto:generate` before the generated build.                       |
| Proto generation refreshed otherwise equivalent generation IDs. |       1 | Restore only those IDs to exact baseline values with targeted patches. |
