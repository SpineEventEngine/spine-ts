# T-0087: Message Board live status and keyboard posting

Status: Complete
Start: `2026-08-01`
Baseline: `1a0e343a67e1c88c6a8d364d8001c380f1570d99`
Branch: `task/T-0087-message-board-live-status`
Worktree: `.worktrees/T-0087-message-board-live-status`

Classification: Standard. The task changes bounded example UI behavior,
keyboard interaction, tests, and current example documentation. It does not
change a public framework API, serialized contract, persistence, security, or
shared runtime lifecycle.

## Objective

Makes the Message Board heading and live-update status accurate, removes the
redundant board name and disconnected alert, and lets keyboard users post from
the message textarea with the platform command modifier plus Enter. Diagnoses
and documents why command posting remains available when subscription updates
are disconnected.

## Human-Imposed Requirements Ledger

1. The page title is `Message Board`.
2. The `#general` fragment is removed.
3. The live badge says `Updating live` only while subscription updates are
   connected, retaining the blue treatment.
4. When subscription updates are not connected, the badge says
   `No live updates`, uses a suitable icon, and uses gray on dark gray.
5. The separate `Message updates disconnected.` message is removed.
6. Command+Enter posts while focus is in the message textarea on macOS.
7. Control+Enter posts while focus is in the message textarea on Windows.
8. A shortcut hint appears beside the `Message` label.
9. The reported disconnect-with-working-posts behavior is explained from
   verified application behavior rather than assumption.
10. Preserve accessibility, current server-derived validation behavior,
    oldest-first message ordering, relative time, and post-success refresh.
11. Commit and push every feature-branch commit immediately; merge and push
    only after review and verification.
12. Do not touch the protected `human-review` files or build Spine JVM.

## Implementation Dispatch

- Existing role: `implementer`.
- Ownership: the complete T-0087 worktree as the only production-code writer,
  including Message Board web UI, focused tests, and affected example docs.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: medium.
- Both fields must be explicit. The owner must not spawn children, commit,
  push, build Spine JVM, or touch protected files.

## Skill Applicability

- Inventory sources: current session inventory; bounded
  `/Users/armiol/.agents/skills` enumeration; repository expected-skill
  manifest; `/Users/armiol/.agents/.skill-lock.json`.
- Selected: `using-git-worktrees`, `implement`,
  `test-driven-development`, `systematic-debugging`, `webapp-testing`, and
  `accessibility`. They govern isolation, test-first behavior, evidence-based
  diagnosis, real-browser acceptance, and keyboard/status accessibility.
- The browser-control skill was inspected for the ambient in-app tab, but the
  user did not explicitly choose that browser. Repository-native browser tests
  and process/network evidence are preferred for repeatable diagnosis.
- Deep planning and architecture skills are not selected because no framework
  or serialized contract changes and no architectural blocker are present.
- Library search is N/A: the requested UI behavior uses the existing React,
  Lucide, Shadcn-style, and test dependencies; no infrastructure or dependency
  addition is needed.

## Verification Profile

- Selected final profile: `verify:task`, because the change is confined to one
  example web package and its documentation.
- Cheap preflight: focused RED/GREEN component tests, affected-package
  typecheck/build/lint, deterministic documentation checks, formatting,
  `git diff --check`, changed-branch coverage inspection, and real browser
  acceptance against the local server and UI.

## Integration

- Reviewed feature endpoint: `54bb94f0da52bc8a68a3b2e3f6fe36d545efd7c8`.
- Integration merge: `b9e3fdf571bcfe7280c0a4d5783e43272a9bf352`.
- The merged tree and verified task tree share exact tree hash
  `07d4afd3b3e3ed46da48290c2b58f9f033ec2450`.
- Post-merge verification passed 29 focused tests plus real Chromium, Firefox,
  and WebKit acceptance.
- The feature endpoint and merge were pushed to `origin`; this closure record
  is pushed in its containing `main` commit.
