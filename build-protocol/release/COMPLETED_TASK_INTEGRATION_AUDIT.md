# Completed-task integration audit

Audit date: 2026-07-29
Immutable source and ancestry baseline: `e6bdc0653a55c5c09a1af3742e74626b81c43217`

## Result

No accepted runtime behavior is missing from canonical `main`. Every completed
task with resolvable commit evidence is committed, pushed, and represented by
`origin/main`. This is an evidence ledger, not a replacement for the dated
task/work/review chronology.

## Reproducible task-record inventory

[`COMPLETED_TASK_INTEGRATION_INVENTORY.tsv`](COMPLETED_TASK_INTEGRATION_INVENTORY.tsv)
contains exactly one data row for each of the 172 qualifying task records. It
maps the task identifier, path, and parsed explicit top-level status evidence
to every resolved SHA-like source literal, its immutable-baseline ancestry
result, unresolved literals, and the applicable canonical/legacy
disposition. TSV fields escape backslashes, tabs, carriage returns, and
newlines. The preservation-only T-0077 rescue literal is intentionally
non-ancestral and is explicitly identified in its disposition as
non-integration evidence.

Regenerate and check the inventory from the audit worktree with:

```sh
node build-protocol/release/generate-completed-task-integration-inventory.mjs --check
test "$(($(wc -l < build-protocol/release/COMPLETED_TASK_INTEGRATION_INVENTORY.tsv) - 1))" = 172
awk -F '\t' 'NR > 1 { seen[$2]++; if (NF != 7 || $3 == "") bad++ } END { exit !(length(seen) == 172 && !bad) }' build-protocol/release/COMPLETED_TASK_INTEGRATION_INVENTORY.tsv
git diff --check
```

`--check` regenerates in memory and exits nonzero unless the checked-in TSV is
byte-identical. The generator reads every `TASK.md` blob and resolves full or
abbreviated SHA literals only from the immutable baseline's commit graph. It
selects only a top-level `Status: ...` or a top-level `## Status` followed by a
value, and only when that explicit field is a completion, acceptance, or done
status rather than superseded or abandoned. Its two fixed preservation refs are the only explicit exception to
baseline resolution; neither is completion integration evidence. The historical
722-token/708-resolved completion-evidence scan below remains the integration
proof; the TSV also retains non-completion literals so each source record is
independently inspectable.

| Evidence set                                       | Result                             | Disposition                                                                                                                        |
| -------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Explicit completed or accepted/done status records | 172                                | All included in the inventory.                                                                                                     |
| Extracted completion/integration identifiers       | 722                                | 708 resolve to repository commits; the other 14 are non-commit tokens or abbreviated non-resolutions.                              |
| Resolved identifiers                               | 708/708 ancestors of `origin/main` | No resolved completed-task implementation remains outside canonical history.                                                       |
| Completed remote task refs                         | 60/60 ancestors of `origin/main`   | Task endpoints are committed, pushed, and merged.                                                                                  |
| Remote integration refs                            | 2/2 ancestors of `origin/main`     | `integration/T-0074-wave4-browser-interoperability` and `integration/T-0075-wave4-browser-interoperability` are fully represented. |

`codex/communication-milestones` (`384dd719da09f2792374cdd86cce24b0544b47e6`)
is deliberately non-ancestral, but `git cherry` found no patch unique to it
relative to `main`; its communication changes are patch-equivalent to
canonical history.

## Modern task coverage

| Range                     | Canonical evidence                                                                                                                                                              | Result                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| T-0045–T-0051             | Remote task tips are ancestors; T-0045 `799bf715`, T-0046 `cca9978e`, T-0047 `d7bb7aa4`, T-0048 `6262fe93`, T-0049 `659a13f7`, T-0050 `5564729d`, T-0051 `c4a0ba52`             | Committed and pushed.                                         |
| T-0052–T-0067b (Wave 1)   | Wave closure `023234ee`; task tips including `0a22178b`, `f8c54821`, `a185a15d`, `f1256263`, `dee92556`, `f2558ec5`, `1717d319`, `96f7cc31`, `0acb1494`, `d6a5921b`, `2ac308c4` | Committed, integrated, and later task closures are on `main`. |
| T-0068–T-0072 (Wave 2)    | `82510418`, `993aa4be`, `7e7dd199`, `dd6f5fac`, `fd932c20`, `608fb80a`; integration/verification corrections also ancestral                                                     | Committed and pushed; Wave 2 closure is canonical.            |
| T-0073–T-0075 (Waves 3–4) | `5240b44f`, `8a627719`, `470cd41f`, `77105890`                                                                                                                                  | Committed, merged, post-merge verified, and pushed.           |
| T-0076–T-0077             | T-0077 tip and `origin/main` both `e6bdc065`                                                                                                                                    | Cleanup/recovery is committed and pushed.                     |

## Historical rescue branches and post-pruning tag preservation

At this audit's 2026-07-29 baseline, the following names were remote branches.
T-0079 preserved them under the exact tags recorded in
[`T-0079_REMOTE_BRANCH_PRUNING_MANIFEST.md`](T-0079_REMOTE_BRANCH_PRUNING_MANIFEST.md).
The tags were pushed and verified before the historical branches were deleted
as part of the successful atomic 81-branch prune. The branch column remains
historical baseline evidence; the tag column is the current preservation ref.

| Item                               | Historical branch / exact tip                                                  | Current preservation tag                                  | Disposition                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Root dirty-worktree snapshot       | `rescue/dirty-root-20260729` / `def03a41dc187205ede71c1101afba05a7f603f4`      | `archive/rescue/dirty-root-20260729` at the same SHA      | Preservation-only snapshot; the source changes were already integrated or superseded, not missing product work. |
| T-0048 planning/review artifacts   | `rescue/T-0048-planning-20260729` / `cf608c7b4dadfa75cb1ea4631cdca8760e21c123` | `archive/rescue/T-0048-planning-20260729` at the same SHA | 16 unique planning/review artifacts do not belong on product `main`.                                            |
| T-0066 and T-0067 worktrees        | executable-bit-only changes                                                    | N/A                                                       | No source behavior to integrate.                                                                                |
| T-0012-11b worktree                | deletions                                                                      | N/A                                                       | Later canonical history already represents the removals.                                                        |
| Recurring `.superpowers` deletions | intentional cleanup                                                            | N/A                                                       | Closed by T-0076; no product behavior removed.                                                                  |

No dirty historical worktree contained a unique uncommitted source blob. The
two protected human-review files were not read, altered, staged, or used as
audit input.

## T-0012/T-0013 capability crosswalk

T-0012 is explicitly abandoned by the current build protocol. T-0013 is
superseded: its parent never closed, while its completed slices were replaced
by later accepted architecture. The crosswalk identifies the later canonical
implementation rather than merging obsolete branch topology.

| Legacy capability                                                       | Canonical commit                                                                       | Canonical files proving the current capability                                                                                                          |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-0012a/b command posting and routing                                   | `0066de5a2583281f577212776e3d89094b1ee06f`, `3781937c47f08defcb7c7be904df79a0bc861f6b` | `packages/server/src/bus/command-bus.ts`, `packages/server/src/bus/command-dispatcher.ts`, `packages/server/src/bus/command-dispatcher-registry.ts`     |
| T-0012c/d aggregate command handling and transactional event production | `243390e3aa2d4e55db352fe3cfd312a87c0a4c7e`, `e8e4ff177c32a3f7266a376ecf0f441d80f303c0` | `packages/server/src/repository/repository.ts`, `packages/server/src/repository/command-errors.ts`                                                      |
| T-0012e/f rejection normalization and publication boundary              | `de233a9006d64ba20eaf15f2d30ec92b685f572c`, `f3ebd21e49cbfe0c3570811b3f3a0d873f8c821a` | `packages/server/src/bus/command-errors.ts`, `packages/server/src/bus/event-dispatcher-registry.ts`, `packages/server/src/repository/command-errors.ts` |
| T-0012g storage/delivery integration                                    | `d2a6bd7c21622940e8f98992dfaf8e8daeb51ad6`, `fd932c200045b0520f54163866709c88a60b7983` | `packages/server/src/delivery/delivery-builder.ts`, `packages/server/src/repository/repository.ts`                                                      |
| T-0013.1 aggregate state/history storage                                | `993aa4be9561a5e7db7961a9386966f402738499`, `fd932c200045b0520f54163866709c88a60b7983` | `packages/storage/src/entity/entity-history-storage.ts`, `packages/server/src/repository/repository.ts`                                                 |
| T-0013.2 handler contracts                                              | `8f8efcd96be4d24f1fff175af4bf609efe879d6c`, `d07e0a3fb7af8b178c7b821c8efa3761d3f8a4a5` | `packages/server/src/handler/handler-metadata.ts`, `packages/server/src/handler/command-registration-readiness.ts`                                      |
| T-0013.3 generated application registry                                 | `8f8efcd96be4d24f1fff175af4bf609efe879d6c`, `5240b44f78c817613e42c46d1407edf9688d4157` | `packages/server/src/handler/generated-handler-registry.ts`, `packages/proto-tools/src/generation/handler-generator.ts`                                 |
| T-0013.4 bare decorators                                                | `0066de5a2583281f577212776e3d89094b1ee06f`, `8f8efcd96be4d24f1fff175af4bf609efe879d6c` | `packages/server/src/handler/handler-decorators.ts`, `packages/server/src/handler/handler-metadata.ts`                                                  |
| T-0013.5 aggregate cutover                                              | `e8e4ff177c32a3f7266a376ecf0f441d80f303c0`, `fd932c200045b0520f54163866709c88a60b7983` | `packages/server/src/repository/repository.ts`, `packages/storage/src/entity/entity-history-storage.ts`                                                 |
| T-0013.6 reactors/subscribers                                           | `52e287f9e623c6dc6adadc68aa9e3d07478c3704`, `f3ebd21e49cbfe0c3570811b3f3a0d873f8c821a` | `packages/server/src/bus/event-dispatcher-registry.ts`, `packages/server/src/bus/command-bus.ts`                                                        |

The legacy `@Apply`/event-replay design is intentionally superseded. Its
absence is not a missing capability.

## Historical legacy branches and post-pruning tag preservation

The table records the 15 historical remote branch names and their immutable
baseline tips. After T-0079 execution, the same names exist under
`refs/tags/` (for example, `refs/tags/archive/legacy/T-0012a-minimal-command-post-enqueue`),
not `refs/heads/`. Those preservation tags are explicitly non-active and must
not be merged, cherry-picked, or rebased into `main`.

| Historical branch / planned tag name                                    | Exact tip                                  |
| ----------------------------------------------------------------------- | ------------------------------------------ |
| `archive/legacy/T-0012-write-side-command-execution-foundation`         | `5dd57cbe3fa257e4e50b6ab4e93730a5a59ca861` |
| `archive/legacy/T-0012a-minimal-command-post-enqueue`                   | `39f555386883facf725e7fbf8a08b8d77936c02d` |
| `archive/legacy/T-0012b-command-routing-dispatch-outcome`               | `05594ef790dc109719567fc0adef6e5f94597fae` |
| `archive/legacy/T-0012c-aggregate-command-handler-invocation`           | `da8ae0cfef99bddc2d9f2f168cd780090edb966b` |
| `archive/legacy/T-0012d-aggregate-transaction-commit-event-application` | `2711d5e136d4453590299c54d11715e9b84c1542` |
| `archive/legacy/T-0012e-event-production-rejection-normalization`       | `b3ceb051c75f2ce8f70e5c40f906d24185ead844` |
| `archive/legacy/T-0012f-event-publication-boundary`                     | `f73a0321ae6907a92731fde9a0b0da7cb1ee9c27` |
| `archive/legacy/T-0012g-storage-delivery-integration`                   | `6cf7f617327c2343fff1254cae82d6ed43565016` |
| `archive/legacy/T-0013-registry-and-aggregate-cutover`                  | `d210fae569883f2dda0fb0d61587bb97184b0dc5` |
| `archive/legacy/T-0013-1-aggregate-state-store`                         | `d40c95a43bcdfeb1efc62e0e114ab8aa48a8ff7d` |
| `archive/legacy/T-0013-2-handler-contracts`                             | `6211502232414b7f72679900251fb7b7190333a1` |
| `archive/legacy/T-0013-3-app-registry-gen`                              | `39da4ef954ffd043677be3bcc53ec708354b4a78` |
| `archive/legacy/T-0013-4-bare-decorators`                               | `57085ab711842fa1f10522158f041a2ecf375a88` |
| `archive/legacy/T-0013-5-aggregate-cutover`                             | `dd560e001c028ce5a6b4ecda57d52d31660c0e65` |
| `archive/legacy/T-0013-6-reactors-subscribers`                          | `714640ef7d784237aba431f3c6c25ea64765fd55` |

## Verification limits

This is a repository-history audit. At the captured baseline, a direct
`git ls-remote origin` query verified `main`, the then-active T-0078 branch,
both rescue **branches**, and all 15 `archive/legacy/*` **branches** at their
recorded SHAs. T-0079 then verified all 17 replacement tags at their mapped
SHAs and exactly two remaining heads (`main` and active T-0079) after the
successful atomic prune. The audit does not verify
hosting-provider retention policy or rerun application behavior. The result
therefore establishes no missing committed/integrated behavior, not a fresh
runtime release certification.
