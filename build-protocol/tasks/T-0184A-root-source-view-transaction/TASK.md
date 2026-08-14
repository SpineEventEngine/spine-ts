# T-0184A: Root Source-View Transaction And Declaration-Safe Interface Tuples

Status: In implementation
Baseline: `origin/main@aed2f194`
Branch: `task/T-0184A-root-source-view-transaction`
Classification: High-risk shared generation and atomic-publication correction

## Assignment Evidence

Implementation owner: existing `implementer`, configured explicitly as
`gpt-5.6-terra` / medium. Runtime telemetry is unavailable from the desktop
surface; the immutable configured role/profile is the available evidence.

The requirements split was performed by the existing requirements-splitter,
configured explicitly as `gpt-5.6-sol` / high. Runtime telemetry is unavailable
from the desktop surface; the immutable configured role/profile is the
available evidence.

## Frozen Requirements

Dependency order is `T-0181 -> T-0182 -> T-0183 -> T-0184A -> resume published
T-0184 -> T-0185 -> T-0186`. T-0184A must not depend on or modify the unpublished
To-Do worktree.

The root workflow's `stageModel` bootstrap must receive its staged package root
for Proto/config/output and the canonical live package root for authored
TypeScript/configuration. It must not copy `src`, `tsconfig.json`, or extended
configuration files. `ProtoGeneration` must build `modelSourceView` from the
live root and its inner staged output. The provider must parse the original
tsconfig in its original directory and redirect generated imports to staged
output.

Persist a fixed-name, bootstrap-internal publication record in the outer stage.
It contains only format version, canonical live package root, canonical live
generated root, and source/config inventory digest. It is not a generated tree,
manifest, npm, public CLI, or public configuration contract. Its root and
generated root must be exact expected canonical values; it must have an exact
version and SHA-256-shaped digest. The fixed record path must be regular and
inside the outer stage. Preserve existing depth, entry, symlink, special-file,
generated, dist, stage, backup, and realpath exclusions. No arbitrary output
or root selection is permitted.

After all model, companion, handler, and registry post-steps, the root workflow
must safety-check and revalidate every record before journal creation or the
first rename. A mutation or malformed record aborts the whole transaction,
removes stages, and preserves all live generated trees/manifests. Direct package
CLI behavior remains unchanged.

Generated and authored companions must emit declaration-safe exact nonempty
tuples, for example:

```ts
const memberSchemas: readonly [typeof A, typeof B] = [A, B];
```

They retain `typeof memberSchemas` in `MessageInterface` and `define`; no
isolatedDeclarations disabling or array widening is allowed.

## Ownership

Production: `scripts/proto-workflow.mjs`, internal bootstrap CLI,
`packages/proto-tools/src/generation/generator.ts`, `source-view.ts`, and
`interface-generator.ts`.

Tests: workflow, generation/source-view/interface-generator, declaration, and
external-consumer tests. Records: this task/review/work log and the narrow Wave
11 addendum only.

## Acceptance And RED Matrix

- Extended-above-package tsconfig works without copied source/config files.
- Authored imports resolve from the live package while schemas resolve from the
  staged output.
- Generated and authored single- and multi-member companions pass
  isolatedDeclarations with exact tuple types.
- Source content modification, add/remove/rename, and recursive configuration
  mutation all roll back publication.
- Malformed version/digest/root, path escape, symlink, FIFO, and missing record
  all fail before publication.
- One invalid model blocks all publication; records/stages clean on success and
  failure; deterministic repeat and direct package generation remain green.
- Changed production branches reach at least 90% coverage.

## Verification And Review

Run cheap preflight plus root generation/current before review. The final task
profile is `verify:release`; do not run it in this implementation phase.

Required review dispositions: API verifies exact tuples/no public CLI;
reliability verifies nested transaction, mutation, cleanup, rollback, and lock;
style verifies bounded bootstrap/no competing parser; docs verifies
internal/generated-only claims. Security is deferred to T-0186, while
path/special-file tests are mandatory here.

## Current Evidence

The initial declaration-safe tuple RED and source-view record RED are green.
Root `pnpm proto:generate` and `pnpm proto:check-generated:current` pass after
the live inventory excludes only the outer root-transaction sibling. The
remaining matrix still needs malformed-record, mutation/rollback, all-model
rollback, and isolatedDeclarations fixture coverage before review.
