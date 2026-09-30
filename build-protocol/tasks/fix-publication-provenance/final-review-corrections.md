# Final review corrections

The fresh reliability and final security review wave is complete. Main accepts
the following bounded correction batch for the existing implementer.

1. **Stale attempt reports (both reviewers, P1).** Record the GitHub run attempt
   in addition to run ID. A writing rerun must require evidence from its
   immediately preceding attempt, not merely a report from any attempt in the
   same run. Reject missing, stale or malformed attempt identity before writes.
   Preserve this distinction even if a cancelled runner never uploaded its new
   local report. A simple attempt identity check is sufficient; do not add a
   remote database, per-package artifact upload or crash-recovery subsystem.
   Test attempt 1 report reused at attempt 3 after an uncertain attempt 2: no
   npm call. Test valid immediate-predecessor recovery and the two-attempt cap.
   Keep read-only confirmation usable separately; it does not authorize writes.

2. **Other visibility order (reliability, P2).** Exact version metadata can
   become visible before its selected tag. During read-only confirmation this
   must remain unconfirmed within the one shared deadline, without another npm
   call. Before any write, wrong or contradictory tags must still stop writes.
   Preserve both already-tested orders (tag first and metadata first). Never
   mark a package published until all required public fields actually match.

3. **Incomplete provenance bundle (security, P2, partially accepted).** Require
   a complete npm-hosted Sigstore bundle shape, including non-empty DSSE
   signature and verification material, before treating its record as present
   and matching. A matching JSON payload alone is not a complete bundle. Missing
   evidence remains unconfirmed; malformed evidence must not produce success.
   Use the actual pinned npm bundle format and public response shape. Document
   clearly that this checks completeness and expected identity, not independent
   cryptographic validity. Do not add a crypto implementation, vendor dependency,
   signature-library import, installation of published packages, or a new audit
   workflow. The approved plan explicitly trusts the fixed HTTPS npm endpoint's
   published records and leaves signing/cryptographic validation to npm/Sigstore.
   A hypothetical compromised npm registry is outside that trust boundary.
   The proposed new independent `npm audit signatures` phase is not adopted.

4. **Obsolete Lerna configuration (main).** pacote is no longer present in the
   workspace graph after Lerna removal. Remove its obsolete override and the
   Lerna-specific package-metadata test, regenerate the lockfile, and frozen
   install if needed. Remove the now-unused nx allowBuilds denial if the lockfile
   likewise confirms nx is gone. Preserve unrelated overrides and permissions.

Run focused behavior tests and the cheap preflight with one worker. No full
build, real publication, commits/pushes, or agents. Update the report with exact
evidence. Main will check these corrections and re-review affected security/
reliability concerns, then run one full release verification and archive proof.

## Targeted security follow-up

The fresh targeted recheck found one remaining concrete defect in v0.3 bundle
completeness. `completeNpmBundle` requires an inclusion promise, but v0.3 requires
an inclusion proof (promise can be absent); exactly one DSSE signature is
required, not merely one among several. Correct this against the pinned npm
bundle schema/validator and real public shape. Keep this structural: no custom
crypto or new dependency. Cover missing proof rejection, valid proof-only
acceptance, and multiple-signature rejection, retaining all identity checks.
Main will recheck a real npm record and the targeted regression. Do not expand
to another whole-change review. All other findings are resolved.

The follow-up recheck confirmed those three cases but found the remaining
required `kindVersion` missing from validation and all log-entry fixtures.
Add the required field and its regression. Check every provided log entry, not
just one valid entry among malformed siblings. Compare the complete relevant
required-field list against the pinned npm validator once now; do not add crypto
verification. Main will perform a deterministic read-only comparison against the
actual npm record and pinned parser before final acceptance. Also document the
currently missing `limitMs` parameter on packageState. Keep the correction bounded.
