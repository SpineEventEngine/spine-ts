# T-0217 — Wave 14 package/SPI boundary contracts

## Scope and dispatch

- Classification: high-risk public package, artifact, and optional-auth
  contract checkpoint; production package sources remain out of scope.
- Existing role: bounded implementation owner.
- Expected model/reasoning: `gpt-5.6-terra` / `medium`, explicitly selected by
  the orchestrator dispatch. Runtime self-introspection is unavailable on this
  surface; configured dispatch is the available metadata.
- Owner paths: `scripts/` policy/consumer tests and helpers, this combined
  work record, and the Wave 14 contract report.

## Contract checkpoint

- Commit `a7eaf6b879831315213743192084e2d64eb0fdb2` added red acceptance tests
  for zero `internal/*` exports, resolved sibling-package test/fixture reaches,
  native server compiler/auth closure, named final SPI/browser surfaces and
  exact acyclic 18-package graph, and a packed native-server consumer.
- The commit was pushed immediately to
  `origin/codex/wave14-package-spi-readmes`.
- Expected-red evidence: 11 internal exports, 24 sibling package implementation
  reaches, server runtime dependencies on auth and TypeScript, six absent final
  entry points, and native packed consumer dependency failure. Formatting,
  focused lint, and 17 unaffected artifact/publication tests were green.

## Confirmed review correction batch

- Review found that the initial scanner missed filename-only tests and several
  JavaScript/TypeScript module forms, used raw-text matching, and did not prove
  pnpm virtual-store closure contents.
- Red evidence before correction: the focused scanner fixture omitted the
  filename-only, CommonJS `require`, and TypeScript import-equals reaches; the
  virtual-store helper was absent.
- Correction: parse source through the TypeScript AST for static/dynamic
  imports, export-from, require, import-equals, and `new URL`; derive tracked
  candidates from both test/fixture directories and `*.test.*`/`*.spec.*`;
  use path-module-aware containment; add false-positive and Windows semantic
  fixtures; inspect every physically installed package manifest, including
  `.pnpm`, after the native consumer install.
- Green correction evidence: scanner fixtures and virtual-store closure fixture
  pass. Intentional production-red assertions remain unchanged: 11 internal
  exports, 24 real reaches, auth/TypeScript native closure, six missing public
  paths, and packed consumer installed auth.

## Limits and next step

- `verify:release` is excluded by the contract-test brief.
- The native consumer compile/import stage remains correctly unreachable until
  the production dependency split removes the detected installed packages.
- Next: subsequent Wave 14 implementation streams satisfy the retained red
  contracts, then rerun the focused consumer through compile/import.

## Fixture-boundary cleanup

- Baseline RED: the AST/realpath scanner reported 18 reachable sibling package
  implementation paths before generated package outputs exposed a further 11;
  the complete observed inventory was 29 paths.
- Migrated test and fixture consumers to declared package imports, including
  generated Proto exports and child-process package entry points. Added narrowly
  scoped `./testing` seams for compiler test support, in-process Delivery
  assembly, and existing server test-only helpers; root exports remain unchanged.
- Current scanner evidence: `siblingPackageTreeReachProblems(...)` returns
  `[]`. The full policy test still has only its accepted browser/auth assertions
  red. The compiler regression was corrected by identifying `External` through
  its nearest owning package manifest (`@spine-event-engine/server`), rather
  than the analyzer module directory. The compiled `proto-tools/testing` seam
  now accepts the canonical server declaration and rejects the path-mapped
  counterfeit; all 14 affected suites pass (13 files, one intentionally
  skipped; 100 tests passed and four skipped).

## Fixture-boundary review corrections

- Publication graph traversal now considers `dependencies`, `optionalDependencies`,
  and `peerDependencies` only. Development-only test edges remain declared but
  cannot create runtime/public graph cycles; focused policy evidence leaves only
  the accepted auth/browser reds.
- TypeDoc now includes all three deliberate `./testing` entry points. Their
  references identify framework test/fixture consumers and state that they are
  outside normal end-user compatibility; proto-tools generation modules remain
  private.
- Package identity continues to prove canonical compiled/workspace server
  `External` recognition and rejection of the existing path-mapped counterfeit.

## Node client and Proto Tools README stream

- 2026-08-21 (Europe/Lisbon): The bounded documentation owner updated
  `packages/client-node/README.md` and `packages/proto-tools/README.md` only.
  Both now identify their external audience, label the `2.0.0-snapshot.3`
  install as experimental, state prerequisites, lead with a concrete first
  success, link `REFERENCE.md` before advanced detail, and state cleanup or
  build-time limits. The Client Node examples retain source-backed, real public
  declarations and now use hidden snippet-context directives. Proto Tools
  removes its unnecessary programmatic-internals snippet and teaches the public
  CLI model-generation flow. Baseline red evidence was the three visible
  in-fence `docs-snippet-path` controls reported by the focused snippet checker.
  Focused green validation passed: the two README snippet checker invocation
  reported no diagnostics; `scripts/check-typescript-snippets.test.mjs` passed
  15/15; audience policy, exact-path Prettier, and `git diff --check` passed.
  Documentation-only `pnpm verify:task -- --no-tests` passed after its normal
  Node, Proto, TypeScript, lint, documentation, and release-readiness gates.
  The external implementation report is recorded at the Wave 14 planning path.
  The implementation committed and immediately pushed as `6564df6d7`.

## Client Node README review correction

- 2026-08-21 (Europe/Lisbon): Accepted the consolidated documentation review
  findings against `6564df6d7`. The local Message Board first-success endpoint
  is now the actual single-tenant `http://127.0.0.1:8090`, with no client
  tenant option. The README now establishes the concrete workspace checkout,
  install/build, and application-start commands before using the private
  Message Board model package; it identifies those imports as a workspace
  contract and directs external applications to their own `package.json` and
  `spine-proto.json` generated exports. The hidden source context remains
  `examples/message-board/app/src/index.ts`, so the snippet compiles against
  real declarations. Focused green evidence: the Client Node snippet checker
  emitted no diagnostics; the policy suite passed 15/15; audience policy,
  exact-path Prettier, and `git diff --check` passed. The correction committed
  as `7644b582a docs: correct Node client Message Board setup` and immediately
  pushed `origin/codex/wave14-readmes-node-tools` from `6564df6d7` to
  `7644b582a`. This record-only closure does not reopen the focused
  documentation checks. The closure record committed and immediately pushed as
  `42a1f9372`.

## Storage provider API-docs correction

- 2026-08-21 (Europe/Lisbon): Corrected the provider-aware TypeDoc inventory
  without changing storage runtime or package exports. `typedoc.json` now has a
  distinct `packages/storage/src/provider.ts` entrypoint. The API checker keeps
  the 43 root declarations separate from 29 direct TypeDoc and 30 declared
  provider exports; `EntityRecord` is declaration-only in the provider module
  because TypeDoc does not emit it as a direct module child. TenantBoundary,
  TenantCatalog, and TenantCatalogProvider are explicitly rejected if they
  leak back to the root, while missing and unexpected provider declarations or
  documentation fail the checker.
- TDD evidence: the added focused inventory test was red because the provider
  TypeDoc entrypoint was absent, then green (2/2) after the entrypoint and
  checker inventories were added. After local Proto generation and declaration
  build, `pnpm docs:api:check` passed and reported 43 root storage exports plus
  29 documented and 30 declared provider exports. Generated Proto manifests
  were local build by-products only and are excluded from the commit.
