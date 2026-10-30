# M05 reliability review

Review returned read-only by app_query_m05_reliability, existing
performance_reliability_reviewer, explicit gpt-6-sol / medium. Runtime model
self-introspection is unavailable; no visible profile mismatch. Main transcribes
the returned finding. Base: 04464028350105a5653fc95b65842cfe17ef0bf7.

The human ledger and M05 contract were checked. The review covered exact
constructor selection, passive descriptions with no active instances, malformed
and conflicting metadata, current example import topology, and staged output
publication. No broad suites or production edits were performed.

## Finding

P2: packages/proto-tools/src/generation/handler-codegen.ts:138–144 publishes
spine-metadata.ts and spine-bootstrap.ts before validating/removing the retired
generated/handler/generated-handler-registry.ts. A symlink at the retired path
or a removal failure can make the operation throw after replacing the live
pair, contrary to failed-generation cleanup. Validate before publication and/or
include retirement in recoverable publication; add regressions proving failure
leaves the previous pair intact.

No further concrete M05 reliability finding. Transitive dependency discovery
and exports remain M06; rebuilt-image execution remains M14.

## Targeted confirmation

Resolved by the same explicit Sol/medium reviewer. Retired-path validation now
precedes writes, and removal participates in pair publication rollback. Both
prior outputs are restored after removal failure. Symlink and forced-removal
regressions cover the failure paths. No concrete remaining finding; no source
edits or broad suite reruns. Main transcribes the returned disposition.
