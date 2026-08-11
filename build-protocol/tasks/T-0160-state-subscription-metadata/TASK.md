# T-0160: State-subscription metadata

Status: Complete; integrated and post-merge verified

## Objective

Teach authored and generated handler metadata to distinguish an Entity-state
`@Subscribe` handler from an Event subscriber, and cut generated handler
registries over atomically from version 1 to version 2.

## Classification

High-risk. This task changes decorator classification, public handler metadata,
build analysis, generated source, and runtime registry ingestion. It establishes
the durable metadata contract required by T-0161 state-update routing and
T-0163 `@Where`.

## Baseline And Isolation

- Baseline: `origin/main@a74a9e73`.
- Branch: `task/T-0160-state-subscription-metadata`.
- Worktree: `.worktrees/T-0160-state-subscription-metadata`.
- Preserve the dirty primary checkout and unrelated worktrees.
- Push only to `origin`; never push the upstream remote.

## Acceptance Criteria

1. Distinguish state and Event `@Subscribe` declarations from descriptor-backed
   signal provenance; do not use names, paths, or caller compatibility tags.
2. Add one canonical state-subscription handler kind and metadata record through
   decorator discovery, `HandlerRegistrationBuilder`, `EntityHandlersMetadata`,
   registry validation, lookup, and root exports.
3. Preserve Event subscriber behavior and ordering. State subscriptions must not
   enter Event readiness indexes, and Event subscriptions must not enter the new
   state-subscription metadata surface.
4. Define generated handler registry version 2 with an explicit representation
   of both subscriber kinds. Render version 2 deterministically and ingest it
   into the same canonical metadata used by authored decorators.
5. Reject generated version 1 after the cutover, along with unknown kinds,
   invalid schema provenance, invalid arity, and malformed emitted-schema
   records. Do not add a compatibility alias or dual-version parser.
6. Update the build-time analyzer and generated-registry writer so state and
   Event subscriptions are classified from the handler parameter schema and
   render stable version-2 records.
7. Cover authored decorators, generated analyzer output, writer snapshots,
   ingestion/discovery, registry snapshots, Event behavior preservation, and
   explicit version-1 rejection with focused RED/GREEN tests.
8. Reach at least 90% in every changed-production-source metric and pass the
   generated build, tooling, changed TypeScript ESLint, cleanup, TSDoc/API,
   Prettier, `git diff --check`, and prohibited compatibility scans.
9. Complete one style/maintainability, TypeScript/API documentation,
   documentation/TSDoc, and performance/reliability review wave. Security is
   N/A because metadata classification does not change a trust boundary.
10. Run one final `verify:task`, merge to `origin/main`, and delete the merged
    task branch and worktrees.

## Exclusions

- State-update routing or delivery, `@Where`, field Stringifiers, implicit
  required IDs, rejection conformance, examples, and product Markdown.
- Version-1 compatibility ingestion, caller tags as descriptor provenance, or a
  second generated registry format.

## Implementation Assignment

- Existing role: implementer acting as a senior TypeScript metadata/generator
  engineer.
- Ownership: handler decorator classification and metadata/builder surfaces;
  build-time analyzer; generated registry contract/writer/ingestion/discovery;
  exports, focused tests, and T-0160 records.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Both dispatch fields are explicit. The implementer must not spawn subagents.

## Review And Verification

- Style/maintainability: required; configured `gpt-5.6-terra` / high.
- TypeScript/API documentation: required; configured `gpt-5.6-terra` / high.
- Documentation/TSDoc: required; configured documentation reviewer
  `gpt-5.6-luna` / medium.
- Performance/reliability: required; configured `gpt-5.6-terra` / high.
- Security: N/A because no authentication, authorization, secret, persistence,
  or external trust-boundary behavior changes.
