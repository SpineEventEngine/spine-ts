# Browser Chat fixture

`@spine-event-engine/example-chat-web` is a deliberately small React browser
fixture. It composes the public `@spine-event-engine/client-react` hooks and
the application-owned `ClientRequest`; it does not replace the hooks, cache
entities, or model chat messages as events.

The hosting application owns sign-in and creates a fresh `ClientRequest` only
after it has established its browser session. The supplied session object is a
provider-neutral UI boundary: actor data is informational and is never a
credential. Cookie and bearer session transport setup stays in `client-web`.

For a room, the fixture posts `PostMessage`, queries `ChatMessageView`
Projection entities with a room filter, and subscribes to that Projection
topic. Subscription delivery is a best-effort hint. A `resynchronization`
delivery is already authoritative and becomes the visible room state without a
second query. Raw updates and `gapPossible` notifications coalesce into at
most one in-flight room refresh and one follow-up. Duplicate, omitted, and
reordered notifications remain possible; intermediate history is not
recovered.

Sign-in failures are visible and retryable; late sign-in completions after
unmount are ignored. Command failures, including resolved Spine `error` and
`rejection` outcomes, retain their generated message ID and exact text for a
single-flight retry. A later normal room refresh supersedes any recovered
state.

The focused component test is:

```sh
pnpm --config.verify-deps-before-run=false vitest run examples/chat-web/test/chat-web.test.tsx
```

Real-browser acceptance is run with `@playwright/test@1.62.0`:

```sh
pnpm --config.verify-deps-before-run=false --dir examples/chat-web test:browser
```

The configured fixture passed in Chromium, Firefox, and WebKit. A fresh
checkout needs `pnpm install` and
`pnpm exec playwright install chromium firefox webkit` before repeating that
acceptance.
