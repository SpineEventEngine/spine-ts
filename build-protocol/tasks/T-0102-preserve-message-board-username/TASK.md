# T-0102: Preserve Message Board username after posting

Status: Complete
Start: `2026-08-03`
Baseline: `b41f527c`
Branch: `task/T-0102-preserve-message-board-username`
Worktree: `.worktrees/T-0102-preserve-message-board-username`

Classification: Micro behavior fix. It changes one successful form transition in
the private Message Board example and adds focused React regression coverage;
it does not change a framework API, Proto contract, transport, persistence, or
deployment behavior.

## Objective

Keeps the username in the Message Board form after a successful post so the
same person can write another message without re-entering their name. The
message text still clears after success.

## Acceptance criteria

1. A successful post preserves the exact username currently entered.
2. A successful post clears the message textarea.
3. Existing failure, retry, board-change, and unmount behavior remains intact.
4. A focused React test is observed failing before the production correction,
   then passes afterward.
5. The task is reviewed, verified, merged into `main`, pushed, and its merged
   feature branch/worktree is removed.

## Verification and review

- TDD is mandatory: add the focused assertion and observe the expected RED
  failure before changing `post-form.tsx`.
- Run the Message Board React test file and bounded task verification.
- Style/maintainability reviews the form-state transition and regression test.
- Performance/reliability reviews success/failure/lifecycle state preservation.
- Documentation, TypeScript/API, and security are N/A unless scope expands.
