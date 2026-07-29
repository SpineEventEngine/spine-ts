# T-0076: Remove obsolete `.superpowers` scratch storage

## Classification

Micro maintenance task. It changes no runtime behavior, public contract,
dependency, generated source, or end-user workflow.

## Human-Imposed Requirements Ledger

- Check whether repository-local `.superpowers` content is still in use.
- If it is not in use, remove the folder altogether.
- Preserve unrelated user files and dirty worktrees.
- Push every commit to `origin`.

## Acceptance

- The current build protocol does not require repository-local `.superpowers`
  storage.
- No tracked `.superpowers` path remains on the task branch.
- The obsolete live-plan pointer to a transient review package is removed.
- Historical prose about artifacts and the installed skills whose upstream
  source is named `obra/superpowers` remains intact; neither requires the
  repository-local folder.

## Review Disposition

- Style/maintainability: N/A; deletion of obsolete scratch reports and one
  factual plan correction only.
- Documentation: mechanically checked for current protocol references.
- TypeScript/API: N/A; no TypeScript or public API change.
- Performance/reliability: N/A; no executable behavior change.
- Security: N/A at task scope; no runtime or dependency change.

## Verification

- `test ! -e .superpowers`: passed.
- `git ls-files --error-unmatch .superpowers`: found no tracked path.
- Current governing-file search across `AGENTS.md`, `BUILD_PROTOCOL.md`,
  `PROJECT_COMPLETION_PLAN.md`, `CODE_QUALITY.md`, and `.gitignore`: found no
  `.superpowers` dependency.
- `git diff --check`: passed.
