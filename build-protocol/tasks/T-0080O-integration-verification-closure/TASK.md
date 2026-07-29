# T-0080O: Integrate, generate, verify, and close T-0080

## Status

Planned.

## Parent And Dependencies

- Parent: T-0080.
- Depends on: T-0080J, T-0080K, T-0080L, T-0080M, and T-0080N.
- Final slice.

## Objective

Reconcile shared generation and API expectations after all reviewed remediation
slices, prove no undocumented/name debt remains, regenerate only from authored
sources, and perform the one final repository-wide verification/integration
boundary.

## Classification

High-risk integration. It closes public TypeScript/package and authored
serialized-contract changes across the repository.

## Human-Imposed Requirements Ledger

- All production/example exported APIs and authored example Proto declarations
  satisfy the complete documentation rules.
- All authored TypeScript/example Proto names meet the four-component limit or
  one narrow source-backed compatibility exception.
- Every remaining standalone production/example function has a specific
  necessity disposition.
- Chat uses the approved nested family layout/package coordinates and complete
  foundational README.
- Single-module examples remain flat with `example-*` package names.
- Copied Spine JVM Proto remains unchanged and no generated output is
  hand-edited/tracked.
- All canonical review concerns have durable dispositions.
- One final full verification gate is run after convergence.
- No Spine JVM build and no package publication.

## Ownership

- Shared root expected-export/API-doc lists, generation aggregation, stale path
  removal, checker debt closure, release-readiness expectations, and parent
  task/work/review/completion records.
- Corrections are returned as one batch to the existing affected owner; this
  slice does not opportunistically rewrite production/example semantics.

## Acceptance Criteria

1. Repository-wide TSDoc and semantic-name checks pass with no residual debt
   records. Only exact standalone necessity dispositions and narrow immutable
   wire/JVM compatibility name exceptions may remain.
2. Every exception/disposition resolves to one current declaration, has a
   specific reason/owner, and is neither stale nor duplicated.
3. Clean root generation discovers nested Chat and all flat examples, succeeds
   from authored sources, and leaves generated output ignored/untracked.
4. No stale old Chat path/package coordinate appears in active workspace,
   build, generation, TypeDoc, release-readiness, docs, or package metadata.
5. Package/public export expectations, TypeDoc, Proto manifests, registry
   composition, package payloads, and all consumers agree.
6. Slice review logs show a complete disposition for style/maintainability,
   documentation, TypeScript/API docs, and performance/reliability. Unaffected
   lanes have concrete N/A reasons.
7. Pre-review lint checks status mirrors, accidental exports, duplicated policy,
   future overclaims, generated scratch, and end-user API prohibitions.
8. Any cross-slice findings are deduplicated into one correction batch; only
   substantively affected lanes reopen.
9. One final native `pnpm --config.verify-deps-before-run=false verify` passes
   with at least 90% branch coverage, followed by `git diff --check`, generated
   tracked/clean checks, and exact worktree inspection.
10. Merge/post-merge verification follows tree-equality and change-sensitive
    cadence; task branch, updated `main`, and tags are pushed and remote refs are
    proven before closure.

## Exclusions

- No new runtime/example capability, Wave 5/6 work, npm publication, or
  unrelated baseline cleanup.
- No third whole-change review wave absent unresolved P0/P1 or human direction.
- No duplicated full post-merge gate when the verified and merged trees are
  proven byte-identical and protocol conditions do not require it.

## Verification And Review

- All focused residual checks first, then the one full repository gate.
- Integration review covers only cross-slice/shared reconciliation; it relies
  on accepted immutable slice reviews rather than re-reviewing every unchanged
  package.
- No dedicated security review runs for this corrective program unless the
  human explicitly requests it. Any affected security boundary is recorded for
  the next project/release-readiness security gate.
