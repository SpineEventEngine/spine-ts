# T-0157: Descriptor Semantic Metadata

Status: In progress

## Objective

Make `TypeRegistry` extract and preserve Spine descriptor `(is)` and
`(every_is)` Java-type semantics with explicit provenance. Keep caller-supplied
compatibility tags separate so later routing cannot mistake them for descriptor
declarations.

## Classification

High-risk. This task changes a public core registry contract and the semantic
metadata consumed by later Command, Event, and state-update routing tasks.

## Baseline And Isolation

- Baseline: `origin/main@9ab83fbc`.
- Branch: `task/T-0157-semantic-metadata`.
- Worktree: `.worktrees/T-0157-semantic-metadata`.
- Preserve the dirty primary checkout and unrelated worktrees.
- Push only to `origin`; never push the upstream remote.

## Acceptance Criteria

1. `TypeMetadata` exposes immutable `isTypes` and `everyIsTypes` arrays;
   `semanticTags` remains compatibility-only caller metadata.
2. `TypeRegistry` extracts `(is).java_type` from each message descriptor and
   `(every_is).java_type` from its file descriptor without caller input.
3. Descriptor values are trimmed, non-empty, stably deduplicated, and preserve
   source provenance when the same Java type occurs in both sources.
4. Malformed descriptor values fail registration with stable, descriptive
   errors; caller compatibility tags cannot populate descriptor-backed indexes.
5. `TypeRegistryLookup` adds immutable `findByIs(javaType)` and
   `findByEveryIs(javaType)` results. Registration order is deterministic.
6. Existing server Entity semantic extraction reuses the shared core
   descriptor behavior instead of maintaining a conflicting second parser.
7. Public exports and TSDoc accurately describe descriptor provenance and the
   compatibility-only role of `semanticTags`; product Markdown remains Wave 10.
8. Begin production behavior with focused RED tests and reach at least 90% in
   every changed-production-source metric.
9. Run focused tests, relevant package typechecks, changed TypeScript ESLint,
   TSDoc, API docs, Prettier, `git diff --check`, and prohibited compatibility
   scans.
10. Complete one style/maintainability, TypeScript/API documentation,
    documentation/TSDoc, and performance/reliability review wave. Security is
    N/A because no trust boundary changes.
11. Run one final `verify:task` after convergence, merge to `origin/main`, and
    delete the merged task branch/worktrees.

## Exclusions

- Command, Event, or state-update route selection and repository integration.
- Field Stringifiers, `@Where`, implicit required IDs, rejection conformance,
  example changes, product Markdown, and copyright headers.
- Compatibility aliases that allow caller tags to impersonate descriptor
  metadata.

## Implementation Assignment

- Existing role: implementer acting as a senior TypeScript public-contract
  engineer.
- Ownership: core `TypeRegistry` semantic metadata, shared Entity descriptor
  extraction, focused tests, exports/TSDoc, and T-0157 records.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Both dispatch fields are explicit. The implementer must not spawn subagents.

## Review And Verification

- Style/maintainability: required; configured `gpt-5.6-terra` / high.
- TypeScript/API documentation: required; configured `gpt-5.6-terra` / high.
- Documentation/TSDoc: required; configured documentation reviewer
  `gpt-5.6-luna` / medium.
- Performance/reliability: required; configured `gpt-5.6-terra` / high.
- Security: N/A; no authentication, authorization, secret, or trust-boundary
  behavior changes.
