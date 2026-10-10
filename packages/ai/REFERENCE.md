# Agent AI facade reference

Audience: application developers and adapter implementers.

## Typed operations and deployments

`AiModel.define()` describes one application operation. It validates and copies
its definition synchronously; defining it does not call a provider. Input and
output are generated Protobuf descriptors. The definition includes a name,
version, finite limits, and either generation instructions or decision questions.
Register the resulting object among the Agent repository's `ai.models`.

A `ModelRef` identifies a configured deployment by name and revision.
`ModelRef.of()` creates that Protobuf value. Deployment registrations provide an
adapter, authenticated connection callbacks, and a credential-free account,
endpoint and model identity. They are separate from the application operation:
the same drafting operation can use a different permitted deployment without
putting provider SDK calls in its Entity handler.

`AiRegistry.create()` validates defaults, invocation limits, concurrency and queue
bounds. Register deployments with `register()` and configured MCP servers with
`registerTools()`. Defaults, limits and tool policy freeze when the runtime
binds the registry. `register()` can append a unique deployment afterward;
existing references and policy cannot be replaced.
Choose a generation default, a decision default, or both. A capability's kind
must match its selected deployment. The server package supplies Bounded Context and
repository integration; this package alone does not start a signal handler.

## Calls and results

Inside a signal handler, `this.ai.invoke(model, { call, conversation, input })`
returns a `Promise<AiResult<Output>>`. `call` names the logical operation within
that accepted signal, and `conversation` is an explicit `ConversationId`.
`input` must be an instance of the declared input message. On success, inspect
`value` and emit the application's domain outcome. On operational failure,
inspect `failure.code`, `retryableByNewSignal`, and `diagnosticId`. Both results
carry the operation ID. A technical handler defect can still fail the handler;
`AiResult` is not a catch-all for arbitrary application exceptions.

The runtime saves the named operation, prepared requests and received results.
Recovery reuses recorded results and rejects changed input or configuration for
an existing call. A fresh accepted signal can make a new model request and may
receive different words. The framework does not promise repeatable fresh model
output or know whether every model assertion is true.

`this.ai.select(kind, model)` records an instance preference for later signals.
Pass `undefined` to restore inheritance. The current signal keeps its selected
deployment. The repository's allowed model list remains an authorization boundary;
an instance preference cannot bypass it. See the
[server reference](../server/REFERENCE.md) for configuration precedence and
execution lifecycle.

## Generation validation and corrections

Generation explicitly chooses `native-schema` or `prompt-and-validate`.
Native schema mode requires a supported descriptor and provider profile; it does
not silently fall back to text prompting. Prompt-and-validate mode supplies the
model-facing representation and checks the resulting text locally.

Both paths parse and validate the model response against the declared output message.
A versioned `validation.check(value, input)` then applies a pure application rule.
Return concrete issues with a code, field path, and safe message. A field path can
be empty for an issue affecting the whole result. The callback receives the same
input facts as the operation; it must not fetch new data or perform side effects.

A response that fails validation may lead to a corrective request within the existing request,
time and byte limits. The correction includes the actual detected issues, and the
runtime retains that request as another attempt. It cannot describe an alleged
hallucination that no validation rule detected. Refusal, cancellation, exhausted
limits and unknown external write outcomes have explicit failure paths.

Native output schemas support a conservative descriptor subset. Unsupported
fields or options produce field-specific errors before dispatch. See the
[adapter reference](../ai-vercel-ax/REFERENCE.md) for supported provider profiles.

## Non-generative decisions

A decision capability defines boolean, choice, or score questions. The adapter
validates question IDs, answer kinds and ranges before calling the versioned
`mapping.toMessage(result, input)`. That pure callback creates the output Proto;
Proto validation and the application validation rule still apply. Optional
requirements for full probability distributions and independent question
execution must be supported by the deployment. See the
[Jev registration example](../ai-vercel-ax/README.md#openrouter-jev-decision-registration).

## Limits and tools

Capability limits cover physical model requests, tool calls, elapsed time, input
bytes, output bytes and generation tokens. Registry invocation limits also bound
all operations and recorded reads across the signal's selected handlers. Recovery
uses saved counts and deadlines. Completed exchanges charge their measured response
bytes. If the complete byte count is unknown, the full response allowance stays
reserved; interruption does not grant another free request.

Generation `maxOutputTokens` is optional. Set it only when the selected
deployment can enforce a token ceiling; an adapter that cannot enforce an
explicit ceiling rejects the call before inference. Physical request count,
tool count, deadline, input bytes, and output bytes are always required. Byte
limits bound materialized and received data, not model tokens.

Await each model call before starting the next one in the same handler. Concurrent
calls, an unfinished call when the handler returns, and reuse of a facade after
its handler finishes are programming errors.

Bounded Contexts that share one `AiRegistry` object also share its execution capacity
within that process. `concurrentOperations` bounds active Agent executions;
`queuedOperations` bounds additional work waiting in memory for capacity. Further
accepted signals remain in durable storage until capacity is available. Waiting
before a fresh execution starts does not consume its deadline. Recovery preserves
the deadline of an execution that already started. Separate registry objects and
separate processes do not share this capacity limit.

`Mcp.server()` validates an explicitly configured tool server. A generation
capability lists the server/tool references it may use. Connection and per-call
authorization receive the accepted actor, tenant and Agent scope. The runtime
records tool intent before dispatch and retains results before model continuation.
A write whose result is unknown cannot be sent again automatically. Supported
content and protocol limits are documented by the optional adapter; model text
cannot add a server, change credentials, or extend a tool's permission.

## Configure an MCP lookup

This example adds a locally running knowledge service to support drafting. Its
`lookup` tool is read-only and requires no credentials in this demonstration.
The server must expose that exact tool name. Only the configured tool is made
available to this capability. The model may request it; permission does not
force a call.

The generated message imports come from the [Support example](../../examples/support/README.md).
Supply a generation deployment created with `VercelAx.model()` as shown in the
[adapter quickstart](../ai-vercel-ax/README.md). Register `knowledgeDraft` among
the Agent repository's `ai.models`, then invoke that capability from its handler.

<!-- docs-snippet-path: examples/support/src/index.ts -->

```ts
import { AiModel, AiRegistry, Mcp, type AiBackendRegistration } from "@spine-event-engine/ai";
import { DraftSupportReplySchema } from "../generated/spine/examples/support/commands_pb.js";
import { SupportReplySchema } from "../generated/spine/examples/support/types_pb.js";

/** Drafts a reply using supplied facts and the permitted knowledge lookup. */
const knowledgeDraft = AiModel.define({
  name: "knowledge-support-reply",
  version: "1",
  kind: "generation",
  input: DraftSupportReplySchema,
  output: SupportReplySchema,
  outputMode: "prompt-and-validate",
  instructions:
    "Use the reported facts and relevant knowledge articles to draft a reply for human review.",
  tools: [{ server: "knowledge", tool: "lookup" }],
  limits: {
    modelRequests: 3,
    toolCalls: 1,
    deadlineMs: 30_000,
    maxInputBytes: 16_000,
    maxOutputBytes: 8_000,
    maxOutputTokens: 1_000,
  },
});

/** Permits only lookup on the public demonstration knowledge service. */
const knowledge = Mcp.server({
  id: "knowledge",
  revision: "1",
  transport: { kind: "streamable-http", url: "http://127.0.0.1:3333/mcp" },
  authorizeConnect: () => true,
  tools: {
    lookup: {
      effect: "read",
      timeoutMs: 5_000,
      maxArgumentBytes: 1_024,
      maxResultBytes: 4_096,
      authorize: () => true,
    },
  },
});

/**
 * Registers a local public knowledge lookup and a configured generation model.
 * @param deployment Authenticated model registration created by the application.
 * @returns Registry for BoundedContextBuilder.withAi().
 */
function supportAi(deployment: AiBackendRegistration): AiRegistry {
  return AiRegistry.create({
    defaultModels: { generation: deployment.ref },
    invocationLimits: {
      operations: 1,
      modelRequests: 3,
      toolCalls: 1,
      recordedReads: 0,
      deadlineMs: 30_000,
      totalInputBytes: 65_536,
      totalOutputBytes: 262_144,
      maxRecoveryBytes: 262_144,
    },
    concurrentOperations: 4,
    queuedOperations: 8,
  })
    .register(deployment)
    .registerTools(knowledge);
}
```

The `true` callbacks permit access to this public demonstration service. For a
restricted service, `authorizeConnect(scope, control)` checks connection access;
`tools.lookup.authorize(scope, call, control)` checks each proposed call and its
arguments. `scope` includes the accepted actor and tenant. Supply credentials with
`transport.headers(scope, control)` for HTTP, or `transport.environment(scope,
control)` for a configured stdio process. Resolve secrets in these callbacks;
do not put them in model input or recorded identity.

No MCP client or transport is created in Entity code. The selected Vercel adapter
supplies it when the operation runs. Setup traffic and tool responses consume the
invocation's byte budget, so allow space for discovery as well as model output.
See the [adapter transport limits](../ai-vercel-ax/REFERENCE.md) for supported
schemas, result content and HTTP/stdio behavior, and the
[full Agent/MCP test](../server-blackbox-tests/test/agent-vercel-mcp-blackbox.test.ts)
for an executable local protocol example.

## History and testing

Agent history is retained by its repository. `fullHistory()` returns
`AgentHistoryEntry` messages whose oneof contains a conversation record, System
Event, or emitted domain Event. The other methods read a single category:
`conversationHistory()` requires a conversation ID, `systemEventHistory()` reads
System Events, and `domainEventHistory()` reads emitted domain Events.

All four take a positive `pageSize` and an optional opaque `cursor`, return newest
entries first, and provide `nextCursor` for older records. There is no 100-record
retention limit. Page byte bounds can return fewer entries than requested. A
cursor belongs to its Agent, tenant, repository, category and conversation.
Recording is mandatory and continues through logical Entity deletion or archive.

`AiTestBackend` scripts deployment responses while `BlackBox` remains the test
entrance for Commands, Events, state and audit. See the
[Support example](../../examples/support/README.md) and
[testing reference](../testing/REFERENCE.md).

## Adapter boundary

Entity code uses the public SDK-free facade. Adapter authors use the separate
`spi/adapter` entry point. Server integration uses the internal runtime SPI;
application code must not call those controls to bypass signal handling.
Unknown usage stays absent in `AiUsage`; a reported zero has an explicit
`AiTokenCount` message. Credentials belong in application connection callbacks
and are not part of recorded model identity or diagnostic messages.
