# T-0179R: Primary Worktree Recovery

Status: Complete; rescue work reconciled into `main`, remote cleanup ready

## Trigger

Before T-0179 integration on 2026-08-13, the primary checkout was found on
stale `main` commit `1c53cbdf` while `origin/main` was at `8ef4c066`. It also
contained six modified tracked files and four untracked files.

## Safety State

- Rescue commit `7735a00f` on
  `rescue/T-0179-primary-20260813` preserves the six tracked modifications and
  the two non-protected untracked files exactly as found.
- `human-review-1-jul.md` and `human-review-22-jul.md` are protected user-owned
  files. They were not read, copied, staged, moved, or committed.
- The primary checkout itself was not switched, reset, staged, or otherwise
  modified during rescue.

## Required Recovery

1. Classify the rescued paths as integrated, superseded, unique incomplete
   work, or user-owned material.
2. Reconcile only confirmed unique work through a reviewed task branch.
3. Synchronize the primary checkout with `origin/main` only when its protected
   working-tree state can be preserved without loss.
4. Remove the rescue worktree and branch only after recovery is complete and
   the human-owned files remain untouched.

This recovery task does not block Wave 11 integration through a separate clean
coordination worktree because the rescue state is durable on `origin` and the
primary checkout remains unchanged.

## Reconciliation

The recovery was completed after Wave 11 integration, before deleting the
rescue branch:

| Rescued path                                  | Disposition                                                                                                                                                                                          |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.wave8-forbidden-artifacts.json`             | Superseded by the committed removal of the one-time Wave 8 audit machinery; not restored.                                                                                                            |
| `README.md`                                   | The current root guide and dedicated deployment guides supersede this older root-level variant; its exact rescue version remains in merged history and is not restored to the published root README. |
| This recovery record                          | Retained and closed with the exact per-path dispositions.                                                                                                                                            |
| `docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md` | Current `main` already removes the obsolete binding-count claim and contains newer finite-limit guidance.                                                                                            |
| `docs/USER_GUIDE.md`                          | Current `main` already omits the obsolete browser `fingerprint` option and contains the newer beginner workflow.                                                                                     |
| `docs/api/README.md`                          | Current `main` already documents `StorageGroup`, the current record-family identity, and the absence of `RecordSpec.storageKey`.                                                                     |
| `packages/server/REFERENCE.md`                | Current `main` contains the newer one-Gateway durable-subscription design; the older lease/fence wording was not restored.                                                                           |
| `scripts/check-tsdoc.mjs`                     | Current `main` passes the TSDoc policy without broadening the accepted verb list; the exact rescue change remains in merged history and is not restored.                                             |
| `spine-rust-server-design-draft.md`           | Preserved byte-for-byte in the merged rescue parent, but omitted from the published root tree because it explicitly identifies itself as a disposable, unaccepted exploratory draft.                 |

The rescue branch is merged with ancestry rather than copied selectively, so
both rescue commits and every rescued blob remain reachable from `main` after
the remote branch is deleted, including files intentionally omitted from the
final published tree. Protected human files and the primary checkout remain
untouched.

## Orchestrator-Dispatched Scan

- Function: read-only rescue-branch path classification using the existing
  repository explorer role.
- Explicit profile: `gpt-5.6-luna`, medium reasoning.
- Runtime metadata limitation: the desktop surface exposes the configured
  immutable role/profile but no additional model-runtime telemetry.
- Result: the scan identified the unique README guidance, recovery record, and
  Rust draft, and independently confirmed the obsolete Wave 8 artifact and
  superseded server reference. Its documentation suggestions were checked
  against the newer current tree before acceptance.

## Verification

- The merge commit retains the rescue commits as parents, making every rescued
  commit and blob reachable from reconciled `main`.
- API inventory, documentation audience, TypeScript snippets, TSDoc,
  copyright, Prettier, generated-current output, and diff checks pass.
- Canonical generation verifies 47 source checks and 52 frozen descriptors at
  the accepted digest; the generated build passes.
- The remote rescue branch may be deleted only after the merge reaches
  `origin/main`; the terminal `git ls-remote --heads --tags origin` audit must
  then show only `refs/heads/main`.
