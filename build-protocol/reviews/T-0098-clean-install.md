# T-0098 Review Record

Review target: `ca4f109f`
Baseline: `af72de4b`

## Mechanical preflight

- Fresh copied workspace install: passed with one scope/policy summary and zero
  `Failed to create bin` warnings.
- Focused Proto Tools package and packed-consumer tests: 2/2 passed.
- `verify:task -- --no-tests`: passed, including generated build, tooling
  type-check, lint/TSDoc, formatting, documentation, Proto-current, and package
  readiness checks.

## Review dispatch

- Style/maintainability: existing `style_maintainability_reviewer`, explicitly
  configured `gpt-5.6-terra` / high.
- TypeScript/API documentation: existing `typescript_api_docs_reviewer`,
  explicitly configured `gpt-5.6-terra` / high. Scope is the published package
  executable contract and its compatibility tests.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicitly configured `gpt-5.6-terra` / high. Scope is fresh install,
  pre-build linking, package lifecycle, and external execution.
- Documentation: N/A. No human-facing or API-reference prose changes; the only
  Markdown change is this task's internal evidence log.
- Final security: N/A unless another reviewer identifies a changed executable
  trust boundary or dependency/security behavior. The launcher is a static
  relative import of the package's existing compiled CLI and no dependency or
  command-resolution policy changed.

All model and reasoning fields are explicit before dispatch. Runtime metadata
will be recorded if exposed; otherwise the immutable configured role/profile
and surface limitation are recorded honestly.

## Review wave result

- Style/maintainability: clean, no P0-P3 findings.
- TypeScript/API documentation: clean, no P0-P3 findings. The stable command,
  CLI behavior, exports, declarations, and existing public documentation remain
  compatible.
- Performance/reliability: one accepted P2. Current packed-consumer coverage
  extracts packages manually and executes the launcher by internal path, so it
  does not prove a package manager creates and runs the public
  `node_modules/.bin/spine-proto` shim. Add one installed-tarball regression
  through pnpm or npm and execute that public shim after the normal build.
- Runtime self-introspection was unavailable for all three reviewers. Their
  immutable configured roles and explicitly dispatched `gpt-5.6-terra` / high
  profiles are accepted; no mismatch or inherited fallback was visible.

Only performance/reliability is reopened by the accepted correction.

## Reliability correction evidence

- RED: the manually extracted external-consumer tree has no
  `node_modules/.bin/spine-proto` shim, as expected; the added assertion failed
  with `expected false to be true`.
- GREEN: the correction reuses the existing normal build and packed tarballs,
  then installs a small separate consumer with `pnpm install --offline
--ignore-scripts`. Its fixture-local `pnpm-workspace.yaml` overrides internal
  package dependencies to those tarballs and the already installed
  `node-addon-api`, so no network is needed.
- The regression asserts pnpm creates `spine-proto` on POSIX or
  `spine-proto.cmd` on Windows and executes it through the host-appropriate
  launcher. It reaches the existing CLI and observes the established
  unsupported-command error. `corepack pnpm exec vitest run
packages/proto-tools/test/external-consumer.test.ts` passed (1 file, 1 test).
- The accepted P2 correction is ready for the reopened performance/reliability
  re-review. No other lane is substantively affected.

## Reliability re-review result

- The real offline install, POSIX public-shim execution, fixture bounds, and
  cleanup are sound.
- One Windows-only P2 remains: `cmd.exe /s /c` receives the absolute `.cmd`
  path as a separate unquoted command argument. Windows `/s` quote handling can
  split a temporary path containing spaces. Supply one correctly quoted command
  string or another invocation that preserves the `.cmd` path.
- Return only this deterministic portability correction to the same existing
  implementation owner. The reliability lane remains open; all other lanes
  remain closed.

## Windows shim correction evidence

- Runtime self-introspection remains unavailable. The immutable configured
  implementation owner profile is explicitly `gpt-5.6-terra` / medium.
- RED: a host-neutral assertion with a shim path containing spaces failed
  because `cmd.exe /d /s /c` received the path and unsupported command as
  separate arguments.
- GREEN: the bounded `windowsShimCommand()` builder returns one quoted command
  string, escaping embedded quotes and appending only `unsupported-command`.
  The Windows branch passes it as the one `/c` argument. `corepack pnpm exec
vitest run packages/proto-tools/test/external-consumer.test.ts` passed 1 file
  / 2 tests. Reliability is ready for its targeted re-review.

## Final convergence

- Performance/reliability re-review at `2d5cb5be` is clean with no P0-P3
  findings. One quoted `/c` command string handles spaced temporary paths while
  retaining offline, bounded, cleanup-safe installed-shim coverage.
- Style/maintainability and TypeScript/API remain clean and were not reopened.
- All applicable review lanes are closed. The definitive release verification
  is the next gate.

## Definitive verification

- `pnpm --config.verify-deps-before-run=false verify:release` passed after
  review convergence.
- 178 test files passed and 3 were skipped; 3,498 tests passed and 25 were
  skipped.
- Coverage passed at 94.03% statements, exactly 90.00% branches, 94.52%
  functions, and 94.90% lines.
- All generated build, tooling type-check, lint/TSDoc, formatting,
  documentation, Proto-current, package-readiness, and release-readiness gates
  passed in the same run.

## Deterministic post-merge correction

- Final install audit found pnpm changed the tracked launcher from `100644` to
  `100755`, dirtying an otherwise fresh checkout. A POSIX executable-mode
  assertion failed against the old committed mode and passed after committing
  the launcher as `100755`.
- A subsequent frozen install emitted zero bin warnings, preserved mode `755`,
  and introduced no additional working-tree difference.
- This file-mode correction is the package metadata pnpm already applies. It
  changes no CLI behavior, API, dependency, or trust boundary, so it does not
  reopen the converged review lanes.
