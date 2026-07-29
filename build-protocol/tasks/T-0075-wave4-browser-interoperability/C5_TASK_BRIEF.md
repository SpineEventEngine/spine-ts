# C5 task brief: React and browser Chat

## Scope and risk

C5 implements Wave 4 Slice D only. It is high-risk because it adds a public
React package and coordinates browser credentials, React Strict Mode,
authoritative query recovery, long-lived subscriptions, and browser resources.
It does not begin Envoy or JVM acceptance (Slice E) or final documentation and
security closure (Slice F). No Spine JVM command may run.

## Frozen behavior

- Browser authentication remains application/gateway HTTP work. Framework code
  supplies bounded, provider-neutral browser session state and fresh request
  metadata; it does not embed an identity provider or persist bearer
  credentials in browser storage.
- Cookie sessions use browser-managed cookies and configurable credentialed
  fetch. Bearer sessions remain memory-only by default. Actor and tenant facts
  returned to the browser are informational and never credentials.
- `@spine-event-engine/client-react` depends only on public `client-web`
  contracts and React. React is a peer dependency. The package imports no Node
  runtime and owns no normalized cache, SSR, Suspense, service worker, or
  external-state-manager behavior.
- Hooks observe stable resources. No command, query, subscription creation, or
  activation starts during render. Effect cleanup is idempotent and prevents
  stale generations from publishing after unmount or Strict Mode remount.
- Chat messages are Projection entities, not events. A domain event may update
  the Projection, but UI message delivery uses Query and Projection
  subscription APIs.
- Subscription updates are best effort. A reconnect or `gapPossible` notice
  triggers one authoritative message Query. Duplicates, gaps, and reordering
  remain possible; current Entity state is authoritative.

## Dependency-ordered milestones

### C5.1 — Browser authentication/session integration

Extend the browser-facing seam without coupling `client-web` to server-only
provider implementations. Cover cookie and bearer metadata, in-memory bearer
replacement/clear, finite sign-in/session requests, abort/close behavior,
credential redaction, and reauthentication before reconnect work. Freeze the
minimal API used by React and Chat.

### C5.2 — React adapter

Create `@spine-event-engine/client-react` with a provider/context and hooks for
request results, Entity Query observation, Entity/event subscription delivery,
and subscription lifecycle. Test Strict Mode mount/unmount/remount, late
promise suppression, one activation per live generation, bounded cancel,
reconnect/gap authoritative re-query, and absence of Node imports.

### C5.3 — Chat Projection model and backend

Replace the example's unbounded Aggregate message list with command handling
that produces one `ChatMessageView` Projection per message. Add indexed room,
author, and posted-time columns, deterministic message identity, bounded text,
and Query/subscription tests. Preserve separate app-owned model packages and
generated registry/handler workflows.

### C5.4 — Browser Chat and real-browser acceptance

Add the React browser application using `client-react`: application-owned
sign-in UI, command posting, room-filtered Projection Query, Projection
subscription, lifecycle/gap notice, and authoritative re-query. Run equivalent
acceptance in current Chromium, Firefox, and WebKit. Prove unmount/reconnect
races retain no active request, subscription, timer, or stale UI publication.

## Ownership and verification

Each milestone has one existing `implementer` owner, explicitly
`gpt-5.6-terra` / `medium`, and behavior-first tests. Production ownership does
not overlap. Deterministic type, package-boundary, unit/integration, browser,
API inventory, snippet, format, and diff checks precede one complete relevant
specialist review wave. Final Wave 4 security remains deferred to Slice F.

Expected relevant concerns:

- C5.1: style, TypeScript/API, documentation, reliability.
- C5.2: style, TypeScript/API, documentation, reliability.
- C5.3: style, TypeScript/API, documentation, reliability.
- C5.4: style, documentation, reliability; API is N/A only if no public
  contract changes, with that reason recorded.

## Acceptance

C5 is complete only when the browser session seam, React package, Projection
Chat backend/UI, and three-engine browser lifecycle acceptance are reviewed,
verified, committed, and pushed. Slice E then owns configurable Envoy and
static unmodified JVM compatibility acceptance.
