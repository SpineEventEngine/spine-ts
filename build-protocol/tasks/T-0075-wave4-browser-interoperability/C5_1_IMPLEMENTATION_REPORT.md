# C5.1 implementation report

## Implemented behavior

- `BrowserSession` is a provider-neutral browser resource with explicit
  browser-managed cookie and memory-only bearer modes; it has no identity
  provider, storage, React, Chat, or server-runtime dependency.
- Browser RPC factories accept an explicit validated Fetch credential mode and
  retain the existing fresh per-call metadata supplier. The session supplies
  fresh bearer metadata without exposing cookies.
- Application-owned sign-in/session HTTP may use `session.fetch()`: it is
  abortable, bounded to 10 seconds by default and 60 seconds maximum, races
  non-cooperative Fetch work, and redacts a captured bearer value from thrown
  request errors without retaining the source error as a cause.
- `reauthenticateBeforeReconnect` receives the live subscription cancellation
  signal before every reconnect attempt. `BrowserSession.reauthenticate()`
  forwards caller cancellation and publishes only bounded, validated
  actor/tenant/expiry information; stale concurrent refreshes cannot overwrite
  newer context.
- Session/client close remains idempotent. Session close aborts owned work and
  clears the bearer value. Actor and tenant values are informational only.
- Context reads return a defensive expiry `Date` copy, so a caller cannot
  mutate retained informational session state.

## TDD evidence

- RED: five new session tests failed because the public resource did not exist.
- GREEN: cookie/bearer metadata, replacement/clear, bounded Fetch, close,
  redaction, and informational reauthentication passed.
- RED: reconnect reauthentication observed zero calls because recovery had no
  hook. GREEN: recovery invokes the hook before the second Subscribe with the
  live cancellation signal.
- Hostile regressions were RED then GREEN for abort-ignoring Fetch, one
  request's bearer snapshot, out-of-order refresh completion, malformed
  informational context, invalid Fetch credentials, caller cancellation, and
  mutation of a returned expiry snapshot.

## Focused verification

- `pnpm --config.verify-deps-before-run=false exec vitest run packages/client-web/test/browser-session.test.ts packages/client-web/test/client.test.ts`
- Result: 2 files / 83 tests passed.
- Focused browser-client branches: 337/369 (91.33%).
- `pnpm --config.verify-deps-before-run=false exec tsc --noEmit -p packages/client-web/tsconfig.json`
- Result: passed.
- `pnpm --config.verify-deps-before-run=false --filter @spine-event-engine/client-web run check:dependencies`
- Result: passed; the browser package has no Node dependency.
- Isolated TypeDoc inventory to `/private/tmp/spine-ts-c5_1-api`: passed and
  includes `BrowserSession` and every exported session contract.
- Canonical API inventory (`scripts/check-api-docs.mjs`): passed with 22
  expected `@spine-event-engine/client-web` exports.
- Fresh root `typecheck:build:generated`: passed; no Spine JVM command ran.
- `node docs/check-typescript-snippets.mjs`: passed after rebuilding client-web
  declarations and replacing the undeclared bearer-example token with a bounded
  application-owned sign-in/exchange response validation flow.
- Changed-file Prettier and `git diff --check`: passed before the concurrent
  coordinator work-log edit; the shared log's unrelated pre-existing C4 line is
  left for the coordinator to normalize with its own record changes.

## Scope and limitations

No Google, GitHub, OIDC, auth gateway, server session/provider, React, Chat,
Envoy, JVM, Git, or browser-storage change was made. `ResolveContext` remains
an application/gateway HTTP or RPC adapter seam; this package does not claim a
specific endpoint or provider flow. No live provider or Spine JVM command ran.

## Review-correction batch

- Reconnect reauthentication now receives a client-owned child signal and is
  raced against terminal cancellation and the remaining finite retry budget.
  Cancellation or deadline aborts that signal, detaches a non-cooperative late
  callback safely, terminates recovery, and prevents a second `Subscribe`.
- Credential mode is held in a private field and exposed only through a literal
  `"include" | "omit"` getter; JavaScript assignment cannot alter subsequent
  Fetch behavior.
- Public names are `OnBrowserSessionContext` and
  `onReauthenticateBeforeReconnect`. The stale names and exported options type
  were removed; the API inventory now records 22 exports.
- README language now distinguishes bounded `BrowserSession.fetch()` handling
  from arbitrary application callback cleanup, and limits bearer redaction to
  errors wrapped by that session HTTP helper.

### Correction TDD and evidence

- RED: runtime credential assignment, renamed callback wiring, live hook
  cancellation, and a never-settling hook all failed against the reviewed
  implementation.
- GREEN: 2 focused files / 86 tests passed. New regressions prove immutable
  credential mode, hook-signal abortion on cancellation with no second
  Subscribe, and retry-deadline exhaustion of a never-settling hook with no
  second Subscribe.
- Focused client-web coverage: 347/383 branches (90.60%).

## Final targeted correction

- Recovery rechecks the injected scheduler after reauthentication resolves and
  fails terminally without a second `Subscribe` if that callback consumed the
  remaining retry budget.
- `BrowserSession.#run()` attaches its late-rejection observer immediately when
  work begins, before the abort race can settle. Timeout and caller-cancel
  regressions then reject the underlying work late without an unhandled
  rejection.
- The cancellation regression now defers the hook, cancels it, then rejects it
  late; no second subscription or lifecycle resurrection occurs.

### Final targeted evidence

- Focused tests: 2 files / 89 tests passed.
- Focused client-web coverage: 349/385 branches (90.65%).
- Root `typecheck:build:generated`, client-web dependency checking, semantic
  TypeScript snippets, API inventory, Prettier, and `git diff --check` passed.
- Explicit ESLint over client-web source/tests and the API inventory exits
  nonzero on 197 pre-existing repository rule errors across the long-standing
  client-web implementation and fixtures. This correction removes its two
  introduced violations; baseline cleanup is outside C5.1's bounded behavior.

## Late-success lifecycle regression

- A deferred reconnect hook now has symmetric terminal-race coverage: after
  cancellation aborts its child signal, resolving that hook later produces no
  second `Subscribe` and no later `connecting`/`connected` lifecycle notice.
  The test consumes the original terminal sequence through `closed` and stream
  completion. No runtime/API change was required.
- Focused tests: 2 files / 90 tests passed. Focused coverage remains 349/385
  branches (90.65%); client-web TypeScript, Prettier, and diff hygiene pass.

## Runtime metadata

Existing role: `implementer`. Expected dispatch profile: `gpt-5.6-terra` /
`medium`, both explicit in the assignment. This execution surface does not
expose independent runtime self-introspection, so the configured profile is the
available evidence; no visible mismatch occurred.
