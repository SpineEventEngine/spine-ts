# T-0215 evidence

## RED evidence

- Direct production-class reproduction: three overlapping
  `DurableSubscriptionBindings.purgeExpired(1)` calls produced
  `thirdOutcome=binding-busy`.
- Retained Vitest regression:
  `pnpm exec vitest run packages/server/test/server/durable-subscription-bindings.test.ts --pool=forks --reporter=dot -t "coalesces overlapping expiry purges"`
  failed because the third promise rejected `binding-busy`.
- Retained Gateway regression:
  `pnpm exec vitest run packages/auth/test/subscriptions/index.test.ts --pool=forks --reporter=dot -t "maps maintenance contention before cancellation"`
  failed because pre-operation purge contention escaped as a raw `Error`
  instead of the existing `binding-busy` Gateway result.

## Live evidence

- The UI, Gateway, Coordinator, Delivery, Datastore, and two replicas remained
  alive during the HTTP 500; no provider or backend crash accompanied it.

## Green checkpoint evidence

- `pnpm exec vitest run packages/server/test/server/durable-subscription-bindings.test.ts --pool=forks --reporter=dot -t "coalesces overlapping expiry purges"` passed.
- `pnpm exec vitest run packages/auth/test/subscriptions/index.test.ts --pool=forks --reporter=dot -t "maps maintenance contention before cancellation"` passed.
- `pnpm exec vitest run packages/server/test/server/durable-subscription-bindings.test.ts --pool=forks --reporter=dot -t "later bounded purge horizon|joins a coalesced purge"` passed.
- Runtime metadata is not exposed by this surface. Dispatch provenance is the
  immutable configured existing `implementer` role, `gpt-5.6-terra` / `medium`.
