# Exact archive consumer correction

The real npm/Sigstore reproduction passed. `release-cli prepare --check` then
failed because `proveExactTarballConsumer` hardcodes `pnpm install --offline`.
Fresh resolution selected pg-protocol 1.16.1 through the archived PostgreSQL
package's @types/pg dependency, but that tarball was absent from the local pnpm
store. The same cache assumption can fail in CI. There is no supported online
switch. This is a verifier defect, not evidence that the package archives failed
to typecheck or run; those steps were not reached.

The existing Sol/medium implementer must make the release consumer installation
use normal network-enabled pnpm installation with scripts still disabled. Every
framework package must still resolve to the exact prepared local archives;
preserve archive identity, isolation checks, compiler run, HTTP smoke check and
cleanup. Do not warm a particular cache entry as the fix, alter published package
dependencies, bypass supply-chain checks, or re-run a full build. Preserve the
grpc lockfile correction and all prior work.

The affected method is above today's size limit as unchanged baseline. Since
it now changes, split it into a few clear, documented operations within 35
physical lines. Keep the existing consumer program and semantics, not a new
abstraction or public API. Scope only the exact-all-package consumer used by the
release command; the separate native-only proof is unchanged in this task.
Add a focused regression for the installation command and exact archive inputs.
Run affected tests and cheap preflight. Main handles runbook/records, targeted
review of changed preparation behavior, actual archive proof, commit and push.
No publication, full verification profile, workflow rerun or new agent by the
implementer. Estimate: 0.15–0.25 hours including focused review and retest.
