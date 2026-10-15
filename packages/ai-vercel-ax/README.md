# Connect an Agent to a model provider

An Agent's model task describes _what_ it needs, such as a typed support reply. This optional adapter connects that task to a permitted model provider. The application configures an account and credentials outside the Agent handler; the handler keeps calling `this.ai.invoke(...)` without provider SDK code. The package is currently an experimental snapshot.

## Install

For the OpenAI Responses example, install the adapter, AI facade, and provider SDK:

```sh
pnpm add @spine-event-engine/ai-vercel-ax@snapshot @spine-event-engine/ai@snapshot @ai-sdk/openai@4.0.84
```

## Connect OpenAI Responses

The application registers a deployment: an account and model that may carry out a typed task. It supplies a secret in a trusted process and an authorization callback that checks the accepted request. The Agent handler sees neither the secret nor a provider client.

<!-- prettier-ignore-start -->

<!-- docs-snippet-path: packages/ai-vercel-ax/test/factory.test.ts -->

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { AiRegistry, ModelRef, type AiScope } from "@spine-event-engine/ai";
import { VercelAx } from "@spine-event-engine/ai-vercel-ax";

/**
 * Connects the support reply task to an authorized OpenAI model.
 *
 * @param apiKey Secret supplied by the trusted application configuration.
 * @param onAuthorize Checks whether this accepted request may use the model.
 * @returns Registry to attach to the application's Bounded Context.
 */
function createSupportRegistry(
    apiKey: string,
    onAuthorize: (scope: AiScope) => boolean | Promise<boolean>,
) {
    const identity = {
        provider: "openai",
        account: "support-account",
        endpoint: "https://api.openai.com/v1",
        model: "configured-model-id",
    };
    const registration = VercelAx.model({
        ref: ModelRef.of("support-reply", "r1"),
        capabilities: VercelAx.capabilities.openAIResponses(),
        resolveIdentity: () => identity,
        authorizeUse: (scope) => onAuthorize(scope),
        connect: (_scope, expected, control) => ({
            model: createOpenAI({
                apiKey,
                baseURL: expected.endpoint,
                fetch: control.fetch,
            }).responses(expected.model),
            identity: expected,
        }),
    });
    return AiRegistry.create({
        defaultModels: { generation: registration.ref },
    }).register(registration);
}
```

<!-- prettier-ignore-end -->

Pass this registry to the application's Bounded Context with `withAi(registry)`. The Agent can then invoke the [typed support reply task](../ai/README.md). Its handler inspects the result and constructs a domain Event for review. Registration itself does not send a request. The application supplies a real model ID and decides authorization for each accepted request.

## Use a ChatGPT plan

A local desktop app can let a person sign in through the system browser instead of configuring an API key. `chatgptPlanSession()` handles the sign-in exchange and token refresh. The app still supplies a trusted credential store and receives the browser callback. The browser receives the authorization URL, never the tokens.

<!-- prettier-ignore-start -->

<!-- docs-snippet-path: packages/ai-vercel-ax/test/factory.test.ts -->

```ts
import { ModelRef, type AiScope } from "@spine-event-engine/ai";
import {
    VercelAx,
    type ChatgptPlanCredentialStore,
} from "@spine-event-engine/ai-vercel-ax";

/**
 * Signs in and registers the model selected from the account catalog.
 *
 * @param credentials Trusted credential store supplied by the application.
 * @param redirectUri URL of the application's listening local callback server.
 * @param onOpenBrowser Opens the authorization URL in the system browser.
 * @param onReceiveCallback Waits for the browser callback URL.
 * @param onAuthorize Checks whether an accepted request may use the selection.
 * @returns The session and registration for the selected account and model.
 */
async function selectPlanModel(
    credentials: ChatgptPlanCredentialStore,
    redirectUri: string,
    onOpenBrowser: (url: string) => Promise<void>,
    onReceiveCallback: () => Promise<URL>,
    onAuthorize: (scope: AiScope) => boolean | Promise<boolean>,
) {
    const session = VercelAx.chatgptPlanSession({
        agentName: "Release Notes Studio",
        credentials,
    });
    const attempt = await session.begin(redirectUri);
    await onOpenBrowser(attempt.authorizationUrl);
    const account = await session.complete(attempt, await onReceiveCallback());
    const models = await session.models(account.clientId);
    const selected = models[0];
    if (selected === undefined) throw new Error("This account has no available model.");
    const registration = await session.model({
        ref: ModelRef.of("release-notes-plan", "r1"),
        clientId: account.clientId,
        model: selected.slug,
        authorizeUse: onAuthorize,
    });
    return { session, registration };
}
```

<!-- prettier-ignore-end -->

The example chooses the first returned model only to show the wiring; a UI should let the person select from `models(clientId)`. Register the returned deployment with `AiRegistry` as above. Close the local callback listener after sign-in, and keep the session and credential store in the trusted process. ChatGPT plan generation uses `prompt-and-validate`; see [Release Notes Studio](../../examples/release-notes/README.md) for the complete desktop flow.

## Use Anthropic Messages

Install `@ai-sdk/anthropic@4.0.72`. Anthropic Messages requires an output-token value. Supply the verified output capacity for the exact model you select, for example from its [Models API](https://platform.claude.com/docs/en/api/models/retrieve). This provider setting is needed to form a request; it is distinct from any optional application ceiling on a task.

<!-- prettier-ignore-start -->

<!-- docs-snippet-path: packages/ai-vercel-ax/test/factory.test.ts -->

```ts
import { createAnthropic } from "@ai-sdk/anthropic";
import { ModelRef, type AiScope } from "@spine-event-engine/ai";
import { VercelAx } from "@spine-event-engine/ai-vercel-ax";

/**
 * Registers a permitted Anthropic model for support replies.
 *
 * @param apiKey Secret for the configured Anthropic account.
 * @param outputTokenCapacity Provider-verified capacity for the selected model.
 * @param onAuthorize Checks whether the accepted request may use this model.
 * @returns Deployment to add to AiRegistry.
 */
function registerClaude(
    apiKey: string,
    outputTokenCapacity: number,
    onAuthorize: (scope: AiScope) => boolean | Promise<boolean>,
) {
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
        authorizeUse: (scope) => onAuthorize(scope),
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

Add this registration to `AiRegistry` and select it as the generation default or explicitly for an Agent. See the [coding-agent reference](REFERENCE.md#anthropic-messages-registration) for supported output modes and exact provider behavior.

## Use an OpenRouter decision model

A decision task asks for a typed answer, such as a choice, rather than drafted text. Install `@openrouter/ai-sdk-provider@3.1.0` to use the supported Jev Decisions profile.

<!-- prettier-ignore-start -->

<!-- docs-snippet-path: packages/ai-vercel-ax/test/factory.test.ts -->

```ts
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ModelRef, type AiScope } from "@spine-event-engine/ai";
import { VercelDecision } from "@spine-event-engine/ai-vercel-ax";

/**
 * Registers an authorized OpenRouter decision deployment.
 *
 * @param apiKey Secret supplied by the trusted application.
 * @param onAuthorize Checks whether the accepted request may use this model.
 * @returns Decision deployment to add to AiRegistry.
 */
function registerDecision(
    apiKey: string,
    onAuthorize: (scope: AiScope) => boolean | Promise<boolean>,
) {
    const identity = {
        provider: "openrouter",
        account: "support-account",
        endpoint: "https://openrouter.ai/api/alpha",
        model: "typesafe/jev-1.13",
    };
    return VercelDecision.model({
        ref: ModelRef.of("support-routing", "r1"),
        capabilities: VercelDecision.capabilities.openRouterJev(),
        resolveIdentity: () => identity,
        authorizeUse: (scope) => onAuthorize(scope),
        connect: (_scope, expected, control) => ({
            model: createOpenRouter({
                apiKey,
                decisionsBaseURL: expected.endpoint,
                fetch: control.fetch,
            }).evaluationModel(expected.model),
            identity: expected,
        }),
    });
}
```

<!-- prettier-ignore-end -->

For applications that already have a ChatGPT token service, or for protocol and tool details, use the [coding-agent reference](REFERENCE.md).
