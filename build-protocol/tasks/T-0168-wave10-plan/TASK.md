# T-0168: Wave 10 Beginner Documentation And Copyright Plan

Status: Planning in progress

## Objective

Freeze a dependency-ordered Wave 10 plan for four outcomes: a complete
beginner rewrite of `docs/USER_GUIDE.md`, a correction of current
reader-facing Markdown and README files, one navigable hierarchy of concise
introductions and dense references, and repository-wide license/copyright
convergence for Spine-TS-authored TypeScript, TSX, and Proto sources.

This task is planning-only. It must not edit reader-facing product Markdown,
source headers, the root license, or package manifests.

## Classification

High-risk planning. The future work is broad, changes the primary learning path
for framework users, introduces shared deterministic tooling, changes package
metadata, and mechanically touches most authored source files. The plan must
therefore establish precise ownership, exclusions, review-sized slices, and
verification boundaries before implementation begins.

## Baseline And Isolation

- Baseline: `origin/main@c581c2fa`.
- Branch: `task/T-0168-wave10-plan`.
- Worktree: `.worktrees/T-0168-wave10-plan`.
- The dirty primary checkout remains coordination-only and untouched.
- `pnpm install --frozen-lockfile` passed.
- Clean-baseline `pnpm verify:task -- --no-tests` passed the build, tooling,
  cleanup/TSDoc/log, formatting, TypeDoc/API, Proto, generated-cleanliness,
  package/import, and 320-link release-readiness checks.

## Human-Imposed Requirements Ledger

1. Wave 10 contains only: the beginner `docs/USER_GUIDE.md` rewrite, current
   reader-facing Markdown/README correction, canonical dense references with
   checked links, and copyright/license correction.
2. Multiple-Gateway behavior is deferred beyond Wave 10. Cloud Run remains
   outside the initial offering.
3. Rewrite only current reader-facing documentation. Do not rewrite historical
   task, review, work-log, research, or migration records merely because they
   are Markdown.
4. The human audience is primarily beginners. README files and most product
   documentation must be simple to read, gradual, and free of dense mechanical
   prose or characteristic AI wording.
5. Preserve every README's existing look and feel.
6. Use three deliberate detail levels: README files introduce and orient;
   `docs/USER_GUIDE.md` teaches complete working journeys; REFERENCE/TypeDoc and
   focused provider/deployment documents hold exhaustive contracts and limits.
7. The guide structure is approved: domain discovery; project creation; Proto
   model; behavior implementation; commands/reads/queries/subscriptions;
   persistence; testing; logging/observability; packaging/deployment; examples.
8. Add the exact CodeMatters Apache 2.0 header approved by the human to every
   eligible Spine-TS-authored `.ts`, `.tsx`, and `.proto` file. Every header
   added in this wave says `Copyright 2026, CodeMatters. All rights reserved.`
9. Do not infer historical copyright years. The current-year update rule
   applies only to future content modifications after this wave.
10. A future content change updates the header year to the year of that content
    change. A header-only correction or pure rename does not itself advance the
    year.
11. Third-party and frozen files retain their existing copyright notices and
    must not receive or be rewritten to the CodeMatters header. This includes
    frozen shared Spine Proto and the vendored gRPC health Proto.
12. Generated output is excluded and remains ignored/untracked. Markdown files
    do not receive source headers.
13. Add the canonical Apache License 2.0 text as the root `LICENSE`, byte-for-
    byte equivalent in legal content to the current `core-jvm/LICENSE`.
14. Add `"license": "Apache-2.0"` to every framework package manifest intended
    for publication. Do not misclassify private example applications as
    publishable packages.
15. Add a lightweight deterministic copyright checker. It requires the exact
    approved header on eligible authored sources, rejects that header on
    excluded third-party/frozen sources, and enforces the future changed-content
    year rule without inventing historical dates.
16. Expose the checker as `pnpm lint:copyright`; include it in `pnpm lint`,
    `pnpm verify:task`, `pnpm verify:release`, and future publication preflight.
    Do not run it implicitly from ordinary `tsc`, application startup, Proto
    generation, or individual Vitest commands.
17. Keep one canonical explanation per dense topic and link to it. Avoid
    duplicating provider limits, deployment mechanics, or exhaustive API
    contracts across beginner documents.
18. All relative links must resolve. Every guide section that hands off detail
    must point to one intentional canonical target.
19. Preserve user-owned dirty files in the primary checkout. Push only to
    `origin`; never update the SpineEventEngine remote without a new explicit
    one-time instruction.
20. This task produces a proposal for human approval. Implementation must not
    start until the approved plan is integrated and the human starts Wave 10.

## Skill Applicability

- Inventory sources: the session skill catalog,
  `build-protocol/skills/EXPECTED_SKILLS.md`, and
  `~/.agents/.skill-lock.json`.
- Selected and fully read: `using-git-worktrees` and
  `epic-breakdown-advisor`.
- `using-git-worktrees` established a clean planning branch while preserving
  the user's primary checkout changes.
- `epic-breakdown-advisor` applies the simple/complex and major-effort split
  patterns: each documentation task must deliver a complete reader journey or
  navigable document family, while the mechanical copyright migration remains
  a separate independently verifiable slice.
- `doc-coauthoring` is not selected for this planning task because the human
  has already approved the document hierarchy and asked for an executable
  repository plan, not an interactive drafting interview.
- `planning-with-files` is not selected because canonical build-protocol task,
  work, review, and planning records already supply durable state.
- `verification-before-completion` and `requesting-code-review` apply at the
  later plan-verification/review boundaries and will be read before those
  actions.

## Requirements-Splitter Assignment

- Existing role: `requirements_splitter`, acting as a senior documentation
  architecture, licensing-policy, and monorepo release planner.
- Scope: read this complete ledger, the current completion plan, the Wave 9
  handoff, current reader-facing Markdown inventory, package manifests, source
  inventory, existing verification tooling, and current `core-jvm/LICENSE`.
  Produce the smallest dependency-ordered Wave 10 task split with exact file
  ownership, acceptance criteria, checker/year semantics, exclusions,
  verification profiles, and specialist review dispositions. Identify
  contradictions but do not reopen human decisions already frozen here.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: `high`.
- Dispatch requirement: both fields explicit; read-only; no subagents; no file
  edits.

## Verification Profile

This is record-only planning and uses `pnpm verify:task -- --no-tests` after
deterministic Markdown/status/link checks and plan-review convergence.
