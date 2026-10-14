# Independent documentation review: examples and reference corpus

## Assignment and method

- Function: existing documentation-completeness reviewer; bounded to the assigned examples/reference corpus.
- Configured profile requested in dispatch: GPT-6 Luna, medium reasoning (Standard speed). Runtime self-introspection is not available on this surface.
- Compared current documentation with TypeScript implementation behavior since base `658da1cdddcb8fd40f9205b1c200abc3a58dd62e`.
- Read the complete current contents of all 35 assigned files (282,905 bytes), in bounded chunks. Seven assigned prose files differ from the base; all other assigned paths were read for relevant current claims and examples.
- Checked relative Markdown destinations in the corpus: no broken relative destinations. One absent snippet target is in `scripts/fixtures/missing-snippet-context.md`, an intentional negative fixture.
- No tests or services were run. No documentation or source files were changed by this review; this report is the sole output.

## Finding

### P2 — Message Board app README presents a stale entrypoint as complete

[`examples/message-board/app/README.md`](../../../../../examples/message-board/app/README.md#L30) labels the code block as the “complete entry point” and associates it with `src/local-application-server.ts`, but the block still hard-codes `run({ port: 8090 })`. The current implementation reads `MESSAGE_BOARD_LOCAL_PORT` and `MESSAGE_BOARD_WEB_PORT`, validates both, and supplies the selected web origin to `BrowserServer` through `webOrigin` ([`local-application-server.ts`](../../../../../examples/message-board/app/src/local-application-server.ts#L17)). This matters when following the adjacent README workflow that allows non-default local ports: the shown entry point does not explain that the browser origin must track the selected web port. Update the example to match the current entrypoint, or label it clearly as a default-only sketch and point to the port configuration.

No other P1/P2 documentation contradictions or concrete omissions were confirmed in this assigned corpus. In particular, the new shared-Delivery recommendations, independent process/shard settings, in-memory Inbox loss limits, recovery-scan caveat, and Gateway subscription/reconnect descriptions agree with the inspected implementation. The JVM reference set is framed as historical research or a future TypeScript target; its historical JVM guarantees were not treated as current TypeScript promises.

## File-by-file coverage

All files below were read in full. “No finding” means no concrete current TypeScript documentation defect in the assigned remit was confirmed.

|   # | File                                                                   | Status                                           |
| --: | ---------------------------------------------------------------------- | ------------------------------------------------ |
|   1 | `compatibility-tests/jvm/README.md`                                    | No finding                                       |
|   2 | `examples/distributed-message-board/README.md`                         | No finding                                       |
|   3 | `examples/distributed-message-board/REFERENCE.md`                      | No finding                                       |
|   4 | `examples/message-board/README.md`                                     | No finding                                       |
|   5 | `examples/message-board/REFERENCE.md`                                  | No finding                                       |
|   6 | `examples/message-board/app/README.md`                                 | P2 finding above                                 |
|   7 | `examples/message-board/app/REFERENCE.md`                              | No finding                                       |
|   8 | `examples/message-board/deploy/README.md`                              | No finding                                       |
|   9 | `examples/message-board/deploy/REFERENCE.md`                           | No finding                                       |
|  10 | `examples/message-board/deploy/container/README.md`                    | No finding                                       |
|  11 | `examples/message-board/deploy/container/readme.test.mjs`              | No finding                                       |
|  12 | `examples/message-board/model/README.md`                               | No finding                                       |
|  13 | `examples/message-board/model/REFERENCE.md`                            | No finding                                       |
|  14 | `examples/message-board/web/README.md`                                 | No finding                                       |
|  15 | `examples/message-board/web/REFERENCE.md`                              | No finding                                       |
|  16 | `examples/orders/README.md`                                            | No finding                                       |
|  17 | `examples/orders/REFERENCE.md`                                         | No finding                                       |
|  18 | `examples/projects/README.md`                                          | No finding                                       |
|  19 | `examples/projects/REFERENCE.md`                                       | No finding                                       |
|  20 | `examples/todo/README.md`                                              | No finding                                       |
|  21 | `examples/todo/REFERENCE.md`                                           | No finding                                       |
|  22 | `examples/todo/USER_GUIDE.md`                                          | No finding                                       |
|  23 | `interop/envoy/README.md`                                              | No finding                                       |
|  24 | `scripts/fixtures/hidden-snippet-context.md`                           | No finding                                       |
|  25 | `scripts/fixtures/invalid-built-declaration-snippet.md`                | No finding                                       |
|  26 | `scripts/fixtures/missing-snippet-context.md`                          | Intentional missing-context fixture; no finding  |
|  27 | `scripts/fixtures/valid-built-declaration-snippet.md`                  | No finding                                       |
|  28 | `scripts/fixtures/visible-snippet-context.md`                          | No finding                                       |
|  29 | `spine-jvm-docs/README.md`                                             | No finding                                       |
|  30 | `spine-jvm-docs/spine-client-api-queries-subscriptions-and-tests.md`   | No finding                                       |
|  31 | `spine-jvm-docs/spine-domain-model-and-signals.md`                     | No finding                                       |
|  32 | `spine-jvm-docs/spine-entities-repositories-and-state.md`              | Historical research; no current TS claim finding |
|  33 | `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`                | Historical research; no current TS claim finding |
|  34 | `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`           | No finding                                       |
|  35 | `spine-jvm-docs/spine-validation-storage-observability-and-support.md` | No finding                                       |
