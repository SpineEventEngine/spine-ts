# T-0189 Work Log

Status: NOT STARTED

Await T-0188 ownership classification. Preserve best-effort notification
semantics, explicit overflow termination, bounded cancellation/cleanup,
cookie/CSRF, and no automatic command retry.

2026-08-15: not authorized. Direct native three-update comparison passes while
the real browser path cannot complete its first forwarded request. Ownership
must narrow to the browser/Envoy/Gateway transport boundary through further
diagnostics; no runtime source was edited.

2026-08-15 update: T-0188 proved `interop/envoy/render.mjs` as the single
owner. Chromium CORS diagnostics and a live direct OPTIONS probe both show an
unmatched preflight (404/no CORS headers); Gateway admission remains zero. The
smallest correction is now authorized only after a failing renderer test.

GREEN: the renderer now emits an exact OPTIONS route beside each bounded public
RPC route. `interop/envoy/render.test.mjs` passes; the unchanged Chromium
cookie/CSRF flow passes; a passive Chromium viewer receives three sequential
updates from a separate Ada writer tab through Envoy and Gateway; and the
direct-native three-update comparison passes. Bert was intentionally denied as
a writer, so the valid two-tab regression uses separate authenticated Ada tabs.

Mechanical convergence: Node V8 executed 10 focused MJS tests. `render.mjs`
reported 100% lines/functions and 88.46% whole-file branches; the one changed
`flatMap` route-expansion line executed both POST and OPTIONS outputs, so its
changed executable lines/branches are 100%. This V8 accounting is distinct
from real Chromium evidence. Focused ESLint, Prettier, `git diff --check`, and
`pnpm typecheck:build` passed. The first Vitest coverage invocation found no
tests because the repository's Vitest include deliberately excludes MJS;
Node's V8 runner is the applicable scoped evidence.
