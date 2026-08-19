# T-0213 evidence

## Baseline

- `origin/main` and the task baseline resolve to
  `4c28e2223b89fb203709413400770944778c071c`.
- Frozen dependency installation passed.
- Fresh Proto generation passed checksum/style/descriptor verification.
- Generated TypeScript build passed after generation.
- The ten tracked generation-ID metadata values were restored to the baseline;
  no generated implementation output is tracked as a task change.

## Read-only inventories

- Security/source: current trust boundaries and focused security hypotheses
  mapped with exact source/test anchors; deleted ZeroMQ boundary retired.
- Dependency/package: package metadata tests passed 31/31; registry signature
  audit passed for 501 packages; full audit reported seven transitive
  advisories requiring T-0213 disposition.
- Documentation/status: exact stale current records and already-correct
  historical records classified.
- Release smoke: exact managed, Todo, Docker, and Compose commands and cleanup
  paths identified; deleted bypass/cross-process/ZeroMQ tests explicitly
  excluded.

## Release-plumbing correction

- RED evidence: the package metadata test failed before the command correction
  because the release script contained the deleted broker cross-process path and
  had two `vitest run` invocations.
- GREEN evidence: `pnpm exec vitest run scripts/package-metadata.test.mjs`
  passed 11/11; `pnpm check:t0212-removed-routing` passed; and
  `pnpm install --frozen-lockfile` passed.
- Todo behavior evidence: `pnpm exec vitest run
examples/todo/test/startup-contract.test.ts examples/todo/test/black-box.test.ts
--pool=forks` passed 55/55.
- The correction removed the Todo transport importer from `pnpm-lock.yaml`; it
  introduces no replacement transport or alias.
