# T-0217 — Wave 14 package/SPI boundary contracts

## Scope and dispatch

- Classification: high-risk public package, artifact, and generated-registry
  SPI correction. The task owns the narrow server SPI source/export boundary,
  its focused tests and reference documentation, four public package READMEs,
  disposable snapshot.2 publisher/instructions outside Git, and durable task
  records; unrelated server ingestion behavior and other Wave 14 runtime work
  remain out of scope.
- Existing role: bounded implementation owner.
- Expected model/reasoning: `gpt-5.6-terra` / `medium`, explicitly selected by
  the orchestrator dispatch. Runtime self-introspection is unavailable on this
  surface; configured dispatch is the available metadata.
- Owner paths: `scripts/` policy/consumer tests and helpers, this combined
  work record, and the Wave 14 contract report.

## Review-correction implementation status

- Scope is now limited to the accepted publisher clean-state correction, the
  server generated-handler-registry SPI facade, four beginner README paths,
  and durable T-0216/T-0217 records. Production ingestion remains internal and
  continues to use its existing implementation.
- RED/GREEN evidence is recorded in T-0217 TASK.md. The disposable snapshot.2
  publisher and its instructions were changed outside Git and must not be
  included in a commit. No publication command was run.
- Focused export and documentation policy checks are green. The mandatory cheap
  preflight and specialist review wave remain the next actions; `verify:release`
  is intentionally reserved for the orchestrator after review convergence.
- Independent orchestrator evidence also records the external publisher
  `--self-test` green and combined focused tests green at 25/25.

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

## Browser public-API test cleanup

- Review identified that the broad browser suite still used a typed legacy
  `{ ...ServerOptions, browser }` adapter which duplicated browser preflight and
  message-limit forwarding. A bounded follow-up removed the adapter and all 58
  call sites, replacing them with native `Server`, typed combined
  `BrowserServer.open(...)`, or typed standalone browser host calls.
- All five browser message-limit cases now place `readMaxBytes` or
  `writeMaxBytes` directly in browser options. Standalone ownership cases assert
  the actual public separation: a standalone Gateway does not accept or own a
  native server's contexts/resources.
- Cleanup evidence: zero `BrowserComposedOptions`/`browserComposedServer`
  matches; browser tests 134/134, lifecycle integration 51/51, server no-emit
  typecheck, targeted Prettier, and `git diff --check` pass. The cleanup was
  committed and immediately pushed as `1b222fd87`.
- Restored property-level browser API TSDoc for admission ownership, standalone
  forwarding, canonical origins, bounded auth routes, listener limits, and
  trusted collaborators. `docs:api:check` and server typecheck pass after the
  provider/browser inventory integration.

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

## Storage provider API-docs review correction

- 2026-08-21 (Europe/Lisbon): The provider entrypoint now defines a documented
  local `EntityRecord` type alias to the same entity-record type. This preserves
  the public type while making it a direct child of the generated provider API
  page. The provider inventory is consequently 30 documented and 30 declared
  exports. Focused tests now generate TypeDoc JSON and assert the direct page
  child, and independently reject each of TenantBoundary, TenantCatalog, and
  TenantCatalogProvider at the storage root so a partial leak cannot pass.

## Wave 14 closure

- The final public package graph contains exactly 18 acyclic framework
  packages. Native `@spine-event-engine/server` consumers install neither the
  TypeScript compiler nor auth/browser runtime; browser hosting is owned by the
  documented `@spine-event-engine/server/browser` subpath. Tooling, storage,
  lifecycle, membership, delivery, and test-only seams have deliberate package
  ownership, and no manifest exports an `internal/*` path.
- All 18 package READMEs now begin from an external developer's context, use
  experimental snapshot.3 installation guidance, hide snippet harness controls,
  and retain tarball-valid links to their references. Packed README validation,
  the connected beginner review, generated snippet checks, audience policy, API
  documentation, and release-readiness link checks passed.
- The snapshot.3 history contains exactly 26 commits with message
  `Bump version -> 2.0.0-snapshot.3`. Mechanical audit proved one manifest and
  one top-level version-line replacement per commit. Later commits aligned 46
  concrete internal manifest pins, five generated Proto manifests, and 47
  lockfile references; `workspace:*` specifications and validation snapshot.7
  remain unchanged.
- Every framework package packed successfully. The artifact policy proves
  metadata, payload, targets, exports, README, REFERENCE, LICENSE, dependencies,
  and absence of workspace/file/snapshot.2 leaks. Fresh non-workspace consumers
  installed the exact tarballs, compiled and imported all packages, generated
  handler code, and executed both the full framework/testing path and the
  native-server-without-auth/compiler path.
- The converged review wave recorded clean API/documentation,
  maintainability, reliability, and security dispositions. Affected re-review
  accepted the final compiler-test ownership, registry-writer safety, and real
  browser rollback coverage without threshold reduction or coverage gaming.
- The converged feature `pnpm verify:release` passed at integration commit
  `c3f2c6654`: 4,420 tests passed, 19 were intentionally skipped, and branch coverage was
  13,130/14,586 (90.01%). Earlier diagnostic runs exposed and corrected
  tooling typing, lint, cleanup, TSDoc, copyright, formatting, startup-fixture,
  and coverage failures; no failing run is represented as release evidence.
- Permanent work is complete and pushed to
  `origin/codex/wave14-package-spi-readmes`. The remaining closure actions are
  the record-only commit, integration into `origin/main`, post-merge
  verification, and creation of the disposable untracked snapshot.3 publisher.
  No implementation or test command published to NPM or pushed to the official
  SpineEventEngine remote.
- Fresh post-merge verification then exposed a temporary analyzer dependency
  lookup that a long-lived worktree had masked. TDD correction `0abc4d728` and
  fixture correction `c16a035dd` make the repository generator resolve its
  fixed protobuf dependencies at the analyzed application's pnpm boundary when
  its temporary cache module and an unbuilt Proto Tools entry cannot resolve
  them. Affected reliability and security re-review passed. From a frozen
  install, `verify:task -- --no-tests` and the final merged-main
  `pnpm verify:release` passed; the latter reports 4,421 tests passed, 19
  intentional skips, and unchanged 90.01% branch coverage.
