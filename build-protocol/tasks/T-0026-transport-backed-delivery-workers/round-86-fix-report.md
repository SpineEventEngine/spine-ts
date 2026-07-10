# Round 86 Fix Report

Timestamp: `2026-07-10T23:17:03Z`

## Findings

- Documentation: `docs/USER_GUIDE.md` says singular `replay` "pass"
  independent message snapshots; it should say `passes`.
- TypeScript/API docs: `docs/api/README.md` and `packages/server/README.md`
  overstate accepted-work accounting by saying cleanup/status-update failures
  do not increment `accepted`. The docs need to distinguish pre-callback
  failures from failures after callback invocation.
- Code style/maintainability: older Round 40, Round 41, Round 43, and Round 45
  fix reports still contain flush-left command continuations.
- Review-package hygiene: `.codex-review-packages/` remains stale untracked
  scratch. This is intentionally not removed because the handoff says to leave
  that directory untouched unless cleanup is explicitly requested.

## Changes

- Corrected the `docs/USER_GUIDE.md` production-gap summary so singular
  `replay` now `passes` independent message snapshots.
- Narrowed accepted-work accounting in `docs/api/README.md` and
  `packages/server/README.md`: only pre-callback claim, validation, lease, and
  status failures are documented as not incrementing accepted work; failures
  after endpoint callback invocation are documented as accepted work.
- Collapsed the remaining flush-left command continuations in the Round 40,
  Round 41, Round 42, Round 43, and Round 45 fix reports, plus adjacent Round
  44 and Round 45 commit-title continuations found during coordinator
  verification.
- Left `.codex-review-packages/` untouched per the handoff constraint.

## Verification

- `2026-07-10T23:33:21Z`: `pnpm --config.verify-deps-before-run=false
  docs:check` passed with only the existing invalid TypeDoc `origin` warning.
- `2026-07-10T23:33:21Z`: the targeted command-continuation search returned no
  matches.
- `2026-07-10T23:33:21Z`: `pnpm --config.verify-deps-before-run=false
  format:check` passed.
- `2026-07-10T23:33:21Z`: `git diff --check` passed.
- `2026-07-10T23:33:21Z`: generated/API reference diff checks returned no
  changed files.
