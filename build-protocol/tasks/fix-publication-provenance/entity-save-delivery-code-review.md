# Entity storage and delivery implementation review

Scope: the approved extension after `74c6b5615f1195861ffb7570652be7bff1759a95`,
including its immediate affected paths. Earlier publishing changes retain their
separate review evidence. No publication or merge is authorized.

All assignments use fresh contexts without chat history or memory, Standard
speed, explicit model and reasoning, and no child agents. The Desktop CLI
supports the required explicit profiles; actual runtime metadata is not exposed.
Acceptance requires checking the dispatched fields and any reported fallback.

## Documentation review

Assigned existing documentation reviewer: Luna/medium. Read-only review of the
changed human-facing storage/server/delivery reference pages, API and architecture
guides, changed technical specification and decision text. Check correctness,
simple wording, compatibility consequences and misleading atomicity or performance
claims against current source. Runtime follow-up and its TSDoc remain with the
implementer and later API review; do not review moving performance reports as
completed evidence. Return concrete findings with source references, not edits.

Completed with explicit Luna/medium dispatch, memories/children disabled; no
fallback reported. One accepted low-severity finding at storage/REFERENCE.md:18:
replace the generic phrase “atomic commit contracts” with “Entity commit
contracts”, because MyISAM/Aria can leave ordered partial writes. The reviewer
confirmed the conflict/version distinction, provider compatibility notice,
Datastore transaction statement, scan behavior, and clock/dedup limits.
Correction is queued until the complete review wave is collected. Full report:
`/tmp/entity-delivery-doc-review.md`.

## Remaining concerns

- Performance/reliability: explicit Sol/medium read-only assignment starts on
  the stable provider commits and Inbox scan/retention paths. Their focused
  checks passed; current CI corrections in these paths are lint-only. Exclude
  active repository/Stand preparation and any later memory equality change;
  those require the concluding reliability review before acceptance. Inspect
  the known Datastore trim timeout as a verification limitation, not a passed
  test. No full suite, edits or child agents.
- TypeScript/public API: required; includes preserving `SpecScanner.scan` and the
  changed provider-only Entity commit port. Check the exported `DeliveryInbox`
  interface and its optional retention-clock method against the compatibility
  wording; do not assume a port is private merely from its filename.
  Assigned fresh read-only existing API reviewer, explicit Sol/medium, after
  all-changed-file lint/format and the 411-test focused coverage gate passed.
  Review runtime/type agreement and prepared-record reuse as it now stands;
  later canonical-key encoding is internal and outside this active assignment.
- Style/maintainability: required for the changed production paths.
- Dedicated security: not reopened by this storage-performance extension, which
  adds no authentication, external input surface, credentials or publication
  authority. Existing final publishing security evidence remains applicable;
  tenant boundaries and mutation checks receive reliability review.

Collect the complete applicable review wave before returning one accepted fix
batch to the existing implementation context. Review results and dispositions
will be added below; none is yet accepted as clean.

## Storage and Inbox reliability result

Completed with explicit Sol/medium, fresh ephemeral context, Standard tier,
memories/children disabled, with no fallback reported. Accepted medium-severity
finding: forward scanning can delete a full page's last expired delivered row,
then `RemoteValues.exactAfter` rejects the now-absent cursor. The old productive
page restart avoided this combination. Add a remote drain regression with a
productive full page ending in an expired row, and correct continuation without
skipping messages at equal timestamps or weakening existing paging checks.
The report is `/tmp/entity-storage-reliability-review.md`.

The reviewer found the other assigned memory/provider and Inbox invariants
intact. It explicitly retained the Datastore trim timeout and unmet one-second
target as limitations, not successful verification. Repository/Stand prepared
record reuse and any later equality changes remain outside this completed
portion and require review. The accepted correction is queued for the combined
review-fix batch.
