# T-0221 Work Log

Task log: `build-protocol/tasks/T-0221-lerna-publishing-migration/TASK.md`
Branch: `automated-publishing-and-packaging-improvements`
Worktree: `.worktrees/automated-publishing-and-packaging-improvements`
Baseline commit: `af5c897857a85b3736a9efd7490d47faef41b4ac`
Authoring sub-agent: existing `implementer` role, pending explicit dispatch
Implementation commit: Pending branch commit
Final branch HEAD: Pending branch commit

## Purpose

Record resumable migration from the custom NPM mutation engine to pinned Lerna
10.0.1 without public-registry mutation, PR creation, or any remote push.

## Entries

| Timestamp | Agent | Activity | Files/Commands | Result |
| --- | --- | --- | --- | --- |
| `2026-08-26 15:23 WEST` | Orchestrator | Framed high-risk task, acceptance, human ledger, skill gate, routing, and estimate | Task and planning records; repository/runtime/tool documentation | Ready for focused baseline and implementer dispatch; no production change or push |
| `2026-08-26 15:27 WEST` | Implementer | Qualified pinned Lerna against a disposable Verdaccio registry | Synthetic pnpm workspace; `pnpm dlx lerna@10.0.1 publish from-package --registry http://127.0.0.1:4873 --yes --concurrency 1 --ignore-scripts` | GREEN: private package excluded, public dependency published before dependent, detached/non-git checkout accepted; no public registry mutation |
| `2026-08-26 15:29 WEST` | Implementer | Recorded behavior-focused RED | `pnpm exec vitest run scripts/release-policy.test.mjs scripts/package-metadata.test.mjs scripts/release-workflows.test.mjs scripts/release-registry.test.mjs` | RED: static tag policy, custom workflow publisher, and registry preflight absent |
| `2026-08-26 15:34 WEST` | Implementer | Ran focused GREEN | Same focused suite plus `pnpm exec lerna --version` | GREEN: 35 tests passed; Lerna reports 10.0.1; no push or public publication |

## Current State

- Last completed step: Lerna qualification, policy/workflow cutover, and focused GREEN.
- Next step: stage-content validation and cheap preflight; no final release verification yet.
- Known risks: Lerna resume is version-based rather than integrity-based;
  static manifest tags must be removed; public NPM must never be contacted for
  mutation during tests.
- Open questions: None.

## Open Risks And Follow-Up Routing

| Risk/Follow-Up | Owner | Linked Task/Decision | Disposition | Next Review Point |
| --- | --- | --- | --- | --- |
| Local-registry qualification may expose a Lerna incompatibility | Implementer/orchestrator | T-0221 | Stop and report rather than invent a publisher | After qualification |
| Old custom engine cleanup | Future task | D-0117 pending | Deferred | After first real Lerna release |
