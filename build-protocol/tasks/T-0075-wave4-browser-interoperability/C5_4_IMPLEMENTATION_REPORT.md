# C5.4 implementation report — Browser Chat fixture

## Scope and profile

- Existing role: `implementer`.
- Explicit configured profile: `gpt-5.6-terra`, reasoning `medium`.
- Runtime metadata limitation: this surface exposes the immutable configured
  role/profile and explicit dispatch, but not independent model
  self-introspection.
- Production ownership: `examples/chat-web/**`, minimal root test/project
  references, and this report. Frozen client-web, client-react, auth, server,
  Envoy, Slice E/F, and JVM work are untouched.

## Behavior

The fixture adds an application-owned, provider-neutral sign-in screen. A
signed-in session renders a React `SpineClientProvider`, posts `PostMessage`,
queries only room-filtered `ChatMessageView` Projection rows, and creates an
entity (Projection) subscription. It consumes an entity `resynchronization`
delivery directly as authoritative room state, without a duplicate Query. Raw
updates and `gapPossible` notices coalesce to one in-flight refresh plus one
follow-up, and a later normal response supersedes recovered state. Sign-in has
an unmount liveness generation. Rejected posts and resolved Spine
`error`/`rejection` outcomes retain generated ID/text for a single-flight retry.
It relies on the public React adapter for effect ownership, stale-generation
suppression, activation, and cleanup; it does not recreate hooks or maintain a
normalized cache.

## TDD and focused evidence

- RED 1: focused Vitest initially found no test file because the repository
  include pattern excluded `.tsx`. The minimal include change was made.
- RED 2: rerunning then failed as expected because
  `examples/chat-web/src/index.js` did not exist.
- GREEN implementation: `ChatBrowserApp` plus component tests cover sign-in
  rejection/retry/unmount, room Projection rendering, command retry, recovery
  ownership, raw-hint coalescing, and unmount/late-query cleanup.
- Passed: `pnpm --config.verify-deps-before-run=false vitest run
examples/chat-web/test/chat-web.test.tsx` — 12 tests.
- RED correction: four behavior tests initially failed for missing sign-in
  error/retry, direct recovery rendering, bounded refresh coalescing, and
  retained command retry; two later RED tests caught resolved application
  rejection handling and stale recovered state after normal refresh.
- Passed targeted V8 coverage: `pnpm --config.verify-deps-before-run=false
vitest run --coverage --coverage.include=examples/chat-web/src/index.tsx
examples/chat-web/test/chat-web.test.tsx` — `index.tsx` 96.03% statements,
  91.22% branches, 100% functions, and 98.85% lines; TSX is included in the
  root V8 coverage input with no fixture ignore.
- Passed: `pnpm --config.verify-deps-before-run=false exec tsc -b
examples/chat-web --pretty false`, `pnpm --config.verify-deps-before-run=false
exec eslint examples/chat-web`, supported-file Prettier, and
  `git diff --check`.

## Browser acceptance limitation

The package declares `@playwright/test` exactly `1.62.0` (Node >=20) and
contains a Vite-served fixture, three named engine projects, and a browser
acceptance spec. After the coordinator linked dependencies and installed the
browser binaries, the required local-server permission was granted and
`pnpm --config.verify-deps-before-run=false --dir examples/chat-web
test:browser` passed all three engines: Chromium, Firefox, and WebKit.

The browser fixture invokes the captured public entity `authoritativeQuery`
once, emits its resynchronization response, verifies one Query and the
recovered row, then begins a late normal refresh, tears down the root, resolves
that work, and verifies no stale DOM or active subscription. The component
suite owns sign-in/post/recovery behavior; accepted React-adapter tests remain
the contract-level coverage for request/subscription/timer cancellation across
reconnect races.

## Final C5.4 correction

- RED: a deferred second raw hint and deferred post-unmount regression exposed
  that refresh sequencing depended on render timing and that posts had no
  cancellation signal.
- GREEN: initial Query remains `client-react` owned, while raw hint recovery
  uses an application-owned, abortable serial `ClientRequest.send` loop with
  at most one pending follow-up. `ChatRoom` now aborts that loop and direct
  `post` work on unmount; late completions/rejections cannot publish.
- Passed focused coverage: 17 component tests; `index.tsx` V8 coverage 95.12%
  statements, 90% branches, 100% functions, and 98.13% lines. The root V8
  include covers TSX without an ignore. Typecheck, ESLint, Prettier, diff
  integrity, and the three browser engines are re-run for this correction.

## Room-transition correction

- RED: rerendering from room A to room B while an A hint refresh and A post
  were deferred leaked A's input/posting state into B.
- GREEN: `ChatRoom` is keyed by room, so a room transition unmounts the old
  app-owned refresh/post work (aborting both signals) and mounts fresh query,
  subscription, UI, and pending-command state for B. The focused regression
  proves B accepts a new post and processes a new raw hint.
- Passed: 18 focused component tests; targeted V8 remains 95.12% statements,
  90% branches, 100% functions, and 98.13% lines. Typecheck, ESLint, Prettier,
  and diff integrity pass. The browser fixture is unchanged by this
  component-only keyed remount correction.

## Tooling correction

- `tsconfig.eslint.json` now enables React JSX for the TSX fixture/test inputs.
  Chat-web request/post mocks carry callable public-operation signatures and
  statically represented optional signal options; tests narrow a supplied
  signal before asserting abortion.
- `pnpm --config.link-workspace-packages=true
--config.verify-deps-before-run=false typecheck:tooling` has no
  `examples/chat-web` diagnostics. Other package baseline diagnostics remain
  outside this ownership boundary. The explicit configured profile remains
  `implementer` / `gpt-5.6-terra` / `medium`; independent runtime model
  introspection remains unavailable.
