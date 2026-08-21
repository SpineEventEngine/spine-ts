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
- Browser composition now exposes standalone signal-managed `BrowserServer.run(options)`
  and combined `BrowserServer.run(nativeServer, options)` alongside caller-managed
  `open(...)`; the latter owns the browser listener and closes its native running
  server on startup rollback/close. GCE/GKE and Message Board gateway entrypoints
  now import that browser-only package surface.
- Focused migration evidence: package exports/index plus GCE/GKE example suites
  passed 31 tests. The Message Board deployment-config suite could not load its
  unrelated `@spine-event-engine/delivery-client` package because its generated
  build output is absent in this worktree.
- Durable-binding tests now consume the browser entrypoint rather than the root;
  their focused suite passed 44/44. The remaining browser-host cases are still
  concentrated in `packages/server/test/server/server.test.ts` and use the
  removed `ServerOptions.browser` shape, so they require a mechanical but large
  migration to `BrowserServer.open/run` before the browser suite can be green.
- Browser host and durable-binding production sources now reside under
  `packages/server/src/browser/`; the native `src/server/` tree has no browser
  implementation source. Focused build plus durable/public-contract/Coordinator
  tests passed 81/81 after the move.
- Browser test migration uses one bounded test-only composition helper that
  delegates all former root browser construction to public `BrowserServer.open`
  / `run` while leaving native-only construction unchanged. Static browser
  validation runs before combined native startup. The public-bind rollback now
  closes a supplied running native server; the single-worker browser suite
  passes 126/126. Provider conformance passes 2/2 and Message Board deployment
  configuration passes 23/23 after locally building ignored dependent output.

## Browser/auth boundary final consumer proof

- Full browser-host evidence: `packages/server/test/server/server.test.ts` was
  run single-worker and in-order with 126/126 passing assertions. The retained
  helper only replaces legacy construction; browser admission, CORS,
  credentials, auth-route, durable recovery, discovery, drain, retry, and
  startup rollback assertions remain intact.
- Combined browser, durable, provider, Message Board, and GCE/GKE focused
  evidence passed 137/137. Generated dependencies were locally bootstrapped
  with verification disabled and the ten nondeterministic proto manifest files
  restored afterwards; no lockfile is included.
- The packed native-root consumer now installs the packed server artifact,
  compiles and imports it without the auth package or TypeScript compiler in
  its dependency closure. It carries `@types/node` solely to resolve the
  native Node declaration references exposed by the root contract. Boundary
  policy plus snapshot-artifact evidence passed 11/11.
- `typecheck:build:generated` passed. `docs:api:check` remains blocked only by
  the separately classified storage provider inventory regression (missing
  TenantBoundary, TenantCatalog, and TenantCatalogProvider); this stream made
  no further TypeDoc/API-inventory changes beyond its pushed server correction.

## Browser/auth review correction batch

- Combined browser composition now rejects non-loopback native builders before
  start and rejects non-loopback running servers. Browser preflight validates
  standalone forwarding, origins, auth routes, capacity, host, and transport
  limits before native start; an accepted native running server closes exactly
  once when that preflight fails.
- Root `server.ts` no longer retains Browser/auth placeholder declarations or
  browser helpers. The browser entrypoint publishes only `open` and `run`; its
  validation/listener seams are source-only test access. Direct browser and
  native lifecycle evidence passes 130/130 and 51/51 respectively.
