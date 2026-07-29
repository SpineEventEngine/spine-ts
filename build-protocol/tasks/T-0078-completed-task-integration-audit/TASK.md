# T-0078: Audit completed-task integration

## Status

Complete; reviewed and final verification passed; ready for `main` integration.

## Classification

High-risk repository maintenance. The audit may expose committed or
uncommitted task work outside `main`; incorrect reconciliation could duplicate
superseded code or lose unique work.

## Objective

Prove that every task durably recorded as completed has its accepted code and
records committed, pushed, and represented on canonical `main`. Rescue and
integrate any unique missing work through the normal task gates.

## Human-Imposed Requirements Ledger

- Review the repository after T-0077.
- Every task known to be completed must have its code committed and pushed.
- Completed accepted work must be merged where it belongs.
- Do not lose any work.
- Do not read, edit, stage, commit, delete, move, or use
  `human-review-1-jul.md` as project input.
- Preserve `human-review-22-jul.md` as user-owned untracked material.
- Push every commit to `origin` immediately.
- Use isolated worktrees and preserve unrelated dirty contents.
- Do not build Spine JVM.

## Acceptance Criteria

1. Build a machine-derived inventory of durable completed-task records.
2. For each completed task, prove direct ancestry on `main` or document the
   later canonical commit(s) that contain its accepted work.
3. Compare relevant local task/integration branches with remote refs.
4. Inspect dirty completed-task worktrees without reading protected files;
   rescue unique work before cleanup or integration.
5. Integrate, review, verify, and push any accepted missing implementation.
6. Record explicit dispositions for historical branches whose accepted content
   is represented by later `main` history.
7. Finish with local/remote `main` equality and no known completed accepted
   work existing only in a local branch or worktree.

## Investigation Assignments

Before dispatch:

- Orchestrator-dispatched completion-ledger and ancestry scan: expected
  `gpt-5.6-terra`, high reasoning; explicit dispatch fields required.
- Orchestrator-dispatched local/remote ref synchronization scan: expected
  `gpt-5.6-terra`, medium reasoning; explicit dispatch fields required.
- Orchestrator-dispatched dirty-worktree uniqueness scan: expected
  `gpt-5.6-terra`, high reasoning; explicit dispatch fields required.

The three scans are complete. Runtime self-metadata was unavailable; the
explicitly dispatched configured profiles are the available evidence.

All three dispatches explicitly set the expected model and reasoning. Runtime
self-metadata was unavailable; the configured profiles are the available
evidence and the results are accepted under the protocol.

## Investigation Results

- 172 task records at immutable baseline `e6bdc065` have recognized explicit
  completion, acceptance, or done status fields; superseded/abandoned records are
  excluded.
- 722 commit-like identifiers were extracted from task integration, merge,
  commit, branch, and push evidence. Of 708 identifiers that resolve to
  repository commits, all 708 are ancestors of `origin/main` at the audit
  baseline.
- All 60 completed remote task branches and both integration branches are
  ancestors of `origin/main`.
- Modern T-0046 and T-0048 through T-0077 work is committed, represented on
  `main`, and reflected by local remote-tracking refs.
- `codex/communication-milestones` is non-ancestral but has no unique patch
  content versus `main`.
- The pushed `rescue/dirty-root-20260729` branch is preservation-only and does
  not contain a missing current implementation.
- T-0048 had 16 unique untracked planning/review artifacts. They are now
  committed as `cf608c7b` and pushed on
  `rescue/T-0048-planning-20260729`; they do not belong on product `main`.
- Dirty historical worktrees contain no unique uncommitted source blobs.
  T-0066/T-0067 changes are executable-bit-only; T-0012-11b deletions are
  represented by later canonical history; recurring `.superpowers` deletions
  are intentional.

## Legacy Branch Ambiguity

Local T-0012a–g and T-0013.1–.6 branch families contain non-ancestral commits
and lack remote task refs. T-0012 is explicitly abandoned by the current build
protocol; T-0013 predates later canonical aggregate, registry, decorator, and
reactor implementations. Raw merging would reintroduce obsolete architecture.

Before disposition, dispatch the existing requirements splitter for a
capability-level mapping and exact preservation/push plan:

- Expected profile: `gpt-5.6-sol`, high reasoning.
- Model and reasoning must be explicit in dispatch.
- Scope: determine which branch families are completed, abandoned,
  superseded, or incomplete; map accepted capabilities to canonical `main`;
  identify any genuine missing behavior; and specify which legacy refs must be
  pushed without merging.

The splitter found no missing behavior:

- T-0012a–f are historically completed children integrated only into the
  explicitly abandoned T-0012 parent; T-0012g and the parent are incomplete.
- T-0013.1–.6 completed historical slices, but the T-0013 parent remained
  incomplete and the line was superseded by T-0014/T-0015/T-0017 and
  definitive Wave 2 repository/history work.
- Current `main` contains canonical command posting/routing, repository-owned
  transactions/event production, first-class rejections, delivery handoff,
  entity history storage, handler contracts, generated registries, bare
  decorators, aggregate cutover, and reactor/subscriber behavior.
- The removed `@Apply`/event-replay design is intentionally superseded, not
  missing.

All 15 legacy tips are pushed at their exact SHAs under non-active
`archive/legacy/*` refs. They must never be merged, cherry-picked, or rebased
into current `main`.

## Implementation Assignment

Before dispatch:

- Existing implementer role.
- Scope: create one durable completed-task integration/capability matrix and
  correct only provably stale top-level task status headers; do not rewrite
  historical chronology.
- Expected profile: `gpt-5.6-terra`, medium reasoning.
- Model and reasoning must be explicit in dispatch.
- Actual runtime metadata: the execution surface does not expose child
  self-introspection; the explicitly dispatched immutable configured profile is
  the available evidence.
- Result: the implementer created the durable audit matrix and reconciled only
  unambiguous modern status headers. No runtime, test, or production code was
  changed.

## Correction Batch

- Existing implementer role; expected/configured `gpt-5.6-terra`, medium
  reasoning, explicitly dispatched.
- Runtime metadata remains unavailable from the execution surface; the
  configured profile is the available evidence.
- Result: corrected the deterministic 172-row task-record inventory and
  generator to parse explicit status fields only, pin source/ancestry to
  `e6bdc065`, allow only named preservation refs outside that graph, and verify
  byte equality with `--check`. It retains explicit T-0077 preservation-only
  rescue disposition and T-0045/T-0047 coverage. No runtime, test, or
  production code changed.

A direct `git ls-remote origin` query verified canonical `main`, T-0078, both
rescue branches, and all 15 legacy archive refs at the recorded exact SHAs.

## Review Wave 1

- Documentation: CLEAN.
- Style/maintainability: one accepted P1 required a committed per-task
  inventory; two accepted P2 findings required current-tense log wording and
  removal of trailing whitespace.
- The complete correction batch returned to the existing implementer context
  at the same explicit `gpt-5.6-terra`/medium profile.

## Review Dispositions

- Style/maintainability: CLEAN after three focused waves. The final reviewer
  verified explicit status semantics, the immutable baseline, deterministic
  regeneration, and closure of all earlier findings.
- Documentation: CLEAN after factual re-review of the corrected 172-record
  inventory, ancestry/rescue evidence, continuity claims, and instructions.
- TypeScript/API: N/A because no source, export, declaration, generated model,
  or public API changes.
- Performance/reliability: N/A because no runtime, persistence, concurrency,
  lifecycle, resource, retry, or performance behavior changes.
- Security: N/A because the audit changed no product behavior, dependency,
  credential handling, trust boundary, or deployment behavior.

## Verification

- The checked-in inventory reproduces byte-for-byte from immutable baseline
  `e6bdc0653a55c5c09a1af3742e74626b81c43217`.
- 172 rows have unique task identifiers and paths, valid explicit status
  evidence, and seven well-formed TSV fields.
- All 886 resolved SHA occurrences belong to the immutable baseline except the
  single explicitly classified T-0077 preservation rescue.
- Node syntax, diff cleanliness, and Prettier checks pass for the complete task
  diff.
- The task worktree is clean and its local/remote branch tips match.
- Direct remote verification matched `main`, T-0078, both rescue refs, and all
  15 legacy archive refs to their recorded exact SHAs.
