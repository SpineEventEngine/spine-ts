# C5.3 implementation report — Chat Projection backend

## Implemented behavior

- Replaced the unbounded room Aggregate message list with one `ChatMessage`
  Aggregate and one `FULL`-visible `ChatMessageView` Projection per message.
- `PostMessage` and `MessagePosted` carry the browser-provided deterministic
  `MessageId`, room, author, text, and timestamp. `MessagePosted` drives the
  Projection; UI-facing delivery is through Projection Query/subscription.
- Added `room`, `author`, and `posted_at` Protobuf column annotations. The
  focused integration test sends a room-filtered wire Query and a matching
  Projection topic, proving the other room is excluded.
- Command handling rejects blank or UTF-8-overlong message/room/author IDs
  (128 bytes), blank or overlong text (4,096 bytes), and invalid Protobuf timestamps
  before Aggregate state/event publication.

## TDD evidence

- RED: the focused test referenced `ChatMessageViewSchema`; it failed because
  the prior model did not define it.
- GREEN: after generator-produced Proto/handler output and minimal Aggregate /
  Projection wiring, the command, room-filtered Query, and Projection
  subscription test passed.
- RED: five finite-input cases were accepted by the initial handler.
- GREEN: the explicit pre-publication validation made all five rejection cases
  pass while proving no valid-ID Aggregate row was stored.

## Focused verification

- `examples/chat-model`: `spine-proto generate` then `tsc -b` passed.
- `examples/chat`: `spine-proto handlers` then `tsc -b` passed.
- `pnpm --config.link-workspace-packages=true
--config.verify-deps-before-run=false exec vitest run
examples/chat/test/model-registry.test.ts`: 14 passed.

## Limits and handoff

The message ID is explicitly client/application generated and is only bounded,
not globally uniqueness-guaranteed beyond normal Entity identity semantics.
Subscription delivery remains best effort; C5.4 owns browser lifecycle,
reconnection/gap re-query, and React UI behavior. No Spine JVM command ran.

Configured role/profile: existing `implementer`, explicitly `gpt-5.6-terra`
with `medium` reasoning. This surface does not expose runtime model
self-introspection; no visible profile mismatch was available.

## Follow-up correction

The obsolete explicit `MessagePosted` event endpoint was removed: internal
Aggregate-to-Projection routing is sufficient, and the Chat browser contract
does not expose message events. The real integration test continues to execute
the generated `dist` entry because Vitest cannot execute raw TypeScript standard
decorators; direct source imports fail before test collection. This is a test
harness limitation, not a replacement event contract.

## Test mechanical correction

The focused test now gives its `it.each` invalid-command matrix one explicit
shape and consumes the public `SubscriptionDelivery` type before narrowing the
entity update. This removes unsafe union/member access without changing Chat
behavior. `eslint examples/chat/test/model-registry.test.ts`, Prettier check,
model/handler generation, both package builds, and the 14-test focused suite
pass. Runtime self-introspection remains unavailable; the configured existing
implementer profile is `gpt-5.6-terra` / `medium`.

## Source coverage correction

Finite-input policy now lives in the decorator-free internal
`src/message-validation.ts` module, while the decorated Aggregate only adapts
the command into that policy. Direct tests cover every policy branch: V8 reports
18/18 branches (100%). The generated-dist integration remains unchanged and
continues to prove command, Projection Query, and Projection subscription
behavior. Focused direct-plus-integration evidence is 25/25 tests passing;
model/handler generation, package builds, ESLint, Prettier, and diff checks
pass. The direct test lives under `test/`, separate from production source as
required. No Spine JVM command ran.

## D3 correction checkpoint — blocked by framework composition

- Application-owned `ChatAuthorizationPolicy` and `ChatContextResolver` now
  consume the public auth contracts. Their focused contract tests prove trusted
  actor/tenant/timestamp mapping, author spoofing denial, unauthorized-room
  post denial, and room-scoped Query/subscription denial. The README documents
  gateway ownership, subscription ownership, and the intentional unpublished
  v1 reset.
- The finite-input policy directly proves UTF-8 multibyte boundaries:
  64/65 `é` identifier characters and 2,048/2,049 `é` text characters. Its
  isolated V8 run reports 18/18 branches (100%).
- The real generated-dist integration now also proves a bounded negative
  foreign-room subscription assertion and no subscription update for every
  invalid-command case. In the latest run 14 of 16 tests pass.
- Two behavior-first duplicate regressions remain RED. Sequential reuse returns
  `{ kind: "ok" }` rather than a rejection; concurrent same-ID posts return two
  `{ kind: "ok" }` results. The next generated-context command does not expose
  prior Aggregate state because command persistence writes the Stand record
  rather than the aggregate current record consumed by the next load. An
  attempted diagnostic-history read also cannot be retained: it requires an
  async handler, while generated `@Assign` metadata rejects `Promise<...>`
  return types with `UNSUPPORTED_RETURN_TYPE`. The required atomic domain
  rejection/no-overwrite guarantee therefore cannot be completed inside the
  assigned Chat-only files.
- A second composition gap prevents a truthful native gateway proof: the public
  unary gateway decodes commands without an application type registry, so its
  `IncomingCommand.message` is undefined and a payload-aware Chat policy cannot
  inspect `PostMessage.author` or `.room`. This requires the smallest
  server/auth integration correction, outside C5.3 ownership. No Spine JVM
  command ran.
- Final app-owned evidence: model `spine-proto generate` + `tsc -b`, app
  `spine-proto handlers` + `tsc -b`, 15 policy/validation tests, validation
  V8 coverage at 18/18 branches (100%), focused ESLint, applicable Prettier,
  and `git diff --check` all pass. The final permission-enabled integration
  command is 14/16 passing, with only the two duplicate-ID prerequisites RED.

## Resumed after S1/A1

- Rebuilt Chat integration is 16/16 green. The client transport correctly
  acknowledges admitted commands even when the duplicate becomes a stored
  domain rejection: EventStore proves one normal event and one
  `MessageAlreadyPosted` rejection, while Aggregate state/version remain the
  first command's and the duplicate produces no extra Projection subscription
  update.
- Direct validation coverage remains 18/18 branches (100%); app TypeScript,
  focused lint, Prettier, and diff hygiene pass. README now documents resolved
  registry composition and acknowledgement-versus-stored-rejection semantics.
- The remaining requested real native Chat gateway composition test (real
  `createNativeGatewayServices`/`UnaryGateway` wired to Chat policy/context)
  is now covered for Post: authorized registered content is decoded, rewritten
  with trusted actor/tenant/timestamp, and forwarded once without credential or
  registry; spoofed and cross-room posts are denied first. Real native Query
  forwards only an authorized room with the trusted context; mixed/cross-room
  criteria are denied before forwarding. Real `SubscriptionGateway` plus
  in-memory bindings admits one authorized subscription and denies a cross-room
  topic before creator invocation. Room policy tests additionally prove
  compositional ALL/EITHER guarantees. The focused Chat suite is 33/33 green.

## Final review correction

- The room constraint evaluator now traverses simple and nested composite
  filters. An `ALL` group is safe when at least one child guarantees an
  authorized room; a non-empty `EITHER` group is safe only when every branch
  provides that guarantee. Empty, unrelated, incomplete, wrong-target, and
  unsupported request forms fail closed.
- Behavior-first evidence reproduced the missing nested-filter behavior before
  the recursive correction. The policy and validation suites now pass 20/20
  tests with 100% statements, branches, functions, and lines.
- Real native Post, Query, and Subscribe composition, duplicate domain
  rejection semantics, Projection delivery, cleanup ordering, and timeout
  disposal pass in the complete 3-file Chat suite: 39/39 tests.
- Model and handler generation, both package builds, full Chat typed lint,
  semantic snippets, targeted formatting, and diff hygiene pass. No Spine JVM
  command ran.

## C5.3 residual correction

- Chat policy now applies the server-aligned finite budget of eight composite
  filters and sixteen simple filters while evaluating untrusted room-filter
  trees. Exceeding either budget fails closed; the behavior-first regression
  constructs nine nested authorized composites and is denied.
- Native gateway evidence uses a matching caller actor and tenant for allowed
  Post, Query, and Subscribe, decodes forwarded Query and creator Subscribe
  bytes, and proves the resolver supplies fresh timestamp `42` alongside
  `ada` / `tenant-a`. Conflicting actor/tenant callers are intentionally
  rejected before unary forwarding or subscription creation (`context-stale`
  / denied). This corrects the review request: hostile values must never be
  silently replaced. The test also exercises a nested mixed
  `EITHER(authorized, unauthorized)` subscription and requires denial before
  creator invocation. The concurrent duplicate assertion correlates the one
  normal `MessagePosted` winner with final Aggregate text and version `1`.
- README usage now documents `startChatServer({ host, port })`, loopback
  `127.0.0.1` and ephemeral port `0` defaults, plus the 1,000-subscription
  service limit.

Configured role/profile: existing `implementer`, explicitly `gpt-5.6-terra`
with `medium` reasoning. This execution surface does not expose runtime model
self-introspection; the configured profile is recorded and no visible mismatch
was available. No Spine JVM command ran.

## Final P2 traversal correction

- Authorization now stops immediately when its server-aligned budget of eight
  composite filters or sixteen simple filters is exceeded; it does not inspect
  remaining wide siblings after that fail-closed boundary.
- Behavior-first tests prove the exact composite `8`/`9` and simple-filter
  `16`/`17` boundaries, plus a poisoned wide sibling that would throw if it
  were inspected after exhaustion. The direct policy and validation coverage
  run is 23/23 tests, 98.55% branches, and 100% lines/functions.
- Configured role/profile remains existing `implementer`, explicitly
  `gpt-5.6-terra` / `medium`. Runtime model self-introspection is unavailable;
  no visible profile mismatch was available. No Spine JVM command ran.
- Coordinator verification passes 23/23 focused policy/validation tests at
  98.55% branches and 100% functions/lines, plus 3 real-loopback files / 39
  tests, typed lint, formatting, and diff hygiene.
