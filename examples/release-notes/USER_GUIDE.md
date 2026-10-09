# Release Notes Studio: an Agent tutorial

A Git log tells a maintainer what changed. It rarely explains those changes in
language suitable for a release announcement. Release Notes Studio lets a
maintainer select two committed revisions, ask for a draft, inspect the cited
changes, edit the text, and approve the exact Markdown to export.

The model proposes text. The application decides which proposal to accept, and
the person decides which text to publish. There is no background generation.

This tutorial explains the implemented domain and integration APIs. See the
[README](README.md) for the current desktop build and launch instructions.

## 1. Follow one generation through the application

Suppose a document-conversion library added password-protected PDF support,
fixed page rotation, and removed a deprecated option. A maintainer chooses the
release range and asks for notes aimed at library users.

| Step                 | Responsible code                        | What happens                                                                                 | Timing                                                                             |
| -------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Choose the range     | Trusted desktop service                 | Resolves both revisions to full commit IDs and reads a bounded catalog of committed changes. | Asynchronous Git processes.                                                        |
| Submit generation    | Trusted desktop service                 | Posts `RequestReleaseGeneration` with the selected inputs and model/account reference.       | Asynchronous Command submission.                                                   |
| Accept the inputs    | `ReleaseDraft` Aggregate                | Checks the Command and emits `ReleaseGenerationRequested`.                                   | Synchronous handler; persistence and Event delivery are asynchronous.              |
| Draft the notes      | `ReleaseNotesAgent`                     | Reacts to that Event and awaits `this.ai.invoke(...)`.                                       | Asynchronous model interaction, including any MCP lookups and correction attempts. |
| Return the proposal  | `ReleaseNotesAgent`                     | Emits `ReleaseNotesProposed`, or a domain failure Event.                                     | Local result construction; persistence and delivery are asynchronous.              |
| Accept or discard it | `ReleaseDraft` Aggregate                | Applies the application's rules for whether the proposal still belongs to the draft.         | Synchronous handler; persistence and delivery are asynchronous.                    |
| Show the result      | Projection and desktop service          | Expose committed draft state and history to the renderer.                                    | Asynchronous reads and notifications; synchronous rendering.                       |
| Approve and export   | Aggregate, then trusted desktop service | Accepts the reviewed bytes; prepares them for a native file save.                            | Synchronous domain decisions, followed by asynchronous file writing.               |

An acknowledgement from `Client.post()` is not proof that all those steps have
finished. The desktop service reads the committed outcome and the Agent's
execution status. It never treats a successful submission as completed drafting.

## 2. Give the Agent an ID and state

There is one Agent instance per draft. It uses the same domain ID type as the
Aggregate, but has a separate Entity state and repository.

The following is an excerpt from [states.proto](proto/spine/examples/releasenotes/states.proto).
The first Entity-state field is its ID. Its required and validation behavior is
implicit; those options are not repeated on the field.

```proto
// Per-draft Agent progress, separate from its audited interaction history.
message ReleaseNotesAgentState {
    option (entity).kind = ENTITY;

    // Identifies the draft for which this Agent prepares notes.
    ReleaseDraftId id = 1;

    // Conversation retained for generations for this draft.
    spine.ts.agent.ConversationId conversation = 2 [(validate) = true];

    // Identifies the most recently handled generation.
    ReleaseGenerationId generation = 3 [(validate) = true];
}
```

The conversation records do not go into this state message. They are retained
separately by the Agent repository, together with System Events and the domain
Events this Agent emits.

## 3. Describe the model interaction

An `AiModel` describes a typed operation: its input and output messages,
instructions, permitted tools, limits, and application validation. It does not
contain credentials or select a user's account.

Here is the model definition used by the example. The application validator is
in [model.ts](src/domain/model.ts).

<!-- prettier-ignore-start -->
<!-- docs-snippet-path: examples/release-notes/test/release-model.test.ts -->

```ts
import { AiModel } from "@spine-event-engine/ai";

import { ReleaseGenerationRequestedSchema } from
    "../generated/spine/examples/releasenotes/events_pb.js";
import { ReleaseNotesDocumentSchema } from
    "../generated/spine/examples/releasenotes/types_pb.js";
import { ReleaseDocumentValidation } from "../src/domain/model.js";

/**
 * Drafts release notes from accepted inputs and permitted Git evidence.
 */
const draftReleaseNotes = AiModel.define({
    name: "draft-release-notes",
    version: "1",
    kind: "generation",
    input: ReleaseGenerationRequestedSchema,
    output: ReleaseNotesDocumentSchema,
    outputMode: "prompt-and-validate",
    instructions: [
        "Draft structured release notes for the supplied audience and instruction.",
        "Use only the accepted comparison and exact catalog evidence.",
        "Call the local read-only Git tools when detail is needed; cite exact commit, parent, and path.",
        "Do not invent changes or claim incomplete detail as confirmed evidence.",
        "Return sections and evidence-backed entries for human review, not an approval.",
    ].join(" "),
    tools: [
        { server: "release-git", tool: "list_release_changes" },
        { server: "release-git", tool: "read_change_patch" },
        { server: "release-git", tool: "read_release_file" },
    ],
    limits: {
        modelRequests: 3,
        toolCalls: 6,
        deadlineMs: 120_000,
        maxInputBytes: 256_000,
        maxOutputBytes: 32_000,
    },
    validation: {
        version: "1",
        check: ReleaseDocumentValidation.check,
    },
});
```
<!-- prettier-ignore-end -->

For example, a model might cite `rotation.ts` even though that file is absent
from the accepted comparison. Parsing JSON does not catch that mistake. The
application validator checks the exact commit, parent, and path against the
catalog, and returns an `UNLISTED_EVIDENCE` issue with its field path. The runtime
can include that issue in a recorded correction attempt, within the same limits.

A plain-text answer cannot become a `ReleaseNotesDocument` merely because the
model was asked for one. The adapter parses the answer, validates its structure,
and runs the application check before returning a successful typed result.
The ChatGPT plan profile uses `prompt-and-validate`; it does not promise native
schema-constrained generation. Exhausting the allowed attempts produces a failed
outcome for the handler to interpret.

These checks establish that the cited evidence belongs to the selected range.
They cannot establish that every sentence correctly explains the code. Human
review remains necessary.

The model's limits are also subject to the invocation-wide limits registered
in the Bounded Context. They are ceilings, not promised numbers of attempts.
Tool continuation and correction both consume the available model requests.

## 4. React to the accepted Event

The Agent uses `@React`, just as a Process Manager reacts to an Event. The
handler receives the accepted inputs and explicitly invokes the model operation.
It does not import a provider SDK or create an MCP client.

<!-- prettier-ignore-start -->
<!-- docs-snippet-path: examples/release-notes/src/domain/index.ts -->

```ts
import { create } from "@bufbuild/protobuf";
import { Agent, React } from "@spine-event-engine/server";

import {
    ReleaseGenerationFailedSchema,
    ReleaseNotesProposedSchema,
    type ReleaseGenerationFailed,
    type ReleaseGenerationRequested,
    type ReleaseNotesProposed,
} from "../../generated/spine/examples/releasenotes/events_pb.js";
import { ReleaseNotesAgentStateSchema } from
    "../../generated/spine/examples/releasenotes/states_pb.js";
import type { ReleaseDraftId } from
    "../../generated/spine/examples/releasenotes/types_pb.js";
import { draftReleaseNotes } from "./model.js";

/**
 * Prepares a proposal for the draft identified by this Entity's ID.
 */
class ReleaseNotesAgent extends Agent<
    ReleaseDraftId,
    typeof ReleaseNotesAgentStateSchema
> {
    /**
     * Invokes the selected model and returns a domain outcome for the Aggregate.
     *
     * @param event Accepted inputs, conversation, and evidence catalog.
     * @returns A proposal or a safe failure tied to this generation.
     */
    @React
    async onRequested(
        event: ReleaseGenerationRequested,
    ): Promise<ReleaseNotesProposed | ReleaseGenerationFailed> {
        if (!event.conversation || !event.generation || !event.inputVersion) {
            throw new TypeError("Generation requires its conversation, identity, and input Version.");
        }
        const result = await this.ai.invoke(draftReleaseNotes, {
            call: "draft-release-notes",
            conversation: event.conversation,
            input: event,
        });
        this.update((state) => {
            state.id = this.id;
            state.conversation = event.conversation;
            state.generation = event.generation;
        });
        if (!result.ok) {
            return create(ReleaseGenerationFailedSchema, {
                id: this.id,
                generation: event.generation,
                inputVersion: event.inputVersion,
                reason: result.failure.code,
                operation: result.operationId,
            });
        }
        return create(ReleaseNotesProposedSchema, {
            id: this.id,
            generation: event.generation,
            inputVersion: event.inputVersion,
            document: result.value,
            operation: result.operationId,
        });
    }
}
```
<!-- prettier-ignore-end -->

`call` identifies this invocation in the handler. It lets the runtime recognize
the saved result when continuing interrupted execution; it is not a provider
model ID. `conversation` groups related interactions. `input` is the typed,
accepted Event supplied to this operation.

The handler awaits the model. The framework records supported requests,
responses, tool calls, and outcomes as they happen. The returned domain Event
expresses what this application does with the result. A model failure does not
erase the recorded interaction.

## 5. Keep proposal acceptance in the application

While the model is working, the maintainer might edit the draft. The old
proposal must not silently replace that edit.

This example solves the problem in its Aggregate. When it accepts a generation
Command, it remembers the generation ID and the Aggregate Version associated
with those inputs. Its Event explicitly carries those values; the Agent
explicitly copies them into its result Event. The Aggregate accepts the proposal
only when it matches the pending generation. Editing or approving the draft
clears that pending generation.

These are application rules. An Agent does not automatically carry another
Entity's Version or decide whether its output is applicable.
Another application may use a different rule or accept every proposal.

The historical input Version also differs from the draft's current Version.
An acknowledgement can advance an Entity Version without changing the inputs.
The example therefore compares the returned values with its retained pending
values, not blindly with the current Version.

A draft can also change before its generation Command is handled. The Aggregate
then throws `ReleaseGenerationInputsConflict`, carrying the draft and generation
IDs. The desktop subscribes to this rejection before posting Commands, so it can
report the rejected generation and allow a fresh Command using the current
draft. No Agent execution begins for that rejected Command. This is different
from rejecting a conflicting repeat of work that was already accepted.

Approval is another explicit Command. It records the reviewed Markdown bytes
and digest. Export preparation checks the current Command Version and retained
approval; the trusted service writes only the bytes from the corresponding
`ReleaseNotesExportPrepared` Event. Neither the Agent nor the model approves or
writes a release announcement.

The desktop asks for a destination before posting the export Command. Cancelling
that dialog leaves the draft's Version unchanged. The
[macOS save dialog](https://developer.apple.com/documentation/appkit/nsopensavepaneldelegate/panel%28_%3Auserenteredfilename%3Aconfirmed%3A%29)
asks before replacing an existing file. A failed write is reported as a failure;
read the current draft before retrying. If the app stops after writing the file
but before showing success, inspect the selected destination: the file may
already exist. Reopening the app never repeats an export automatically.

## 6. Connect an authenticated model

The model definition above says what to do. A deployment registration says
which account, endpoint, and provider model can do it.

The desktop's [PlanModelSelection](src/trusted/plan-model-selection.ts) uses
`VercelAx.chatgptPlanModel()`. It selects a model returned by the signed-in
account's catalog, constructs a credential-free identity, checks that selection
before use, and obtains a current access token only inside the trusted
connection callback. See the [complete registration example](../../packages/ai-vercel-ax/README.md#chatgpt-plan-responses-registration)
for the adapter API.

Sign-in and inference are separate operations:

1. The desktop opens the official sign-in flow in the system browser, using
   PKCE, state, nonce, and its issued application registration.
2. The trusted process verifies the identity and granted permissions. Signing
   in without ChatGPT plan permission does not enable generation.
3. Credentials are retained with Electron's protected credential encryption.
   The renderer receives account labels and availability, not access tokens.
4. A generation binds the selected registration, account, endpoint, and model
   to its accepted Event. Refresh can renew that registration's credentials;
   it cannot silently substitute another account.
5. The adapter sends inference to the official Responses endpoint using that
   account's plan permission. No API-key fallback or Codex installation is used.

The Bounded Context has an `AiRegistry`. The desktop adds an authenticated
deployment after sign-in with `registry.register(...)`; it does not rebuild
the Bounded Context. The Agent repository's `resolveModel` callback selects the
deployment bound to the accepted Event. That callback is application
configuration, not Entity business logic.

The selected profile sends streamed Responses with `store: false`. Supported
conversation content is still recorded locally by the Agent repository. The
profile rejects native-schema mode and an explicit output-token ceiling;
request, tool, byte, and deadline limits remain available. It does not retry
inference outside the recorded Agent operation.

## 7. Permit only the Git tools needed for this draft

The private [Git registration](src/trusted/git-mcp-registration.ts) configures a
local stdio MCP worker. The Agent's model definition permits only three tools:

| Tool                   | Purpose                                        |
| ---------------------- | ---------------------------------------------- |
| `list_release_changes` | Read the accepted change and evidence catalog. |
| `read_change_patch`    | Read a cataloged commit/parent/path diff.      |
| `read_release_file`    | Read a cataloged committed file.               |

The model supplies tool arguments. The framework checks them against the
advertised schemas and configured policy, records the call, enforces its bounds,
and returns the supported result to the model. The worker checks membership in
the accepted catalog before reading Git objects.

The worker cannot execute an arbitrary shell command or read an arbitrary
filesystem path. It uses full commit IDs, so moving a branch after selection
does not change the accepted input. Binary, missing, or oversized detail is
reported as incomplete. Selecting another repository or a narrower range is an
application action, not something the model can do through these tools.

Repository text is untrusted input. Instructions found in a commit message,
patch, or file do not grant additional tools or authorize publishing.

## 8. Read what happened

History is recorded for every Agent. There is no recording switch. Its repository
keeps indexes for that Agent instance; the desktop does not scan all System
Events in the Bounded Context to find a few interactions.

| Method                | Entries, newest first                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `fullHistory`         | A Protobuf oneof containing a conversation record, System Event, or emitted domain Event. |
| `conversationHistory` | Conversation records for the supplied conversation ID.                                    |
| `systemEventHistory`  | System Event envelopes.                                                                   |
| `domainEventHistory`  | Domain Event envelopes emitted by this Agent.                                             |

Each call reads a page. Its `nextCursor` reads older entries. A page size is not
a retention limit; continue until no cursor remains. The page byte bound can
return fewer entries than requested.

A trusted application can obtain the registered repository and read a page:

<!-- prettier-ignore-start -->
<!-- docs-snippet-path: examples/release-notes/src/trusted/studio-service.ts -->

```ts
import type { AgentHistoryCursor } from "@spine-event-engine/ai";
import type { BoundedContext } from "@spine-event-engine/server";

import type { ReleaseDraftId } from
    "../../generated/spine/examples/releasenotes/types_pb.js";
import { ReleaseNotesAgent } from "../domain/index.js";

/**
 * Reads one page for a draft already authorized by the trusted application.
 *
 * @param boundedContext Running ReleaseNotes Bounded Context.
 * @param id Agent's typed draft ID.
 * @param cursor Continuation returned by the previous page, when present.
 * @returns The next newest-first page and its continuation toward older entries.
 */
async function readHistory(
    boundedContext: BoundedContext,
    id: ReleaseDraftId,
    cursor?: AgentHistoryCursor,
) {
    const repository = boundedContext.getRepository(ReleaseNotesAgent);
    return repository.agentHistory(id, {}).fullHistory({
        pageSize: 25,
        ...(cursor ? { cursor } : {}),
    });
}
```
<!-- prettier-ignore-end -->

The empty scope selects this single-tenant Bounded Context. A multitenant
application supplies its authorized tenant ID. Repository access does not grant
a remote caller permission automatically; the trusted bridge must check access.

Inside an Agent handler, the same four history methods are protected Entity
methods. For example, `await this.conversationHistory({ conversation, pageSize: 25 })`
reads prior records for an explicit conversation. Reading history does not
itself send that history to the model or invoke a model. The handler must decide
which information belongs in the next typed input.

The Agent's emitted domain history contains proposals and failures. The
Aggregate's later acceptance and approval Events belong to the Aggregate, not
to the Agent's `domainEventHistory`.

The repository also exposes `agentExecution(id, sourceSignalId, scope)`.
`accepted`, `active`, and `completed-pending-delivery` are not completion.
`completed` and `terminated` are terminal; a missing record means unknown.
The desktop uses these distinctions when deciding whether another generation
can begin.

If Command submission remains unconfirmed, the desktop retains its original
inputs and offers an explicit retry. That action repeats the saved Command with
the same generation ID and model selection. The Aggregate's receipts prevent
an already accepted generation from starting again. This retry behavior is
application code; the desktop does not repost automatically.

A confirmed `ReleaseGenerationInputsConflict` is retained as an application
outcome, including after renderer reload. The desktop hides the unconfirmed
retry action and allows a fresh generation. If the rejection has not been
observed, a timeout still means unknown; the desktop keeps the original work
locked. Command acknowledgement alone does not establish the Aggregate's
business outcome.

Some failures happen before the handler starts. For example, an explicit model
authorization denial terminates the execution and records
`AgentInvocationTerminated` with reason `MODEL_USE_DENIED`. No model call is made,
and no application domain Event is invented for that denial. The desktop can
read the terminal status and its System Event even though the handler did not run.

## 9. Test through BlackBox

Use `BlackBox` to post Commands, inspect domain outcomes, and inspect retained
Agent history. A scripted AI backend is useful for application decisions; real
protocol fixtures are useful for adapter and MCP integration.

The example's [domain tests](test/release-domain.test.ts) exercise stale edits,
proposal acceptance, duplicate generation, approval, and export without a live
account. Its [Agent integration test](test/release-agent.test.ts) combines
`BlackBox`, the actual Responses adapter, a controlled provider stream, and a
real local Git MCP worker. It deliberately returns an unlisted citation before
a corrected document, proving that the first parsed answer is not automatically
accepted.

See the [testing reference](../../packages/testing/REFERENCE.md) for
`AiTestBackend`, `BlackBox.readAgentHistory`, and System Event assertions. Tests
must use domain-correct Commands and Events; an Entity state is not a Command
just because its fields resemble one.

## 10. Understand what lasts

Drafts, Entity state, generation receipts, conversation records, and Event
history use in-memory storage. Reloading the renderer keeps the backend session.
Ending the backend process loses that session. Saved sign-in registrations and
explicitly exported Markdown are separate persisted data.

The application runs locally, but inference runs at OpenAI. Selected repository
content can be sent there as model input or a tool result. Export before quitting
if you want to keep the approved release notes. Reopening the app does not
reconstruct drafts from credentials or automatically repeat generation.

Closing the window during active or unconfirmed generation offers **Wait** and
**Stop and quit**. Wait keeps the window and backend session running. Stop and
quit closes the Bounded Context before the window. Local cancellation does not
prove that the provider did no work or consumed no plan usage.

The reusable Agent behavior is typed invocation, bounded attempts and tools,
authorization hooks, recorded interactions, saved execution progress, and indexed
history. The release workflow—including Git policy, proposal acceptance,
approval, account selection UI, and file export—is this application's code.
