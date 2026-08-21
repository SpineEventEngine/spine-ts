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

## Browser/auth boundary implementation checkpoint

- Classification: high-risk public package, optional-peer, authenticated gateway,
  and lifecycle boundary. Acceptance criteria are a native-only root declaration
  and runtime closure, a public `./browser` host surface, and unchanged browser
  admission/cleanup semantics.
- RED evidence: before implementation, the focused package-export suite failed
  because `@spine-event-engine/server/browser` was absent from package exports.
- GREEN evidence: after adding the browser subpath and removing root browser/
  durable exports, `pnpm --config.verify-deps-before-run=false exec vitest run
  packages/server/test/package-exports.test.ts --passWithNoTests` passed 5/5;
  the server project build completed after generated Proto prerequisites were
  regenerated.
- The worktree baseline has a pre-existing manifest/lockfile mismatch, so frozen
  installation is unavailable without the release-owned lockfile update. Local
  dependencies were installed with lockfile reads/writes disabled; no lockfile
  is staged by this stream.
