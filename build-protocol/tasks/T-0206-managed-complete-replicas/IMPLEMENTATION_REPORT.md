# T-0206 implementation report

## Checkpoint A — process-count validation

- Branch/worktree: `codex/t0206-managed-replicas`, `/tmp/spine-ts-t0206`.
- Behavior: managed startup requires an explicit positive safe-integer
  `processCount`; no machine-derived default is available.
- Evidence: focused Vitest validation matrix is green (6 tests).
- TDD evidence: the same test matrix first failed with the public API absent.
- Limitation: this checkpoint deliberately does not yet start child processes.
