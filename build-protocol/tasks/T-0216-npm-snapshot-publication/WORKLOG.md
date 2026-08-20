# T-0216 Work Log

## Assignment gate

The Codex Desktop surface supports the repository's explicit child role, model,
and reasoning dispatch. The protected primary checkout is dirty and stale, so
all task work is isolated in `.worktrees/wave14-npm-publication` from exact
`origin/main@ea7ec5e8`.

| Assignment                    | Existing role                                      | Bounded ownership                                                                                                                                                        | Explicit model  | Explicit reasoning | Child spawning | Runtime telemetry                                                                                                   |
| ----------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- | ------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| Version sequence              | `implementer`                                      | Exact 26 manifest top-level version changes, standalone commits, immediate feature-branch pushes, and mechanical history audit only                                      | `gpt-5.6-terra` | medium             | Prohibited     | Explicit dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable.           |
| Publication policy            | `implementer`                                      | Internal pins, separate lockfile, 18 public manifests, package-policy TDD, and focused verification                                                                      | `gpt-5.6-terra` | medium             | Prohibited     | Explicit dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable.           |
| Artifact scan                 | orchestrator-dispatched mechanical verification    | Read-only analysis of existing pack/external-consumer seams, packed target and payload policy, and dependency graph                                                      | `gpt-5.6-luna`  | medium             | Prohibited     | Explicit dispatch is visible; child self-telemetry is unavailable.                                                  |
| Documentation scan            | orchestrator-dispatched documentation verification | Read-only inventory of stale publication claims and smallest exact snapshot installation correction                                                                      | `gpt-5.6-luna`  | medium             | Prohibited     | Explicit dispatch is visible; child self-telemetry is unavailable.                                                  |
| Artifact, docs, publisher     | `implementer`                                      | Permanent artifact validator/tests, all-18 isolated consumer proof, narrow docs/checker updates, and external disposable wrapper/instructions                            | `gpt-5.6-terra` | medium             | Prohibited     | Explicit dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable.           |
| Version-derived Proto records | `implementer`                                      | Regenerate only tracked Proto package manifests and paired generation-ID markers derived from the 26 workspace bumps; align the To-Do contract                           | `gpt-5.6-terra` | medium             | Prohibited     | Explicit follow-up dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable. |
| Review correction batch       | `implementer`                                      | Clean/source-trusted checkout, public-registry pinning, last-moment artifact integrity, safe consumer containment, React declaration dependency, and focused regressions | `gpt-5.6-terra` | medium             | Prohibited     | Explicit follow-up dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable. |

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

- Style/maintainability: accepted clean-checkout and integrity-mismatch-test findings; correction pending.
- Performance/reliability: accepted the deduplicated clean-checkout finding; correction pending.
- TypeScript/API documentation: accepted the missing React declaration dependency; correction pending.
- Documentation completeness: clean; no finding and no correction-lane impact.
- Security: accepted explicit-registry, pre-import source trust, last-moment integrity, and path-containment findings; correction pending.

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
- Authoring agent `/root/t0216_implement`, the existing `implementer` role with
  explicit `gpt-5.6-terra`/medium dispatch, completed the permanent publication
  policy, exact artifact validator, reusable all-18 pack/consumer proof,
  injectable publisher, reader docs, and the two external disposable files.
  Permanent implementation converged at `d5317979e`; every feature-branch
  commit was pushed immediately and local/remote refs match.
- The reusable artifact path packs exact tarball bytes, validates all 18
  archives, installs those bytes in a fresh non-workspace consumer, compiles
  TypeScript, imports all package roots, and executes the public testing/server
  reset path. The disposable publisher uses that same path before any optional
  registry mutation.
- The publisher defaults to preparation, requires explicit `--publish`, uses
  captured public-registry reads and inherited publish stdio, computes SHA-512
  integrity, skips only identical published artifacts, aborts mismatches, polls
  dependency visibility, and cleans temporary artifacts on normal, error, and
  signal exits without handling credentials.

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
- Fresh pre-review evidence at `d5317979e`: generated build/typecheck passed;
  focused ESLint passed; six focused suites passed 67/67; the combined
  publisher/artifact/consumer subset passed 17/17; formatting passed; docs
  audience and current generated-output checks passed; wrapper syntax and
  `git diff --check` passed. Clean-checkout release readiness passed with 87
  imports, 54 assets, and 404 Markdown links. The untracked planning directory
  was temporarily held outside the checkout for that reader scan and restored.
- Selected final verification profile: one `verify:release` after review
  convergence because dependencies, all public package artifacts, and shared
  release tooling changed. No earlier full release profile was used.
- The complete first specialist wave accepted six deduplicated corrections:
  reject untracked checkout state, pin npmjs mutation/read identity commands,
  establish wrapper source trust before imports, rehash tarballs immediately
  before publication, use path-aware consumer isolation, and supply the React
  declarations required by `client-react`. The existing Terra/medium
  implementation owner retains the correction context.
- The consolidated correction batch was pushed through `8e77e6aa0`. It pins
  registry commands, compares fresh tarball hashes with the prepared baseline
  before registry reads and again before publication, uses path-aware consumer
  containment with an adversarial regression, supplies React declarations, and
  establishes exact source/inventory trust before the external wrapper imports
  permanent modules. The wrapper remains external and rejected an untracked
  fixture before imports.
- Correction evidence: focused permanent suites pass 28/28; the new
  integrity/containment subset passes 15/15 with ESLint clean; the exact all-18
  tarball consumer passes 2/2 in 29.99 seconds; wrapper syntax passes; Git status
  contains only the preserved untracked planning directory.
- First affected re-review: TypeScript/API is clean and integrity/porcelain
  corrections are confirmed. Style, reliability, and security require one
  final narrow batch: Windows-separator containment, a real escaping-symlink
  regression, an executable embedded wrapper cleanliness fixture, and immutable
  reviewed-commit authentication before the wrapper installs or packs.
- Final style and reliability re-reviews are clean. Security found that Git
  status alone can trust configuration/index flags which conceal files. The
  accepted external-only correction forces untracked/ignored visibility and
  independently authenticates tracked worktree bytes and modes against the
  pinned commit tree, with an `assume-unchanged` fixture.
- The external-only authentication correction passes syntax and its embedded
  untracked/concealed-mutation fixture. Final security re-review is clean, as
  are all other relevant concern dispositions. No P0-P3 finding remains before
  final mechanical verification.
- The cheap preflight first exposed and then deterministically closed a missing
  `.mjs` tooling declaration, release-script line-length violations, and
  one-line TSDoc export summaries. After those commits, the complete preflight
  passed build/tooling, lint, documentation, generated/readiness gates, and six
  focused suites with 54/54 tests.
- The single full `pnpm verify:release` profile passed after convergence: 273
  test files passed with four skipped; 4,365 tests passed with 19 skipped;
  statement coverage is 93.47%, branch coverage 90.07%, function coverage
  93.02%, and line coverage 94.61%. Release readiness proved 87 imports, 54
  assets, and 404 relative Markdown links.
- Final mechanical audit proves all 26 required version commits have the exact
  message, one manifest, and one snapshot-1/snapshot-2 version-line pair. All 26
  tracked workspace manifests are snapshot.2; exactly 18 framework manifests
  are public; root plus seven examples are private; snapshot.1 pins are absent;
  validation remains snapshot.7; `git diff --check` passes. No NPM publication
  command ran.

## Implementation files

- All 26 workspace manifests and `pnpm-lock.yaml`.
- Five tracked Proto package manifests, their paired generated-root markers,
  and the existing To-Do manifest contract test.
- Package metadata, artifact, consumer, publisher, and release-readiness scripts
  and tests.
- Root/browser guidance plus the six package READMEs whose unpublished/private
  claims became false.
- External disposable publisher and instructions under
  `/Users/armiol/development/experiments/spine-ts-wave14-publication/`; neither
  path appears in Git status.
