# T-0216 Work Log

## Assignment gate

The Codex Desktop surface supports the repository's explicit child role, model,
and reasoning dispatch. The protected primary checkout is dirty and stale, so
all task work is isolated in `.worktrees/wave14-npm-publication` from exact
`origin/main@ea7ec5e8`.

| Assignment                    | Existing role                                      | Bounded ownership                                                                                                                              | Explicit model  | Explicit reasoning | Child spawning | Runtime telemetry                                                                                                   |
| ----------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| Version sequence              | `implementer`                                      | Exact 26 manifest top-level version changes, standalone commits, immediate feature-branch pushes, and mechanical history audit only            | `gpt-5.6-terra` | medium             | Prohibited     | Explicit dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable.           |
| Publication policy            | `implementer`                                      | Internal pins, separate lockfile, 18 public manifests, package-policy TDD, and focused verification                                            | `gpt-5.6-terra` | medium             | Prohibited     | Explicit dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable.           |
| Artifact scan                 | orchestrator-dispatched mechanical verification    | Read-only analysis of existing pack/external-consumer seams, packed target and payload policy, and dependency graph                            | `gpt-5.6-luna`  | medium             | Prohibited     | Explicit dispatch is visible; child self-telemetry is unavailable.                                                  |
| Documentation scan            | orchestrator-dispatched documentation verification | Read-only inventory of stale publication claims and smallest exact snapshot installation correction                                            | `gpt-5.6-luna`  | medium             | Prohibited     | Explicit dispatch is visible; child self-telemetry is unavailable.                                                  |
| Artifact, docs, publisher     | `implementer`                                      | Permanent artifact validator/tests, all-18 isolated consumer proof, narrow docs/checker updates, and external disposable wrapper/instructions  | `gpt-5.6-terra` | medium             | Prohibited     | Explicit dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable.           |
| Version-derived Proto records | `implementer`                                      | Regenerate only tracked Proto package manifests and paired generation-ID markers derived from the 26 workspace bumps; align the To-Do contract | `gpt-5.6-terra` | medium             | Prohibited     | Explicit follow-up dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable. |

## Skill applicability

- Sources checked: the session skill inventory, `build-protocol/skills/EXPECTED_SKILLS.md`,
  the complete `~/.agents/skills/*/SKILL.md` entrypoint listing, and
  `~/.agents/.skill-lock.json`.
- Selected and fully read by the orchestrator: `implement`, `tdd`,
  `planning-with-files`, `using-git-worktrees`, and `codebase-design`.
- `requesting-code-review` and `verification-before-completion` are selected for
  their later review/completion gates and will be fully read before those actions.
- `security-best-practices` is selected for the explicitly requested credential-
  handling review and will be fully read before that review.
- Architecture/domain/backend/advanced-types skills are N/A: this fast slice
  introduces no runtime subsystem, domain model, backend behavior, or complex
  public TypeScript type contract.
- The project protocol overrides advisory skill text where the generic worktree
  skill asks to run a baseline full suite: recent verified main evidence and the
  protocol require focused preflight and one final release gate instead.

## Canonical concern dispositions

- Style/maintainability: pending relevant review after mechanical convergence.
- Performance/reliability: pending publisher interruption/resumption and cleanup review.
- TypeScript/API documentation: pending artifact contract and package documentation review.
- Documentation completeness: pending reader-claim review.
- Security: pending final release-readiness review because publishing is credential-adjacent.

## Progress

- Task classified high-risk without a deep-planning dispatch because the human
  supplied exact acceptance criteria, inventory, commit contract, publication
  order, and non-goals.
- Primary dirty checkout preserved untouched; isolated feature worktree created
  at the exact planning baseline.
- The explicitly dispatched version owner completed all 26 required commits in
  the prescribed order from `e615ccd85` through `a3194128d`; every commit was
  pushed immediately. Its fresh audit proves exact messages, one required
  manifest per commit, one insertion/one deletion, only the top-level version
  line, and all 26 final versions at `2.0.0-snapshot.2`. Local and feature remote
  both resolve to `a3194128d`.
- The same explicit Terra/medium owner completed policy TDD and pushed every
  commit immediately: RED policy test `4ee344bef`, 18-package metadata
  `a8335dbc5`, 47 concrete internal pins `8cc8e0703` (40 dependencies and seven
  devDependencies), and lockfile-only update `f355aceaf`. The validation package
  remains `2.0.0-snapshot.7`, every `workspace:*` remains unchanged, and no
  snapshot-1 manifest pin remains.
- Fresh-checkout installation was independently reproduced with Node 24.18.0
  and pnpm 11.9.0: `pnpm install --frozen-lockfile --offline` installed all 455
  locked packages without resolving unpublished snapshots from the registry.
  The worktree-local package metadata test passes 12/12.
- The explicit Luna/medium artifact scan accepted the existing
  `packages/proto-tools/test/external-consumer.test.ts` seam and requires it to
  generalize from eight to all 18 tarballs, validate archive targets/payloads,
  compute a cycle-safe dependency order from final packed manifests, and retain
  the no-symlink/no-repository-path external consumer proof.
- The explicit Luna/medium documentation scan found stale publication claims in
  the root README, browser/auth guide, core/proto/storage/storage-datastore/
  storage-rdbms READMEs, and deployment README. It also found the existing
  release-readiness registry-install prohibition must narrowly allow exact
  snapshot or `@snapshot` examples while continuing to reject unqualified
  installs.

## Verification notes

- The first scoped formatting command used an unsupported path argument and
  exited with usage text. The supported full formatter then identified only
  this new work log; no product or package file failed formatting.
- The first real all-package build exposed a required version-derived mismatch:
  tracked `spine-proto-manifest.json` files and the To-Do manifest contract still
  named snapshot.1 after their owning workspace manifests became snapshot.2.
  This is not broader compiler/tooling work; the existing generator remains
  authoritative and the same implementer owns only regeneration plus the stale
  test expectation before resuming artifact proof.
- The first installed all-18 consumer proved each regenerated manifest's
  `generationId` must move with its paired tracked generated-root marker. The
  earlier manifest-only constraint correctly caused the implementer to restore
  those files. Ownership now explicitly includes exactly the five paired marker
  files; generated TypeScript and generator behavior remain out of scope.
