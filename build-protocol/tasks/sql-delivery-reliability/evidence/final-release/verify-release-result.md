# Release verification result

The single `pnpm verify:release` invocation exited **1** before reaching the release test/coverage phase. The exact process output is preserved in `verify-release.log`, with exit code in `verify-release.exit`. It stopped during `pnpm proto:generate`, before `verify:release:generated`.

Failure: `spine-proto: @spine-event-engine/proto: manifest packageVersion must match package.json version`. `packages/proto/spine-proto-manifest.json` declares `2.0.0-snapshot.22`; `packages/proto/package.json` declares `2.0.0-snapshot.23`. Proto generation then reports `Failed to stage ServerBlackBoxTests output: ServerBlackBoxTests model generation failed`. No release tests or global coverage ran; there are therefore no test counts, coverage totals, or downstream failure files to report from this invocation.

Provenance at invocation: commit `f2387e164c732d3ca34f7955d9dce51a38974013`; source tree `55bc19425c439193da5e713ab0e5568d50196d94`; `pnpm-lock.yaml` Git blob `d4c4186a5d53b300883b89826df05578f4144c16`; lockfile SHA-256 `208f8a77f22da9858c4d143f50b43de09f81036ef065c1d87d7b6ea8d97ffcd3`.

Temporary TypeDoc and Node compile cache files under `evidence/final-release/runtime-tmp` were removed after the commands. No production or test files were changed by this verification assignment.
