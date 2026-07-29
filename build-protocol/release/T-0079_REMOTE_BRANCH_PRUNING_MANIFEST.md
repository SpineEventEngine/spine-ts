# T-0079 Remote-Branch Pruning Manifest

## Status and scope

This manifest captured 83 pre-execution live `origin` heads. It froze the 81
deletion-target tips and `main` at their full 40-character SHAs (82 exact
tips). The active
`task/T-0079-remote-branch-pruning` retained head is deliberately not frozen:
committing this manifest advances that branch. At execution, verify that its
name exists and resolves live, rather than comparing it to a recorded tip.

Execution is complete. The 17 preservation tags were created and verified at
their mapped SHAs before deletion. An initial ambiguous
`git push --atomic --force-with-lease origin --delete …` attempt failed
atomically with no remote changes; a retry beginning
`git push --atomic --force-with-lease origin` and using fully qualified
`:refs/heads/<head>` deletions succeeded atomically for all 81 branches.
After fetch/prune, only `main` and T-0079 remain. Final review, merge, and the
eventual T-0079 branch deletion are outside this completed prune operation.

The manifest retains `main` and `task/T-0079-remote-branch-pruning`. Every
other pre-cleanup head was in the initial deletion set: 64 redundant branches
and 17 branches deleted after their exact preservation tags were verified.

## Executed procedure and deterministic verification guide

The recorded execution used this deterministic sequence. The commands name
this manifest rather than deriving deletion targets from a mutable branch
listing. Only the verification and restoration commands remain operational
guidance.

1. Confirmed the baseline inventory, exact `main` tip, and moving active head:

   ```sh
   git fetch --prune --tags origin
   git ls-remote --heads origin | awk '{ sub("refs/heads/", "", $2); print $2 }' | sort
   test "$(git rev-parse origin/main)" = 0fa0b39c14768abac26d466ba721f9c9297a56c3
   git rev-parse --verify origin/task/T-0079-remote-branch-pruning
   ```

2. Created and verified each lightweight preservation tag at its stated full
   SHA before deleting its source branch:

   ```sh
   git tag <tag> <full-40-character-tip>
   git push origin refs/tags/<tag>
   test "$(git ls-remote --tags origin "refs/tags/<tag>" | awk '{print $1}')" = "<full-40-character-tip>"
   ```

3. An ambiguous `git push --atomic --force-with-lease origin --delete …`
   attempt failed atomically; it made no remote change. The retry began
   `git push --atomic --force-with-lease origin`, used fully qualified deletion
   refspecs, and succeeded atomically for exactly the 81 manifest branches.
   `main` and T-0079 were excluded:

   ```sh
   git push --atomic --force-with-lease origin :refs/heads/<head> [:refs/heads/<head> ...]
   git fetch --prune origin
   ```

4. Verified that only the two retained **names** remain, that `main` still
   resolves to its listed exact tip, that all 17 tags resolve to their listed
   tips, and that the completed-task/integration deletion targets are ancestors
   of `origin/main` (the communication branch additionally had no unique patch
   by `git cherry`). T-0079 is name-only/live-tip verification because it moves
   as this task is committed:

   ```sh
   git ls-remote --heads origin refs/heads/main refs/heads/task/T-0079-remote-branch-pruning
   test "$(git rev-parse origin/main)" = 0fa0b39c14768abac26d466ba721f9c9297a56c3
   git rev-parse --verify origin/task/T-0079-remote-branch-pruning
   git ls-remote --tags origin 'archive/*'
   git merge-base --is-ancestor <redundant-tip> origin/main
   git cherry -v origin/main 384dd719da09f2792374cdd86cce24b0544b47e6
   ```

5. Verify the closed-world post-prune state. The committed
   [`T-0079_REMOTE_BRANCH_PRUNING_EXPECTED_REFS.tsv`](T-0079_REMOTE_BRANCH_PRUNING_EXPECTED_REFS.tsv)
   has the exact `main` SHA, exact two-head name set, and exact sorted
   17-archive-tag name/SHA set. Its active T-0079 row is deliberately
   `DYNAMIC`: the command requires one valid full live SHA. It uses only direct
   read-only remote queries, fails on any missing or extra head/archive-tag
   ref, and asserts both counts.

   ```sh
   set -eu
   expected=build-protocol/release/T-0079_REMOTE_BRANCH_PRUNING_EXPECTED_REFS.tsv
   scratch=$(mktemp -d "${TMPDIR:-/tmp}/t0079-remote-refs.XXXXXX")
   trap 'rm -rf "$scratch"' EXIT HUP INT TERM
   awk -F '\t' '$1 == "head" { print $2 }' "$expected" | LC_ALL=C sort > "$scratch/expected-head-names"
   git ls-remote --heads origin |
     awk '{ sub("^refs/heads/", "", $2); print $2 "\t" $1 }' | LC_ALL=C sort > "$scratch/live-heads"
   cut -f 1 "$scratch/live-heads" | LC_ALL=C sort > "$scratch/live-head-names"
   diff -u "$scratch/expected-head-names" "$scratch/live-head-names"
   test "$(wc -l < "$scratch/live-heads" | tr -d ' ')" = 2
   main_expected=$(awk -F '\t' '$1 == "head" && $2 == "main" { print $3 }' "$expected")
   main_live=$(awk -F '\t' '$1 == "main" { print $2 }' "$scratch/live-heads")
   test "$main_live" = "$main_expected"
   dynamic_name=$(awk -F '\t' '$1 == "head" && $3 == "DYNAMIC" { print $2 }' "$expected")
   test "$(awk -F '\t' '$1 == "head" && $3 == "DYNAMIC" { count++ } END { print count + 0 }' "$expected")" = 1
   dynamic_live=$(awk -F '\t' -v name="$dynamic_name" '$1 == name { print $2 }' "$scratch/live-heads")
   printf '%s\n' "$dynamic_live" | LC_ALL=C grep -Eq '^[0-9a-f]{40}$'
   awk -F '\t' '$1 == "tag" { print $2 "\t" $3 }' "$expected" | LC_ALL=C sort > "$scratch/expected-tags"
   git ls-remote --tags --refs origin 'refs/tags/archive/*' |
     awk '{ sub("^refs/tags/", "", $2); print $2 "\t" $1 }' | LC_ALL=C sort > "$scratch/live-tags"
   diff -u "$scratch/expected-tags" "$scratch/live-tags"
   test "$(wc -l < "$scratch/live-tags" | tr -d ' ')" = 17
   ```

## Restoration from a preservation tag

To restore an archived branch intentionally, first inspect it and then push a
new branch name from the exact remote tag. This does not rewrite or move the
tag.

```sh
git fetch --tags origin
git show --no-patch --format=fuller refs/tags/<tag>
git push origin refs/tags/<tag>:refs/heads/<restored-head>
```

For example, restoring the dirty-root preservation point under a distinct
branch name is:

```sh
git push origin refs/tags/archive/rescue/dirty-root-20260729:refs/heads/rescue/dirty-root-20260729-restored
```

## Preservation map (17 tags)

| Pre-cleanup head                                                        | Full tip                                   | Required lightweight tag                                                | Required tag tip                           |
| ----------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------ |
| `archive/legacy/T-0012-write-side-command-execution-foundation`         | `5dd57cbe3fa257e4e50b6ab4e93730a5a59ca861` | `archive/legacy/T-0012-write-side-command-execution-foundation`         | `5dd57cbe3fa257e4e50b6ab4e93730a5a59ca861` |
| `archive/legacy/T-0012a-minimal-command-post-enqueue`                   | `39f555386883facf725e7fbf8a08b8d77936c02d` | `archive/legacy/T-0012a-minimal-command-post-enqueue`                   | `39f555386883facf725e7fbf8a08b8d77936c02d` |
| `archive/legacy/T-0012b-command-routing-dispatch-outcome`               | `05594ef790dc109719567fc0adef6e5f94597fae` | `archive/legacy/T-0012b-command-routing-dispatch-outcome`               | `05594ef790dc109719567fc0adef6e5f94597fae` |
| `archive/legacy/T-0012c-aggregate-command-handler-invocation`           | `da8ae0cfef99bddc2d9f2f168cd780090edb966b` | `archive/legacy/T-0012c-aggregate-command-handler-invocation`           | `da8ae0cfef99bddc2d9f2f168cd780090edb966b` |
| `archive/legacy/T-0012d-aggregate-transaction-commit-event-application` | `2711d5e136d4453590299c54d11715e9b84c1542` | `archive/legacy/T-0012d-aggregate-transaction-commit-event-application` | `2711d5e136d4453590299c54d11715e9b84c1542` |
| `archive/legacy/T-0012e-event-production-rejection-normalization`       | `b3ceb051c75f2ce8f70e5c40f906d24185ead844` | `archive/legacy/T-0012e-event-production-rejection-normalization`       | `b3ceb051c75f2ce8f70e5c40f906d24185ead844` |
| `archive/legacy/T-0012f-event-publication-boundary`                     | `f73a0321ae6907a92731fde9a0b0da7cb1ee9c27` | `archive/legacy/T-0012f-event-publication-boundary`                     | `f73a0321ae6907a92731fde9a0b0da7cb1ee9c27` |
| `archive/legacy/T-0012g-storage-delivery-integration`                   | `6cf7f617327c2343fff1254cae82d6ed43565016` | `archive/legacy/T-0012g-storage-delivery-integration`                   | `6cf7f617327c2343fff1254cae82d6ed43565016` |
| `archive/legacy/T-0013-1-aggregate-state-store`                         | `d40c95a43bcdfeb1efc62e0e114ab8aa48a8ff7d` | `archive/legacy/T-0013-1-aggregate-state-store`                         | `d40c95a43bcdfeb1efc62e0e114ab8aa48a8ff7d` |
| `archive/legacy/T-0013-2-handler-contracts`                             | `6211502232414b7f72679900251fb7b7190333a1` | `archive/legacy/T-0013-2-handler-contracts`                             | `6211502232414b7f72679900251fb7b7190333a1` |
| `archive/legacy/T-0013-3-app-registry-gen`                              | `39da4ef954ffd043677be3bcc53ec708354b4a78` | `archive/legacy/T-0013-3-app-registry-gen`                              | `39da4ef954ffd043677be3bcc53ec708354b4a78` |
| `archive/legacy/T-0013-4-bare-decorators`                               | `57085ab711842fa1f10522158f041a2ecf375a88` | `archive/legacy/T-0013-4-bare-decorators`                               | `57085ab711842fa1f10522158f041a2ecf375a88` |
| `archive/legacy/T-0013-5-aggregate-cutover`                             | `dd560e001c028ce5a6b4ecda57d52d31660c0e65` | `archive/legacy/T-0013-5-aggregate-cutover`                             | `dd560e001c028ce5a6b4ecda57d52d31660c0e65` |
| `archive/legacy/T-0013-6-reactors-subscribers`                          | `714640ef7d784237aba431f3c6c25ea64765fd55` | `archive/legacy/T-0013-6-reactors-subscribers`                          | `714640ef7d784237aba431f3c6c25ea64765fd55` |
| `archive/legacy/T-0013-registry-and-aggregate-cutover`                  | `d210fae569883f2dda0fb0d61587bb97184b0dc5` | `archive/legacy/T-0013-registry-and-aggregate-cutover`                  | `d210fae569883f2dda0fb0d61587bb97184b0dc5` |
| `rescue/T-0048-planning-20260729`                                       | `cf608c7b4dadfa75cb1ea4631cdca8760e21c123` | `archive/rescue/T-0048-planning-20260729`                               | `cf608c7b4dadfa75cb1ea4631cdca8760e21c123` |
| `rescue/dirty-root-20260729`                                            | `def03a41dc187205ede71c1101afba05a7f603f4` | `archive/rescue/dirty-root-20260729`                                    | `def03a41dc187205ede71c1101afba05a7f603f4` |

## Retained heads (2)

| Head                                | Exact tip / execution verification                                                               | Disposition                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `main`                              | `0fa0b39c14768abac26d466ba721f9c9297a56c3`                                                       | Retain.                                                  |
| `task/T-0079-remote-branch-pruning` | Live moving head; verify that this name resolves at execution. The tip is deliberately unfrozen. | Retain until T-0079 is integrated, verified, and closed. |

## Executed initial deletion set (81 heads)

The `preservation-then-delete` rows were deleted only after the corresponding
tag row above had been pushed and verified. All tips are the full 40-character
pre-cleanup values.

| Head                                                                    | Full tip                                   | Disposition                                                           |
| ----------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| `archive/legacy/T-0012-write-side-command-execution-foundation`         | `5dd57cbe3fa257e4e50b6ab4e93730a5a59ca861` | preservation-then-delete                                              |
| `archive/legacy/T-0012a-minimal-command-post-enqueue`                   | `39f555386883facf725e7fbf8a08b8d77936c02d` | preservation-then-delete                                              |
| `archive/legacy/T-0012b-command-routing-dispatch-outcome`               | `05594ef790dc109719567fc0adef6e5f94597fae` | preservation-then-delete                                              |
| `archive/legacy/T-0012c-aggregate-command-handler-invocation`           | `da8ae0cfef99bddc2d9f2f168cd780090edb966b` | preservation-then-delete                                              |
| `archive/legacy/T-0012d-aggregate-transaction-commit-event-application` | `2711d5e136d4453590299c54d11715e9b84c1542` | preservation-then-delete                                              |
| `archive/legacy/T-0012e-event-production-rejection-normalization`       | `b3ceb051c75f2ce8f70e5c40f906d24185ead844` | preservation-then-delete                                              |
| `archive/legacy/T-0012f-event-publication-boundary`                     | `f73a0321ae6907a92731fde9a0b0da7cb1ee9c27` | preservation-then-delete                                              |
| `archive/legacy/T-0012g-storage-delivery-integration`                   | `6cf7f617327c2343fff1254cae82d6ed43565016` | preservation-then-delete                                              |
| `archive/legacy/T-0013-1-aggregate-state-store`                         | `d40c95a43bcdfeb1efc62e0e114ab8aa48a8ff7d` | preservation-then-delete                                              |
| `archive/legacy/T-0013-2-handler-contracts`                             | `6211502232414b7f72679900251fb7b7190333a1` | preservation-then-delete                                              |
| `archive/legacy/T-0013-3-app-registry-gen`                              | `39da4ef954ffd043677be3bcc53ec708354b4a78` | preservation-then-delete                                              |
| `archive/legacy/T-0013-4-bare-decorators`                               | `57085ab711842fa1f10522158f041a2ecf375a88` | preservation-then-delete                                              |
| `archive/legacy/T-0013-5-aggregate-cutover`                             | `dd560e001c028ce5a6b4ecda57d52d31660c0e65` | preservation-then-delete                                              |
| `archive/legacy/T-0013-6-reactors-subscribers`                          | `714640ef7d784237aba431f3c6c25ea64765fd55` | preservation-then-delete                                              |
| `archive/legacy/T-0013-registry-and-aggregate-cutover`                  | `d210fae569883f2dda0fb0d61587bb97184b0dc5` | preservation-then-delete                                              |
| `codex/communication-milestones`                                        | `384dd719da09f2792374cdd86cce24b0544b47e6` | delete; patch-equivalent to `main` (`git cherry` has no unique patch) |
| `integration/T-0074-wave4-browser-interoperability`                     | `f8a59883e71db0d9f9f0854039c313dbbce61801` | delete; ancestor of `main`                                            |
| `integration/T-0075-wave4-browser-interoperability`                     | `16d556b304820ae371be9be579adb2a13574a452` | delete; ancestor of `main`                                            |
| `rescue/T-0048-planning-20260729`                                       | `cf608c7b4dadfa75cb1ea4631cdca8760e21c123` | preservation-then-delete                                              |
| `rescue/dirty-root-20260729`                                            | `def03a41dc187205ede71c1101afba05a7f603f4` | preservation-then-delete                                              |
| `task/T-0037b-bounded-generation-run-coordinator`                       | `e224b23f70c415eb0ad1c260e942432d47f44590` | delete; ancestor of `main`                                            |
| `task/T-0037c-parked-delivery-obligations`                              | `cdad958193a1a1e93b5bedcf38674c1d59f6b019` | delete; ancestor of `main`                                            |
| `task/T-0037d-environment-attachment-startup`                           | `3e7d9b3e7dafb76584343e574e1e82d90019fadb` | delete; ancestor of `main`                                            |
| `task/T-0037e1-registration-detach-lifecycle`                           | `fe6915f478456b561d2b8319f3599800b881ab76` | delete; ancestor of `main`                                            |
| `task/T-0037e2-reusable-generation-stop`                                | `52b721c2b6999b149db1c2d4a5948f491b785282` | delete; ancestor of `main`                                            |
| `task/T-0037e3-permanent-environment-close`                             | `68d907bb3fe07114ed39d9056f72c8c9bd788628` | delete; ancestor of `main`                                            |
| `task/T-0037f-server-lifecycle-integration`                             | `eb344373d1b5bb102d872a0f031ebe5497da5bf7` | delete; ancestor of `main`                                            |
| `task/T-0038-accepted-capability-audit`                                 | `29db55b52ad08d595ef51f21597c0224414f43b3` | delete; ancestor of `main`                                            |
| `task/T-0038a-canonical-fallback-type-urls`                             | `76d4b684b3ca6592bf69f34ccba15da42891ee59` | delete; ancestor of `main`                                            |
| `task/T-0038b-context-transport-composition`                            | `48a56e714cea0fbfeaf343bb1d8a082605880909` | delete; ancestor of `main`                                            |
| `task/T-0039a-canonical-spec-status-reconciliation`                     | `7a0009417f1c3a83db0f3df8c6c56a1541a6b48e` | delete; ancestor of `main`                                            |
| `task/T-0039b-package-api-docs`                                         | `dea9a3625683fb7af79f854114cf12875b075280` | delete; ancestor of `main`                                            |
| `task/T-0039c-framework-user-guide`                                     | `2028ffb951f23f55b499d80446ce63778aafda06` | delete; ancestor of `main`                                            |
| `task/T-0040a-local-multi-process-todo-mode`                            | `35ce33f4f8661433ac5af08193754f4458f86060` | delete; ancestor of `main`                                            |
| `task/T-0040b-todo-black-box-acceptance`                                | `53881256d629f6693ead2b3f49a4a497938891c2` | delete; ancestor of `main`                                            |
| `task/T-0040c-todo-readme-user-guide-closure`                           | `c8398a0bc1876e1639e25fa2d63c711dd4987ec9` | delete; ancestor of `main`                                            |
| `task/T-0041-final-project-security-gate`                               | `7f042485f71cee9464185c24314dacb9964a7d22` | delete; ancestor of `main`                                            |
| `task/T-0042-release-readiness-project-closure`                         | `2a7e4652ae66116bc390879bd46fcad860508f14` | delete; ancestor of `main`                                            |
| `task/T-0043-zeromq-multipart-upstream-research`                        | `9038eb7787289466722291298797e7e376f76dcb` | delete; ancestor of `main`                                            |
| `task/T-0044-first-class-domain-rejections`                             | `e5147c3a0442b5f71c74c5bd3bdaa68947f7ea36` | delete; ancestor of `main`                                            |
| `task/T-0045-project-management-load-test`                              | `799bf715fd774e22533a3090e9a4aa071548ec55` | delete; ancestor of `main`                                            |
| `task/T-0046-storage-datastore`                                         | `cca9978eadb36b696d6f495a571c82ee287a4dd2` | delete; ancestor of `main`                                            |
| `task/T-0047-core-jvm-ts-extra-concepts-analysis`                       | `d7bb7aa41fe4993bf018e03a5cbd55e0294ee7a7` | delete; ancestor of `main`                                            |
| `task/T-0048-project-management-coverage`                               | `6262fe939815a43efed62a949faf95b64420cd1a` | delete; ancestor of `main`                                            |
| `task/T-0049-user-guide-datastore`                                      | `659a13f7c2157a50371af147f2112b12b3595ae9` | delete; ancestor of `main`                                            |
| `task/T-0050-convergent-review`                                         | `5564729d543d87defd8cc390c64554a07f25fa5f` | delete; ancestor of `main`                                            |
| `task/T-0051-storage-rdbms`                                             | `c4a0ba52ee7d63451148404851a3dab91ace79cb` | delete; ancestor of `main`                                            |
| `task/T-0052-jvm-feature-parity-wave-1`                                 | `6d2c4a11e3e300dddad8ea4a4f7eb427147da06f` | delete; ancestor of `main`                                            |
| `task/T-0053-frozen-protobuf-intake`                                    | `42e375e70ddad4e98056098203eb374bb8508db5` | delete; ancestor of `main`                                            |
| `task/T-0054-transactional-entity-update`                               | `0a22178b5170cf7e626d58ded6793775a4e35b03` | delete; ancestor of `main`                                            |
| `task/T-0055-server-environment-singleton`                              | `b374ac711d673e3616ca7ea1c586c10e7946e351` | delete; ancestor of `main`                                            |
| `task/T-0056-projection-column-model`                                   | `b01209dd12e926523d29fcf8fffe7666a72f06f1` | delete; ancestor of `main`                                            |
| `task/T-0057-projection-query`                                          | `f8c548210d3afa49bf04a3e921b4153612b0c3d6` | delete; ancestor of `main`                                            |
| `task/T-0058-client-facade`                                             | `a185a15de7d4a09ac1a54d88bd6b3f2551ece7ec` | delete; ancestor of `main`                                            |
| `task/T-0059-client-subscriptions`                                      | `1810e82b6c17ea94aca65c5709b074777ddedf07` | delete; ancestor of `main`                                            |
| `task/T-0060-postmerge-cleanup`                                         | `3f284a4a783cbdb390964a312b09d5facc00648c` | delete; ancestor of `main`                                            |
| `task/T-0060-runner-neutral-black-box`                                  | `f12562635985c6803aa8c8cee8619887498a8af6` | delete; ancestor of `main`                                            |
| `task/T-0061-public-delivery`                                           | `dee92556fa9bc27e779137286786dee4981d780b` | delete; ancestor of `main`                                            |
| `task/T-0062-delivery-client`                                           | `f2558ec51ef509ed2c0796655c7699c2608cac5e` | delete; ancestor of `main`                                            |
| `task/T-0063-delivery-scheduler-supervisor`                             | `1717d31932364d377667d08e8d1cc9083f784d17` | delete; ancestor of `main`                                            |
| `task/T-0064-in-memory-delivery-server`                                 | `96f7cc3137f62694367569fe9bf0a3e71ac415b6` | delete; ancestor of `main`                                            |
| `task/T-0065-delivery-server-lifecycle`                                 | `0acb149422d215f82a8c4c3983fd9c138d707785` | delete; ancestor of `main`                                            |
| `task/T-0066-multi-machine-delivery`                                    | `2ac308c4d3564120153dae9628a59bce23cf2d3e` | delete; ancestor of `main`                                            |
| `task/T-0066a-supervisor-empty-run-coalescing`                          | `d6a5921b7defac4b3c1733547beeda0c70f670bf` | delete; ancestor of `main`                                            |
| `task/T-0067-wave1-closure`                                             | `023234eed91358e82a7a246b59ec29656a451c97` | delete; ancestor of `main`                                            |
| `task/T-0067a-client-core-reference`                                    | `4341b359edee0f170fdf096f979ad8ec094bdd08` | delete; ancestor of `main`                                            |
| `task/T-0067b-dev-audit-refresh`                                        | `de4c8610dfe695e5914f38d65000f1b56143175a` | delete; ancestor of `main`                                            |
| `task/T-0068-wave2-planning`                                            | `c420b1bf2f437f73e51dd7010a316bfe83b4d570` | delete; ancestor of `main`                                            |
| `task/T-0069-package-namespace`                                         | `5dc6a4d13382891452a6fc1020c9b97ebe6e45ca` | delete; ancestor of `main`                                            |
| `task/T-0070-shared-history-storage`                                    | `56a8120313481f91133a73609a7895292ff891fb` | delete; ancestor of `main`                                            |
| `task/T-0070D-datastore-history-adapter`                                | `7e7dd1997d9f403e5dd6b1ec12ccb222762a8397` | delete; ancestor of `main`                                            |
| `task/T-0070R-lint-correction`                                          | `508c2787f985fa22f6b13e15ee375470e51faff7` | delete; ancestor of `main`                                            |
| `task/T-0070R-rdbms-history-adapter`                                    | `ef53215ed58168dd0b2684c401fd4cf5d3b39b81` | delete; ancestor of `main`                                            |
| `task/T-0071-repository-history-cutover`                                | `fd932c200045b0520f54163866709c88a60b7983` | delete; ancestor of `main`                                            |
| `task/T-0072-generic-entity-query`                                      | `608fb80ad3032ce61538158576e498a32b34125d` | delete; ancestor of `main`                                            |
| `task/T-0073-proto-model-tooling`                                       | `5240b44f78c817613e42c46d1407edf9688d4157` | delete; ancestor of `main`                                            |
| `task/T-0074-wave4-browser-interoperability-plan`                       | `482e8836b11fff969d2b24adbcb0d33eb3234d61` | delete; ancestor of `main`                                            |
| `task/T-0075-wave4-browser-interoperability`                            | `470cd41f3f3f15be4c8df5ba0dad7c01b452fa72` | delete; ancestor of `main`                                            |
| `task/T-0076-remove-superpowers-scratch`                                | `39e64841f54f08455fd22c92ddb349fee600f76e` | delete; ancestor of `main`                                            |
| `task/T-0077-dirty-worktree-recovery`                                   | `e6bdc0653a55c5c09a1af3742e74626b81c43217` | delete; ancestor of `main`                                            |
| `task/T-0078-completed-task-integration-audit`                          | `a4122d7df9a087a8042747091bc4776ccb99a587` | delete; ancestor of `main`                                            |

## Classification accounting

| Pre-cleanup category                |  Count | Executed disposition                                                                      |
| ----------------------------------- | -----: | ----------------------------------------------------------------------------------------- |
| Retained heads                      |      2 | `main` has an exact frozen tip; active T-0079 is retained and verified by live name only. |
| Redundant merged task heads         |     61 | Deleted after ancestry verification.                                                      |
| Redundant merged integration heads  |      2 | Deleted after ancestry verification.                                                      |
| Patch-equivalent communication head |      1 | Deleted after the recorded no-unique-patch check.                                         |
| Legacy preservation heads           |     15 | Tagged, verified, then deleted.                                                           |
| Rescue preservation heads           |      2 | Tagged, verified, then deleted.                                                           |
| Exact frozen tips                   |     82 | 81 deletion targets plus `main`; active T-0079 is deliberately unfrozen.                  |
| **Total pre-cleanup heads**         | **83** | **81 executed deletions; `main` and T-0079 retained.**                                    |
