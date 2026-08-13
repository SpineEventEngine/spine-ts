# T-0179: Generated TypeScript Provenance And Copyright Policy

Status: Implementation complete; accepted review corrections in progress

## Objective

Make every Spine-owned TypeScript generator emit deterministic generated-file
and declaration provenance while removing CodeMatters copyright headers from
all generated TypeScript. Keep the authored TS/TSX/Proto copyright contract,
including exactly one following blank line, unchanged.

This is the first implementation task in the reviewed
[Wave 11 plan](../../planning/WAVE_11_TS_TYPE_ROUTING_PLAN.md). It must establish
the generated-source policy before the fresh frozen Proto or semantic interface
generation is introduced.

## Classification

High-risk shared build and release behavior. This task changes multiple
generators, tracked and ignored generated artifacts, generated-clean policy,
copyright classification, and release verification.

## Baseline And Isolation

- Baseline: `origin/main@8ef4c066`.
- Branch: `task/T-0179-generated-source-policy`.
- Worktree: `.worktrees/T-0179-generated-source-policy`.
- `pnpm install --frozen-lockfile` passed for all 26 workspace projects.
- The dirty primary checkout remains untouched.

## Human-Imposed Requirements Ledger

1. Every generated TypeScript file has no CodeMatters copyright header.
2. Every generated TypeScript file begins with a file-level block saying Spine
   TypeScript generated it, warning that it must not be edited manually, and
   naming the stable original Proto import path or sorted source paths.
3. Every generated declaration has concise documentation identifying it as
   generated and naming its stable original Proto source where applicable.
4. Multi-source generated files list all stable source Proto paths in sorted
   order at file level and retain declaration-specific provenance.
5. Generated provenance never contains an absolute machine path, worktree path,
   staging path, backup path, or temporary path.
6. Buf-copied authored Proto copyright comments are removed from generated
   TypeScript before publication. The authored Proto source retains its header.
7. Tracked and ignored generator-owned TypeScript families follow one shared
   generated-source policy. Classification does not depend only on Git ignored
   or tracked status.
8. Copyright enforcement excludes generator-owned TypeScript from the authored
   header requirement and rejects a CodeMatters header in known generated
   output.
9. Eligible authored TS/TSX/Proto continues to require the exact approved 2026
   CodeMatters header and, for TS/TSX, exactly one following blank line.
10. Generator-owned outputs include Buf model files, Proto module registries,
    handler registries, rejection companions, entity-column companions, tracked
    registries, and tracked server fixtures. No current TypeScript generator
    family is silently omitted.
11. A second generation with unchanged inputs is byte-identical.
12. Failure during staged generation leaves the previous published generated
    output intact and cleans ordinary stage/backup/claim resources.
13. TDD is mandatory: observe a behavior-focused RED before changing production
    generation or enforcement code.
14. Do not intake the new upstream `options.proto`, add interface tokens,
    implement interface routing, change the To-Do domain, or rewrite reader
    documentation in this task.
15. Push every checkpoint immediately to configured `origin`. Do not push to
    `SpineEventEngine/spine-ts` or any other remote.

## Acceptance Criteria

1. One internal generated-notice/provenance policy is reused by every generator
   family; there is no independent near-copy per writer.
2. Generated Buf TypeScript begins with the approved generated-file block even
   when the Proto source starts with a CodeMatters header.
3. `proto-module.ts`, generated handler registries, rejection companions,
   entity-column companions, Message Board's tracked model registry, and the
   server's tracked descriptor fixture all conform.
4. Single-source and multi-source notices are deterministic and use only stable
   Proto import paths.
5. Declaration documentation identifies the relevant Proto source; file-only
   registries without one declaration still carry complete file provenance.
6. `scripts/check-copyright.mjs` shares the generator-owned classification,
   rejects a generated CodeMatters header, and preserves authored/header-spacing
   behavior.
7. Generated-clean and workflow tests prove repeat generation is byte-identical
   and does not dirty the worktree.
8. A failure after staged output exists does not replace the prior published
   generated tree.
9. Focused changed production branches reach at least 90% branch coverage or a
   line-by-line changed-range report demonstrates the same threshold.
10. Cheap preflight passes before one converged `pnpm verify:release`.

## TDD And Verification

Initial RED fixtures cover:

- a generated file retaining the old CodeMatters header;
- missing generated-file notice;
- missing do-not-edit wording;
- missing or absolute source provenance;
- unsorted multi-source provenance;
- a generated declaration without source documentation;
- a generated path accidentally treated as authored;
- an authored path accidentally exempted;
- second-run byte drift;
- staged-generation failure replacing prior output.

The cheap preflight includes focused tests, generated cleanliness, tooling and
affected-package typechecks, changed-file ESLint, cleanup, TSDoc, copyright,
formatting, `git diff --check`, and changed-production coverage inspection.
Because this is shared build/release behavior, the selected expensive profile
is one converged `pnpm verify:release`.

## Implementation Assignment

- Existing role: `implementer`.
- Function: senior TypeScript build/code-generation engineer.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Dispatch requirements: both fields explicit; sole writer for this worktree;
  no subagents; preserve unrelated work; use TDD; commit and push each coherent
  checkpoint; report RED/GREEN evidence, exact tests, coverage, limitations, and
  final commit.

## Review Plan

- Documentation completeness: generated notice/provenance wording and truthful
  task/status evidence.
- TypeScript/API documentation: generated declaration comments and any affected
  public generated declarations.
- Style/maintainability: shared policy depth, path ownership, and avoidance of
  duplicated writers/classifiers.
- Performance/reliability: deterministic generation, staging/rollback,
  resource cleanup, and fail-closed classification.
- Security: N/A for the task review unless path classification accepts input
  outside configured model roots; final Wave 11 security review remains T-0186.
