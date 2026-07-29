# C5.2 implementation report

## Implemented behavior

- Added `@spine-event-engine/client-react`, a React-peer adapter that imports
  only the public `client-web` request/subscription contracts and React.
- `SpineClientProvider` supplies an application-owned `ClientRequest` scope.
  `useRequest` and `useEntityQuery` start only after commit and suppress late
  success and failure publication after cleanup.
- Entity/event subscription hooks create and activate only in effects, expose
  latest delivery and independently received lifecycle state, cancel each
  retired handle once, and suppress stale activation, delivery, lifecycle, and
  iterator errors. Entity factories retain the public client-web
  `authoritativeQuery` recovery contract; event gaps remain lifecycle notices.
- No Node imports, normalized cache, SSR, Suspense, service worker, or external
  state manager were added.

## Test/dependency choice

- The focused DOM suite uses `@testing-library/react` 16.3.2, which brings the
  registry-verified `@testing-library/dom` 10.4.1 as its required peer, plus
  jsdom only as Vitest's DOM environment. This is the smallest maintained DOM
  testing surface selected for real React Strict Mode lifecycle behavior.
- React/react-dom 19.2.8 and the matching `@types` 19.2.x packages are root
  development dependencies; React itself is a `^19.2.8` package peer.

## TDD evidence

- RED: provider/query and Strict Mode subscription lifecycle tests failed with
  the missing package entry point.
- GREEN: 12 focused tests pass, including no operation during render, late
  query success/rejection suppression, provider scope failure, Strict Mode
  activation/cancellation, delivery/lifecycle separation, late handle cleanup,
  activation failure, post-activation retirement, and late iterator-error
  suppression.
- Focused native coverage is 100% branches (28/28), 97.40% statements, 93.10%
  functions, and 100% lines.

## Focused verification

- `vitest run --coverage --coverage.include='packages/client-react/src/**' packages/client-react/test/client-react.test.ts`:
  13/13 tests pass; 100%
  branches (28/28), 97.46% statements, 93.33% functions, and 100% lines.
- `tsc -b packages/client-react`, client-react dependency isolation, README
  TypeScript snippets, TypeDoc/API inventory, package-metadata test, explicit
  client-react ESLint, Prettier, and `git diff --check` pass.

## Mechanical acceptance correction

- The initial focused gate report incorrectly treated the typed client-react
  ESLint command as passing. It failed with 34 source/test hygiene errors.
- Corrected the public observation shape, retained the post-activation live
  generation guard, and made the test fixtures fully typed without changing
  observed lifecycle behavior. The focused README command formatting is also
  valid Markdown.
- The exact typed ESLint command now passes. The corrected focused suite is
  13/13 tests with 100% branches (24/24), 97.53% statements, 93.54% functions,
  and 100% lines; package TypeScript, dependency isolation, Prettier, and diff
  hygiene also pass.

## Review lifecycle correction

- Request invocation now rechecks liveness after scheduling, and subscription
  fatal paths retain their original error while requesting one safe, idempotent
  cancellation. Cancellation invokes the handle in a promise callback so a
  synchronous throw cannot escape React cleanup.
- Final focused evidence supersedes every earlier C5.2 count: 17/17 tests,
  92.30% branches, 97.67% statements, 96.96% functions, and 98.61% lines.
  Typed ESLint, package TypeScript/build, dependency isolation, package
  metadata, README snippets, TypeDoc/API inventory, Prettier, and diff hygiene
  pass.

## Final test-only correction

- The fatal-cleanup matrix now covers activation, delivery iteration, and
  lifecycle iteration with both synchronous-throwing and rejected cancellation.
  Each case retains the exact primary `Error` object and invokes cancellation
  exactly once, including after its component is explicitly unmounted.
- Final focused evidence: 24/24 tests; 93.33% branches, 97.75% statements,
  100% functions, and 97.29% lines. Package TypeScript, typed ESLint,
  dependency isolation, package metadata, Prettier, and diff hygiene pass.

## Scope and limitations

No Chat, auth, Envoy, browser-engine acceptance, Node runtime, service-worker,
SSR, Suspense, cache, Git, or Spine JVM work was performed. Browser engine
acceptance remains D5. Runtime metadata is not self-introspectable on this
surface; the explicit assigned role/profile is `implementer`,
`gpt-5.6-terra` / `medium`, with no visible mismatch.

## Query cancellation prerequisite

- `useRequest` now requires its factory to accept the platform `AbortSignal`.
  Each committed effect generation creates one `AbortController`; cleanup first
  retires publication and then aborts that controller once. Factories remain
  post-commit, so immediate cleanup invokes no factory.
- `useEntityQuery` forwards that exact signal through the public
  `request.send(query(), { signal })` call. No overload, options wrapper,
  optional signal, exported factory alias, or client-web contract change was
  introduced. Generic cancellation remains cooperative and the README/TSDoc
  state that factories must forward the signal; dependency ownership is
  unchanged.
- RED: four added focused cases failed against the prior implementation: the
  generic factory and Entity request observed no signal, final Strict Mode
  cleanup retained one active request, and a dependency replacement left the
  retired signal unaborted. GREEN: 28/28 focused tests pass, including active
  generic abort-once, Entity `{ signal }` forwarding with active count `1 → 0`,
  immediate-unmount no-send, Strict Mode live-generation-only/final-zero,
  old-before-new dependency cleanup, and active late success/rejection fences.
- Focused coverage is 97.82% statements (90/92), 93.75% branches (30/32),
  100% functions (34/34), and 97.36% lines (74/76). Package TypeScript build,
  typed ESLint over owned source/tests, dependency isolation, README snippets,
  package metadata (2/2), TypeDoc/API inventory (unchanged at 11 exports),
  Prettier, and diff hygiene pass.
- `pnpm exec vitest` is currently blocked before execution by the existing
  workspace `linkWorkspacePackages` setting mismatch; the installed local
  Vitest binary ran the same focused command successfully. The repository-wide
  `tsc --noEmit -p tsconfig.eslint.json` has unrelated existing/concurrent
  diagnostics in examples, auth, and client-web; the focused package build and
  typed ESLint pass. Runtime self-introspection remains unavailable; configured
  existing-role metadata is `implementer`, `gpt-5.6-terra` / `medium`, with no
  visible mismatch.
