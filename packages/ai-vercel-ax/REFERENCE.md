# Vercel and Ax adapter reference

Audience: application developers registering provider models, and implementers connecting the Spine Agent runtime.

`VercelAx.model()` registers OpenAI Responses with `VercelAx.capabilities.openAIResponses()` or Anthropic Messages with `VercelAx.capabilities.anthropicMessages()`. `VercelDecision.model()` registers an OpenRouter Jev decision backend with `VercelDecision.capabilities.openRouterJev()`. Both factories accept a semantic `ModelRef`, trusted identity and authorization callbacks, and a connection callback that constructs a published Vercel provider model using the supplied operation-scoped `fetch`. The connection returns that model and the same credential-free identity that the runtime authorized. Registration and connection do not dispatch a model request.

`VercelAx.chatgptPlanModel()` selects the separate ChatGPT plan Responses
profile at `/v1/responses`. It uses the same identity, authorization, and
guarded-fetch controls. The trusted application supplies a nonempty OAuth
access token through its connection callback; the adapter sets the pinned
OpenAI SDK's `apiKey`, endpoint, and guarded fetch explicitly. This lower-level
factory does not sign in or refresh credentials. It does not fall back to
ambient API key or base URL settings. The generic `VercelAx.model()` rejects this profile. See
the [complete registration example](README.md#chatgpt-plan-responses-registration).
This profile sends `stream: true`, `store: false`, developer instructions,
stateless input, and `reasoning.encrypted_content`. Local functions use a
`spine_mcp` namespace. It accepts prompt-and-validate output only. A requested
`maxOutputTokens` ceiling or native-schema mode fails with
`UNSUPPORTED_CAPABILITY` before an inference attempt. The existing API-key
OpenAI and Anthropic profiles continue to support explicit token ceilings.
The profile retains ordered typed response items for continuation and replay;
only `response.completed` admits output. Provider failure, incomplete output,
refusal, and missing terminal responses remain recorded failures.

`VercelAx.chatgptPlanSession({ agentName, credentials, platformFetch? })` supplies
the reusable ChatGPT authentication lifecycle. It handles PKCE, state and nonce
validation, signed identity verification, issued-client registration, token
exchange and refresh, account model discovery, and revocation. The application
provides trusted credential persistence and its native browser/loopback callback.
The adapter does not depend on Electron or choose an application storage format.

`begin(redirectUri, clientId?)` returns an opaque attempt exposing only
`authorizationUrl`. Pass that same attempt and the actual callback URL to
`complete()`. `accounts()` and `models(clientId)` return account and model details
without tokens; `pendingClientIds()` supports resuming an issued registration.
`model({ ref, clientId, model, authorizeUse, platformFetch? })` creates a deployment
bound to the selected verified account and discovered model. It supplies and
refreshes the token itself, while the application permission callback decides
whether the accepted signal may use that selection. The lower-level token
callback factory remains available for applications with an existing token
service.

`signOut(clientId, signal?)` prevents reuse of the account during sign-out, invalidates
older browser grants, attempts remote refresh-token revocation, and clears local
tokens, including when the caller cancels remote revocation. Its boolean result
reports whether remote revocation was confirmed;
a local persistence failure rejects and leaves the account unavailable to that
session. Authentication callbacks and stored credentials do not enter Agent
conversation history. See the [sign-in example](README.md#sign-in-with-a-chatgpt-plan).

Pass a cancellation signal to `complete()` when the application may close while
sign-in is finishing. Cancellation also invalidates a grant whose credential save
finishes late. The application must still close its browser callback listener.

The generation path uses Ax to render requests, correct invalid output subject to any configured model-request ceiling, and continue after recorded tool proposals. Direct Vercel provider streams carry native descriptor-derived JSON schemas or prompt-and-validate instructions. The adapter preserves raw output, ordered provider tool proposals, actual model identity when reported, token usage with absent counts distinct from zero, and safe failure categories. For Anthropic Messages, the response journal also records ordered text, signed thinking, redacted thinking, and tool blocks. The adapter rebuilds the exact assistant block order from that journal for tool and correction requests, including after replay; incomplete thinking never authorizes a continuation. It journals each physical attempt before tool authorization or a second model request. A runtime denial ends with `TOOL_FAILED`; an unresolved tool write ends with `TOOL_OUTCOME_UNKNOWN`. Neither becomes a fabricated tool result.

Anthropic uses `@ai-sdk/anthropic@4.0.72` and the exact `/messages` endpoint under the authorized credential-free base URL. In native-schema mode the adapter forces `providerOptions.anthropic.structuredOutputMode: "outputFormat"`; it never asks the SDK to substitute a JSON tool. The tested exact native model IDs are `claude-sonnet-4-5`, `claude-sonnet-4-5-20250929`, `claude-haiku-4-5`, `claude-haiku-4-5-20251001`, `claude-opus-4-5`, `claude-opus-4-5-20251101`, `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-opus-4-7`, `claude-opus-4-8`, `claude-sonnet-5`, `claude-opus-5`, `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-fable-5`, and `claude-fable-5-1`. Other model IDs in native mode return a recorded `UNSUPPORTED_CAPABILITY` before an attempt or fetch. Prompt-and-validate remains available for other Anthropic model IDs, subject to actual provider access. The provider's native schema lowering relaxes some pattern and numeric bounds and oneof constraints; the recorded request retains the original descriptor schema and Anthropic lowering revision, and local Protobuf/application validation remains definitive. Credentials are supplied by trusted connection callbacks using the provider's `apiKey` or `authToken` setting; the Anthropic profile has no OAuth or subscription-login flow.

Anthropic Messages requires `max_tokens`. A connection may supply
`anthropicOutputTokenCapacity`, the output capacity that the application verified
for its exact selected model. The adapter checks a positive safe integer and
rejects this field on another provider profile; it does not discover or verify
that capacity independently. The effective wire value is the operation's explicit
`maxOutputTokens`, or the connection capacity when no operation ceiling was set.
If neither is supplied, or a supplied operation ceiling exceeds the supplied
capacity, preparation fails with `UNSUPPORTED_CAPABILITY` before inference.
The capacity does not become an application limit. Anthropic lowering revision 3
records the effective value in `promptJson.provider.maxTokens`; the request
digest and replay comparison include it. Before sending, the adapter checks that
the SDK's materialized `max_tokens` matches this recorded value. SDK clamping or
thinking-related adjustments cannot silently change it.

The decision path uses the pinned non-generative OpenRouter Jev protocol with SDK retries disabled. It forwards declared probability and score precision to definitive runtime admission and records that precision in `DecisionResponse`, including explicit zero versus absence. It does not use Ax chat correction for decisions.

The adapter guards each provider fetch by the authorized route, existing attempt ticket, durable pre-send record, cancellation, execution fence, and any configured deadline or input/output byte ceilings. The guarded fetch counts response bytes after the platform fetch has decoded transfer and content encoding; the count includes protocol framing and error response bodies. It reads one platform chunk at a time, so a chunk that crosses a configured ceiling may already have arrived before it is discarded. Any configured retained-output ceiling also counts Anthropic signatures, encrypted blocks, and serialized block overhead. The runtime supplies authenticated selection, durable journal and budget callbacks, definitive Proto/application validation, tool policy and intent handling, and recovery. Direct use of a factory outside that runtime does not provide those guarantees.

The optional MCP protocol factory uses the pinned Vercel MCP client with a custom HTTP or stdio transport. A session negotiates and discovers allowlisted tools before advertisement; accepted descriptions, input schemas, optional output schemas, and their server/tool mapping are recorded in the prepared generation request. A successful result with an advertised output schema must contain matching structured JSON; an MCP `isError` result remains a tool error without fabricating successful structured data. The adapter validates arguments against the discovered input schema and requires a runtime-reserved tool-call ticket before a physical `tools/call`. Runtime policy still decides whether a call is authorized and whether its effect is read or write. Every setup and call message uses a runtime reservation, counts decoded response bytes including errors and crossing chunks, and awaits `finishMessage` before passing a response to the MCP client. HTTP uses the configured POST endpoint without redirects, automatic GET subscriptions, or transport retries. Stdio uses a configured executable without a shell. Tool timeouts and argument/result byte ceilings are optional application settings. Setup and tool traffic obey any configured shared byte ceiling. Without one, the adapter does not add a response-size cap. Discovery follows continuation cursors without a page or tool-count ceiling; repeated cursors and duplicate tool names are rejected. Descriptions and schemas have no framework size or nesting ceiling. Unsupported schema features and binary/resource results fail explicitly. The initial MCP result contract accepts text and structured JSON only. Credential-free session identity hashes the full configured HTTP URL or the stdio executable, argument array and working directory; it does not expose those raw values, headers, or environment. The runtime must persist authorization, reservations, intent and results for durable recovery; this factory alone does not provide those guarantees.

See the [MCP configuration example](../ai/REFERENCE.md#configure-an-mcp-lookup) for the public server registration, per-tool permission and capability allowlist.

The built-in capability descriptors identify the tested provider protocol, schema or decision-output mode, guarded-fetch revision, ticket cancellation/deadline behavior, and one-call-per-ticket retry contract. The factories reject incomplete or changed descriptors. A custom provider model must route its exact Responses, Messages, or Decisions request through the supplied scoped `fetch`, honor the published model interface, and avoid separate SDK retries; the descriptor alone cannot verify a custom model's internal network behavior.

The credential-free protocol tests use the pinned `@ax-llm/ax@25.0.0`, `ai@7.0.128`, `@ai-sdk/openai@4.0.84`, `@ai-sdk/anthropic@4.0.72`, and `@openrouter/ai-sdk-provider@3.1.0`. They exercise actual SDK request shapes against local fetch fixtures, correction and tool continuation, invalid and truncated output, usage, cancellation, byte limits, journal barriers, and no-retry decisions. Run `pnpm exec vitest run packages/ai-vercel-ax/test` from the repository root.

The published AI SDK and Ax declarations produce errors under TypeScript 6 with `exactOptionalPropertyTypes`. This optional adapter's source-and-test tooling compilation and the private provider BlackBox test use `skipLibCheck: true` for vendor declarations; authored code keeps the repository's other strict checks. The general framework tooling compilation keeps `skipLibCheck: false`. The public model boundary uses direct `@ai-sdk/provider` V3/V4 interfaces, whose separate strict type fixture compiles with `skipLibCheck: false`.
