# Vercel and Ax adapter reference

Audience: coding agents implementing or checking provider registrations and adapter behavior.

`VercelAx.model()` registers OpenAI Responses with `VercelAx.capabilities.openAIResponses()` or Anthropic Messages with `VercelAx.capabilities.anthropicMessages()`. `VercelDecision.model()` registers an OpenRouter Jev decision backend with `VercelDecision.capabilities.openRouterJev()`. Both factories accept a semantic `ModelRef`, trusted identity and authorization callbacks, and a connection callback that constructs a published Vercel provider model using the supplied operation-scoped `fetch`. The connection returns that model and the same credential-free identity that the runtime authorized. Registration and connection do not dispatch a model request.

`VercelAx.chatgptPlanModel()` selects the separate ChatGPT plan Responses
profile at `/v1/responses`. It uses the same identity, authorization, and
guarded-fetch controls. The trusted application supplies a nonempty OAuth
access token through its connection callback; the adapter sets the pinned
OpenAI SDK's `apiKey`, endpoint, and guarded fetch explicitly. This lower-level
factory does not sign in or refresh credentials. It does not fall back to
ambient API key or base URL settings. The generic `VercelAx.model()` rejects this profile. See
the [complete registration example](#chatgpt-plan-responses-registration).
This profile sends `stream: true`, `store: false`, developer instructions,
stateless input, and `reasoning.encrypted_content`. Local functions use a
`spine_mcp` namespace. It accepts prompt-and-validate output only. A requested
`maxOutputTokens` ceiling or native-schema mode fails with
`UNSUPPORTED_CAPABILITY` before an inference attempt. The existing API-key
OpenAI and Anthropic profiles continue to support explicit token ceilings.
The profile retains ordered typed response items for continuation within the running invocation;
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
conversation history. See the [sign-in example](#sign-in-with-a-chatgpt-plan).

Pass a cancellation signal to `complete()` when the application may close while
sign-in is finishing. Cancellation also invalidates a grant whose credential save
finishes late. The application must still close its browser callback listener.

The generation path uses Ax to render requests, correct invalid output subject to any configured model-request ceiling, and continue after recorded tool proposals. Direct Vercel provider streams carry native descriptor-derived JSON schemas or prompt-and-validate instructions. The adapter preserves raw output, ordered provider tool proposals, actual model identity when reported, token usage with absent counts distinct from zero, and safe failure categories. For Anthropic Messages, the live response sequence also records ordered text, signed thinking, redacted thinking, and tool blocks. The adapter rebuilds the exact assistant block order from that sequence for tool and correction requests during the running invocation; incomplete thinking never authorizes a continuation. It records each physical attempt before tool authorization or a second model request. A runtime denial ends with `TOOL_FAILED`; an unresolved tool write ends with `TOOL_OUTCOME_UNKNOWN`. Neither becomes a fabricated tool result.

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
digest and live request validation include it. Before sending, the adapter checks that
the SDK's materialized `max_tokens` matches this recorded value. SDK clamping or
thinking-related adjustments cannot silently change it.

The decision path uses the pinned non-generative OpenRouter Jev protocol with SDK retries disabled. It forwards declared probability and score precision to definitive runtime admission and records that precision in `DecisionResponse`, including explicit zero versus absence. It does not use Ax chat correction for decisions.

The adapter guards each provider fetch by the authorized route, existing attempt ticket, live pre-send admission, cancellation, execution fence, and any configured deadline or input/output byte ceilings. The guarded fetch counts response bytes after the platform fetch has decoded transfer and content encoding; the count includes protocol framing and error response bodies. It reads one platform chunk at a time, so a chunk that crosses a configured ceiling may already have arrived before it is discarded. Any configured retained-output ceiling also counts Anthropic signatures, encrypted blocks, and serialized block overhead. The runtime supplies authenticated selection, live audit and budget callbacks, definitive Proto/application validation, tool policy and intent handling for the running invocation. Direct use of a factory outside that runtime does not provide those guarantees.

The optional MCP protocol factory uses the pinned Vercel MCP client with a custom HTTP or stdio transport. A session negotiates and discovers allowlisted tools before advertisement; accepted descriptions, input schemas, optional output schemas, and their server/tool mapping are recorded in the prepared generation request. A successful result with an advertised output schema must contain matching structured JSON; an MCP `isError` result remains a tool error without fabricating successful structured data. The adapter validates arguments against the discovered input schema and requires a runtime-reserved tool-call ticket before a physical `tools/call`. Runtime policy still decides whether a call is authorized and whether its effect is read or write. Every setup and call message uses a runtime reservation, counts decoded response bytes including errors and crossing chunks, and awaits `finishMessage` before passing a response to the MCP client. HTTP uses the configured POST endpoint without redirects, automatic GET subscriptions, or transport retries. Stdio uses a configured executable without a shell. Tool timeouts and argument/result byte ceilings are optional application settings. Setup and tool traffic obey any configured shared byte ceiling. Without one, the adapter does not add a response-size cap. Discovery follows continuation cursors without a page or tool-count ceiling; repeated cursors and duplicate tool names are rejected. Descriptions and schemas have no framework size or nesting ceiling. Unsupported schema features and binary/resource results fail explicitly. The initial MCP result contract accepts text and structured JSON only. Credential-free session identity hashes the full configured HTTP URL or the stdio executable, argument array and working directory; it does not expose those raw values, headers, or environment. The runtime must retain authorization, reservations, intent, and results for the running invocation and append genuine audit records; this factory alone does not provide those guarantees.

See the [MCP configuration example](../ai/REFERENCE.md#configure-an-mcp-lookup) for the public server registration, per-tool permission and capability allowlist.

The built-in capability descriptors identify the tested provider protocol, schema or decision-output mode, guarded-fetch revision, ticket cancellation/deadline behavior, and one-call-per-ticket retry contract. The factories reject incomplete or changed descriptors. A custom provider model must route its exact Responses, Messages, or Decisions request through the supplied scoped `fetch`, honor the published model interface, and avoid separate SDK retries; the descriptor alone cannot verify a custom model's internal network behavior.

The credential-free protocol tests use the pinned `@ax-llm/ax@25.0.0`, `ai@7.0.128`, `@ai-sdk/openai@4.0.84`, `@ai-sdk/anthropic@4.0.72`, and `@openrouter/ai-sdk-provider@3.1.0`. They exercise actual SDK request shapes against local fetch fixtures, correction and tool continuation, invalid and truncated output, usage, cancellation, byte limits, live attempt barriers, and no-retry decisions. Run `pnpm exec vitest run packages/ai-vercel-ax/test` from the repository root.

The published AI SDK and Ax declarations produce errors under TypeScript 6 with `exactOptionalPropertyTypes`. This optional adapter's source-and-test tooling compilation and the private provider BlackBox test use `skipLibCheck: true` for vendor declarations; authored code keeps the repository's other strict checks. The general framework tooling compilation keeps `skipLibCheck: false`. The public model boundary uses direct `@ai-sdk/provider` V3/V4 interfaces. The adapter tooling compilation checks the provider boundary fixture's assignments and type equality against those pinned SDK interfaces.

## Registration examples and provider-specific configuration

The following complete examples preserve the provider-specific setup paths. They are technical reference material for coding agents; begin with the [package README](README.md) for the ordinary application flow.

## Sign in with a ChatGPT plan

`VercelAx.chatgptPlanSession()` provides browser authorization, token verification
and refresh, account model discovery, and sign-out. Configure it in the trusted
server or desktop process. The application supplies credential persistence and
opens the system browser; it does not implement the OAuth exchange.

<!-- prettier-ignore-start -->
<!-- docs-snippet-path: packages/ai-vercel-ax/test/factory.test.ts -->

```ts
import {
    VercelAx,
    type ChatgptPlanCredentialStore,
    type ChatgptPlanSession,
} from "@spine-event-engine/ai-vercel-ax";

/**
 * Connects the application credential store to ChatGPT sign-in.
 *
 * @param credentials Trusted credential store; encrypt grants at rest if persisted.
 * @returns Session shared by sign-in and model registration.
 */
function createPlanSession(credentials: ChatgptPlanCredentialStore) {
    return VercelAx.chatgptPlanSession({
        agentName: "Release Notes Studio",
        credentials,
    });
}

/**
 * Completes sign-in using a loopback listener supplied by the desktop app.
 *
 * @param session Configured ChatGPT session.
 * @param redirectUri URL of the already listening local callback server.
 * @param onOpenBrowser Opens the authorization URL in the system browser.
 * @param onReceiveCallback Waits for the browser callback URL.
 * @returns Verified account details without tokens.
 */
async function signIn(
    session: ChatgptPlanSession,
    redirectUri: string,
    onOpenBrowser: (url: string) => Promise<void>,
    onReceiveCallback: () => Promise<URL>,
) {
    const attempt = await session.begin(redirectUri);
    await onOpenBrowser(attempt.authorizationUrl);
    return session.complete(attempt, await onReceiveCallback());
}
```
<!-- prettier-ignore-end -->

Keep the session and authorization attempt in the trusted process. Only the
browser URL goes to the browser. `accounts()` returns account details suitable
for display; `models(clientId)` returns the account's available model choices.
`signOut(clientId, signal?)` attempts remote revocation, clears local tokens even
if cancelled, and reports whether revocation was confirmed. The application closes
its local callback listener when sign-in ends or the window closes.

Register the selected model without retrieving access tokens in application code:

<!-- prettier-ignore-start -->
<!-- docs-snippet-path: packages/ai-vercel-ax/test/factory.test.ts -->

```ts
import { type AiScope, type ModelRef } from "@spine-event-engine/ai";
import { type ChatgptPlanSession } from "@spine-event-engine/ai-vercel-ax";

/**
 * Creates a deployment for the account and model selected in the application.
 *
 * @param session Configured session with a completed sign-in.
 * @param ref Application deployment reference for AiRegistry.
 * @param clientId Selected account's issued client ID.
 * @param model Exact slug returned by the account's model catalog.
 * @param onAuthorize Checks whether the accepted signal may use this selection.
 * @returns Deployment to register in AiRegistry.
 */
function selectedPlanModel(
    session: ChatgptPlanSession,
    ref: ModelRef,
    clientId: string,
    model: string,
    onAuthorize: (scope: AiScope) => boolean | Promise<boolean>,
) {
    return session.model({ ref, clientId, model, authorizeUse: onAuthorize });
}
```
<!-- prettier-ignore-end -->

The session binds the deployment to the selected account and model, refreshes
its credential when needed, and rechecks the application permission callback.
Agent handlers continue to use `this.ai.invoke(...)`; they receive no tokens or
provider clients. See [Release Notes Studio](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/release-notes/README.md)
for its native browser callback and in-memory trusted credential store.

## ChatGPT plan Responses registration

Use `VercelAx.chatgptPlanModel()` for an account with ChatGPT plan inference permission.
This lower-level factory is available when the application already has its own
sign-in and token service. Otherwise, use `chatgptPlanSession()` above. The factory
accepts the selected account and model through the same
trusted identity and authorization callbacks as the API-key profile. Its
connection callback returns a nonempty OAuth access token. The adapter binds
that token and the authorized endpoint explicitly to the pinned OpenAI SDK,
without reading ambient `OPENAI_API_KEY` or `OPENAI_BASE_URL`.

<!-- prettier-ignore-start -->
<!-- docs-snippet-path: packages/ai-vercel-ax/test/factory.test.ts -->

```ts
import { ModelRef, type AiConnectionIdentity, type AiScope } from "@spine-event-engine/ai";
import { VercelAx } from "@spine-event-engine/ai-vercel-ax";

interface PlanConnectionService {
    identity(scope: AiScope): Promise<AiConnectionIdentity>;
    permits(scope: AiScope, identity: AiConnectionIdentity): Promise<boolean>;
    accessToken(scope: AiScope, identity: AiConnectionIdentity): Promise<string>;
}

/**
 * Registers a selected ChatGPT plan account and discovered model.
 *
 * @param plan Trusted application session and token service.
 * @returns An Agent generation deployment registration.
 */
function registerPlanModel(plan: PlanConnectionService) {
    return VercelAx.chatgptPlanModel({
        ref: ModelRef.of("release-notes-plan", "registration-1-model-1"),
        resolveIdentity: (scope) => plan.identity(scope),
        authorizeUse: (scope, identity) => plan.permits(scope, identity),
        connect: async (scope, expected) => {
            const accessToken = await plan.accessToken(scope, expected);
            return { accessToken, identity: expected };
        },
    });
}
```
<!-- prettier-ignore-end -->

The service must obtain and bind `identity`, `permits`, and `accessToken` to the same
registration and selected model. Use `https://api.openai.com/v1` as the
credential-free endpoint in its identity. Keep tokens in the trusted process;
the adapter records the credential-free deployment identity and request/response history.
Define the generation capability with `outputMode: "prompt-and-validate"` and
omit `maxOutputTokens`. An explicit token ceiling and native-schema mode are
rejected before inference for this profile. Request count, tool count, byte,
and deadline ceilings are optional application settings. Omitted settings do not
impose a framework default.

The profile sends stateless streamed Responses with developer instructions,
`store: false`, and encrypted reasoning included for local tool continuation.
Only a `response.completed` terminal event can admit output. Corrections and
tool continuations use new recorded attempt tickets. This profile does not
perform sign-in or retry a failed inference outside the Agent runtime.

For local MCP tools, discovery accepts the pinned server SDK's root
`https://json-schema.org/draft/2020-12/schema` declaration and records the
equivalent schema without that dialect marker. Discovery rejects unknown dialects,
remote references and unsupported keywords before a model request. Discovery
traffic is counted against any application-configured byte ceiling.
Denied MCP connection authorization becomes a saved, nonretryable
`AUTHENTICATION_REQUIRED` Agent result. Unsupported tool discovery
becomes `UNSUPPORTED_CAPABILITY` during setup. Transport, cancellation, audit,
and storage faults in that setup still reject the execution rather than becoming
model results. Later tool-call failures have their separate recorded tool
outcomes.

## Anthropic Messages registration

Install `@ai-sdk/anthropic@4.0.72`. Give `createAnthropic` the scoped fetch and a secret supplied by your application. The native-schema mode is tested with the exact model IDs listed in [REFERENCE.md](REFERENCE.md); `prompt-and-validate` can use other Anthropic model IDs, subject to provider access and the usual local validation.

<!-- prettier-ignore-start -->
<!-- docs-snippet-path: packages/ai-vercel-ax/test/factory.test.ts -->

```ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { ModelRef } from "@spine-event-engine/ai";
import { VercelAx } from "@spine-event-engine/ai-vercel-ax";

/**
 * Registers Claude for support replies using the selected model's capacity.
 *
 * @param apiKey Secret for the configured Anthropic account.
 * @param outputTokenCapacity Provider-verified output capacity for this exact model.
 * @returns Generation deployment to register in AiRegistry.
 */
function registerClaude(apiKey: string, outputTokenCapacity: number) {
    const identity = {
        provider: "anthropic",
        account: "support-account",
        endpoint: "https://api.anthropic.com/v1",
        model: "claude-sonnet-4-5",
    };

    return VercelAx.model({
        ref: ModelRef.of("support-reply", "r1"),
        capabilities: VercelAx.capabilities.anthropicMessages(),
        resolveIdentity: () => identity,
        authorizeUse: () => true,
        connect: (_scope, expected, control) => ({
            model: createAnthropic({
                apiKey,
                baseURL: expected.endpoint,
                fetch: control.fetch,
            }).messages(expected.model),
            identity: expected,
            anthropicOutputTokenCapacity: outputTokenCapacity,
        }),
    });
}
```
<!-- prettier-ignore-end -->

Anthropic requires `max_tokens` in every Messages request. Supply the selected
model's verified capacity, for example from its `max_tokens` field in the
[Models API](https://platform.claude.com/docs/en/api/models/retrieve).
`anthropicOutputTokenCapacity` describes that provider constraint. It does not add
an application budget to `AiModel`. An explicitly configured `maxOutputTokens`
ceiling takes precedence; a ceiling above a supplied capacity is rejected.
Without either value, the adapter reports `UNSUPPORTED_CAPABILITY` before
inference instead of guessing. It records the effective value with the request
and rejects SDK changes to that value before sending.

Replace the example's identity and authorization callbacks with checks against
the authenticated application scope. If your application supplies bearer tokens,
pass its scoped token source to this registration function:

<!-- prettier-ignore-start -->
<!-- docs-snippet-path: packages/ai-vercel-ax/test/factory.test.ts -->

```ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { ModelRef, type AiScope } from "@spine-event-engine/ai";
import { VercelAx } from "@spine-event-engine/ai-vercel-ax";

/**
 * Registers Anthropic Messages with a trusted application token source.
 *
 * @param tokens Application hook that supplies a bearer token for the authenticated scope.
 * @param outputTokenCapacity Provider-verified output capacity for this exact model.
 * @returns Guarded generation registration.
 */
function registerWithToken(
    tokens: { forScope(scope: AiScope): Promise<string> },
    outputTokenCapacity: number,
) {
    /**
     * Credential-free deployment used for authorization and routing.
     */
    const identity = {
        provider: "anthropic",
        account: "support-account",
        endpoint: "https://api.anthropic.com/v1",
        model: "claude-sonnet-4-5",
    };

    return VercelAx.model({
        ref: ModelRef.of("support-reply", "r1"),
        capabilities: VercelAx.capabilities.anthropicMessages(),
        resolveIdentity: () => identity,
        authorizeUse: () => true,
        connect: async (scope, expected, control) => ({
            model: createAnthropic({
                authToken: await tokens.forScope(scope),
                baseURL: expected.endpoint,
                fetch: control.fetch,
            }).messages(expected.model),
            identity: expected,
            anthropicOutputTokenCapacity: outputTokenCapacity,
        }),
    });
}
```
<!-- prettier-ignore-end -->

The application implements `forScope` and checks deployment permission in `authorizeUse`. The provider accepts either `apiKey` or `authToken`; the adapter does not provide OAuth login, subscription login, or credential acquisition. Credentials stay in the trusted connection callback and out of the recorded request.

## OpenRouter Jev decision registration

Install the pinned provider separately with `pnpm add @openrouter/ai-sdk-provider@3.1.0`. The Decisions endpoint is the credential-free identity endpoint; `evaluationModel()` uses the pinned provider's non-generative Decisions protocol.

<!-- prettier-ignore-start -->
<!-- docs-snippet-path: packages/ai-vercel-ax/test/factory.test.ts -->

```ts
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ModelRef } from "@spine-event-engine/ai";
import { VercelDecision } from "@spine-event-engine/ai-vercel-ax";

const decisionIdentity = {
    provider: "openrouter",
    account: "support-account",
    endpoint: "https://openrouter.ai/api/alpha",
    model: "typesafe/jev-1.13",
};
const decisionRegistration = VercelDecision.model({
    ref: ModelRef.of("support-routing", "r1"),
    capabilities: VercelDecision.capabilities.openRouterJev(),
    resolveIdentity: () => decisionIdentity,
    authorizeUse: () => true,
    connect: (_scope, _expected, control) => ({
        model: createOpenRouter({
            apiKey: "configured-secret",
            decisionsBaseURL: decisionIdentity.endpoint,
            fetch: control.fetch,
        }).evaluationModel(decisionIdentity.model),
        identity: decisionIdentity,
    }),
});
```
<!-- prettier-ignore-end -->

Use an application secret source for `apiKey`; the example does not dispatch a request.
