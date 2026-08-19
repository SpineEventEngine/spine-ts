# T-0213 evidence

## Baseline and generated setup

- Baseline: `main@4c28e2223b89fb203709413400770944778c071c`.
- Frozen installation, Proto generation, and generated TypeScript build passed.
- Random generation-ID metadata byproducts were restored; no generated source
  change belongs to this correction.

## Release-plumbing behavior

- RED: `pnpm exec vitest run scripts/package-metadata.test.mjs` failed while
  `verify:release:generated` retained the deleted broker cross-process path and
  two Vitest invocations.
- GREEN: package metadata passed 11/11; `pnpm check:t0212-removed-routing`
  passed; `pnpm install --frozen-lockfile` passed.
- Todo startup and black-box tests passed 55/55.
- The Todo transport importer is absent from the lockfile; no replacement
  transport or alias was introduced.

## Pending closure evidence

- A clean read-only cheap preflight passed frozen install, generated/tooling
  builds, 66 focused tests, policy/documentation/format/diff gates, and release
  readiness over 86 package imports, 54 package assets, and 390 Markdown links.
- Current release-plan and capability-matrix language supersedes the deleted
  local-IPC requirement without rewriting its historical record.
- Managed lifecycle passed 58/58; Coordinator/subscription acceptance passed
  116/116; managed Delivery/external-event acceptance passed 4/4.
- The real To-do smoke passed against a live server.
- Fresh container images passed their contract 5/5. One-node Compose passed
  3/3 and the two-node, four-replica distributed topology passed 4/4, with
  clean resource teardown.
- Four focused reviews completed. The accepted current-documentation/guard
  batch passes the removal guard, metadata 11/11, docs audience/snippets/API,
  cleanup, TSDoc, formatting, and diff checks.
- Affected specialist re-reviews.
- Required release verification, post-merge verification, and remote cleanup.
