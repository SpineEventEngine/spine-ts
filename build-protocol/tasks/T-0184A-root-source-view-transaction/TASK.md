# T-0184A: Root Source-View Transaction And Declaration-Safe Interface Tuples

Status: Complete, integrated, tagged, and post-merge verified
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

Implementation is targeted re-review-ready. The initial declaration-safe tuple and
source-view-record RED cases are green. Focused source-view and
interface-generator coverage is 95.03% statements, 91.06% branches, 97.77%
functions, and 97.21% lines (29 tests). The matrix covers live source/config
content, add/remove/rename mutations; malformed JSON/version/digest/root;
missing, symlink, and FIFO records; staged revalidation rollback; and
declaration compilation of generated/authored single- and multi-member tuples.

`pnpm typecheck:tooling`, full ESLint, cleanup, TSDoc, format, focused workflow
tests, `pnpm proto:generate`, `pnpm proto:check-generated:current`, and
`git diff --check` pass. Specialist review and `verify:release` remain
intentionally unrun.

The accepted specialist correction batch moves every model handoff validation
to the shared pre-journal boundary, after all staging and registry work, uses
the digest from one source-inventory pass, and limits opened record descriptors
to 16 KiB before parsing. Targeted re-review remains required.

The final residual proof completes MessageBoard registry composition before the
global Todo verification failure. It confirms verification precedes journal
publication and leaves every live tree, manifest, registry, stage, and journal
unchanged.

## Release Verification

`verify:release` passed at `5e435b20`: 252 test files passed and 3 skipped;
4,026 tests passed and 14 skipped. Coverage was 94.20% statements
(21,000/22,291), 90.41% branches (12,279/13,580), 94.09% functions
(5,119/5,440), and 95.22% lines (19,582/20,563). All deterministic gates
passed. API, style, reliability, and documentation review confirmations are
clean; security remains deferred to T-0186. The task is integration-ready; no
merge or tag was performed by this implementation owner.

## Integration And Post-Merge Verification

`origin/main` and tag `T-0184A` are at `0bacb0b3`. Post-merge
`pnpm proto:generate`, `pnpm proto:check-generated:current`, and the focused
source-view/interface-generator/bootstrap-cli/proto-workflow selection passed:
4 files and 100 tests. Status and diff were clean. T-0184 resumes next.
