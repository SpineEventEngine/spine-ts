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

- Cheap preflight and affected specialist reviews.
- Managed lifecycle, subscription, Delivery, external-event, Todo, Docker, and
  Compose acceptance.
- Required release verification, post-merge verification, and remote cleanup.
