# Dependency audit evidence

The recorded lockfile hash, tool versions, exact commands, exit codes, and raw
outputs are in `environment.txt`, `audit-all.log`, `audit-all.exit`,
`audit-prod.log`, and `audit-prod.exit`. Structured results and limitations are
in `result.json`.

Both audit profiles completed with exit code 0 and reported `No known
vulnerabilities found`. There were no advisories to classify as production or
development dependencies, so machine-readable advisory detail and `pnpm why`
paths were not applicable. This is mechanical preparation for the later final
security review, not security acceptance. Results are point-in-time registry
advisory data for the recorded lockfile hash; repeat if dependency resolution
changes materially before that review.
