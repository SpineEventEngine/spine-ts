# Vercel and Ax adapter reference

Audience: implementers of the Spine AI facade and production adapter.

`src/adapter/bridge.ts` is an internal compatibility seam. `src/index.ts` deliberately
publishes no adapter factory yet. The approved public factories are
`VercelAx.model()` and `VercelDecision.model()`; they require the facade SPI and
will be added in a later milestone. Do not import the bridge from an Agent.

The proof currently uses published `@ax-llm/ax@25.0.0` and `ai@7.0.128`.
They satisfied this repository's 24-hour release-age policy on 7 October 2026. `ai@7.0.128` pins its provider, utility, and gateway
dependencies to mature versions. The AI SDK and Ax declarations produce errors under
the repository's TypeScript 6 `exactOptionalPropertyTypes` setting. This package's
build and tooling configurations therefore set `skipLibCheck: true`; the root
tooling check excludes this package and invokes its separate source-and-test
check. All other strict flags remain active for authored code. A separate
`skipLibCheck: false` fixture compiles the public `@ai-sdk/provider` interfaces
directly, including V3/V4 generation models and the V4 decision model. Future
public factories should accept those provider interfaces rather than export
types from `ai` or Ax.

The deterministic protocol tests use real Ax generation and Vercel
`MockLanguageModelV3`. They establish:

- Ax's native JSON schema reaches the Vercel model as a strict JSON response
  format, including the required field.
- An invalid candidate produces an Ax correction and another counted Vercel
  request. Malformed JSON reaches Ax for correction with actual provider usage
  recorded even if correction is exhausted or usage persistence fails. A request
  limit blocks that correction before transport.
- Ax functions execute after a Vercel tool call, and the tool result reaches the
  next Vercel request. The Vercel tool declaration has no executor. Text parts
  and structured MCP facts survive replay; unsupported media is rejected.
- An in-flight abort reaches the provider model.
- Cancellation during an asynchronous attempt reservation prevents provider
  dispatch after that reservation completes.
- Repeated tool call identities are rejected before dispatch; assistant text
  accompanying a tool call survives continuation. Parameterless Ax functions
  receive an empty object input schema.
- Non-success provider finish statuses, including a parseable response cut off
  by length, cannot be reported to Ax as a successful stop.
- A tool-call-only response that the SDK cannot expose through object generation
  is rejected after recording usage; it cannot become an empty Ax success.
- Provider token counts reach the usage callback; absent counts remain absent.
  The bridge rejects Ax cost and latency queries that it cannot substantiate.
- An asynchronous attempt reservation is awaited before provider dispatch, and
  its rejection prevents transport. Usage recording is awaited before output
  returns; a recording failure rejects the operation. Invalid preflight input
  and an already aborted signal do not consume a request attempt.

The bridge rejects service-wide options it cannot apply and disables Vercel retries with `maxRetries: 0`. It advertises only
native structured output and text prompt support. It does not provide a complete
Agent adapter. In particular, streamed byte bounds, Proto validation, durable
attempt/audit records, tool authorization and persistence, authenticated model
selection, result reuse, unknown write outcomes, and decision models remain
future work. `generateText` buffers provider output in this proof; production
byte limits require a controlled reception path. The request counter is
operation-local and must be backed by the persisted invocation budget later.
