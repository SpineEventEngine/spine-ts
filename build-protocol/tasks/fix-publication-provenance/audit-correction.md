# Release audit correction

The first final verify:publish run built successfully and passed 306 files and
5,133 tests. Coverage: statements 93.26%, branches 90.03%, functions 93.04%,
lines 94.45%. Its subsequent dependency audit failed on @grpc/grpc-js 1.14.4.
The archive proof and real-library regression were not run after that failure.

The two upstream advisories are
[GHSA-m9gg-hp2v-232j](https://github.com/grpc/grpc-node/security/advisories/GHSA-m9gg-hp2v-232j)
and
[GHSA-f596-whhp-79r4](https://github.com/grpc/grpc-node/security/advisories/GHSA-f596-whhp-79r4).
Both identify 1.14.5 as patched. The public npm registry identifies that version
as latest, published 2026-09-17T19:47:01.706Z, compatible with Node >=12.10.0 and
using the same proto-loader/ordered-map dependency families. No release-age
exception or advisory suppression is needed.

Return the smallest compatible dependency update to the existing implementer
(explicit Sol/medium, standard tier, memories and child agents disabled).
Prefer a targeted transitive lockfile update if supported; otherwise a bounded
version override. Do not update unrelated dependencies, change framework code,
change common snapshot.19, or weaken audit policy. Frozen install, both audits,
relevant package metadata and Datastore/deployment focused tests, tooling
typecheck and changed-file preflight must pass. No full build, commit, push,
publication, or workflow rerun by the implementer.

Main will review the exact dependency change, run the skipped real-library
regression and archive proof, update records, commit and push. The final-commit
PR workflow runs both audits and the full verify:release profile, providing the
next full verification of the corrected tree. The first full run is not claimed
to cover the updated dependency. This avoids duplicating the same expensive
profile locally and on CI. Required exact-final-SHA CI remains the acceptance
gate. Estimated remaining elapsed time is 0.3–0.5 hours, mostly verification and
CI waiting; no real publication is authorized.

Main caught another side effect of pnpm's update command: 20 package/example
manifests changed exact proto/proto-tools snapshot.19 pins to workspace:* and
reordered dependencies. These manifests were clean against HEAD immediately
before this correction; restore only these newly introduced manifest changes
from HEAD with apply_patch. Root package.json must retain Lerna removal. The
pre-correction lockfile had 37 added and 3,144 removed lines versus HEAD, with no
new package versions. Restore unrelated resolutions as well as manifest pins;
do not use the modified manifests as the desired baseline. Add only the verified
grpc 1.14.5 entries/integrity and allow normal orphan pruning from Lerna removal.
No release-age exception is needed. Run release-policy and metadata tests too.
