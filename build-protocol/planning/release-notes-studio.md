# Release Notes Studio

## Purpose and scope

Build a small desktop example in the existing Agent PR. A developer selects a
local Git repository and a release range, then gets release notes with links to
the changes that support them. The developer can ask for changes, edit the
text, approve a version, and export Markdown.

The example must demonstrate useful Agent behavior: signal-triggered model
work, typed results, MCP tools, stateful Entities, bounded correction attempts,
account-aware configuration, and readable conversation and Event history.

This is an implementation plan. Names explicitly marked as proposed are new
contracts to implement; other APIs must be checked against their declarations
before writing tutorial snippets.

The first desktop target is macOS. Use Electron with a Node.js runtime meeting
the repository's Node 24 minimum, React, and TypeScript. Keep the application
portable where practical; Windows/Linux installers and their credential stores
are outside this first example. Development launch and a locally packaged macOS
application are both required. Signing and notarization are not release gates
for this source example.

The first version uses the existing in-memory storage provider. Drafts, Entity
state, and history last for the application process lifetime. Saved sign-in
credentials and exported Markdown are separate, explicitly persisted data.
Persistent domain storage and restart recovery are a later milestone, not a
requirement for this first example.

The application runs locally. Inference uses OpenAI over the network. Repository content selected for drafting is therefore sent to
OpenAI. Explain this before the first generation Command. Do not call the app
offline or imply that inference happens on the machine.

Include:

- Local repository selection and comparisons between two committed revisions.
- User-facing and developer-facing release notes.
- Explicit Commands to draft or change notes; no background autonomous work.
- Evidence beside each generated entry.
- Manual editing, version-specific approval, and Markdown export.
- Sign in with ChatGPT, saved registrations, account selection, reconnection,
  and models available to that registration.
- All inference through the existing Agent AI facade using the ChatGPT plan.
- In-memory drafts, Entity state, domain Events, System Events, conversation
  records, and execution records, with mandatory recording during the session.
- A history panel with pagination for that session.

Exclude issue trackers, GitHub authentication, pushing, release publication,
working-tree analysis, code modification, shell tools offered to the model,
embeddings, background repository watching, and API-key fallback. Git must be
installed; show a useful startup error if it is missing. No Codex installation,
terminal login, Docker, or separately installed database may be required.

## What a person does

For example, a maintainer prepares notes for a document-conversion library.
Between `v1.7.0` and `v1.8.0`, it gained password-protected PDF support, fixed
incorrect page rotation, and removed a deprecated option.

1. Open Release Notes Studio and choose **Continue with ChatGPT**. The system
   browser handles sign-in. Back in the app, see the connected account, selected
   model, and whether ChatGPT plan usage is enabled.
2. Choose the local repository, the two revisions, an audience, and an optional
   instruction such as “Call out changes that require users to update code.”
3. Inspect the resolved comparison and press **Draft release notes**. This sends
   a Command. It does not call the model from the React component.
4. The Agent asks the model to produce release-note entries. When more detail
   is needed, the model can request a permitted local Git tool. The screen shows
   progress and retains the previous draft until a replacement is accepted.
5. Review entries grouped into features, fixes, and breaking changes. Each entry
   exposes the commit and file evidence used to produce it. Unsupported claims
   must not be treated as established facts merely because the output parsed.
6. Request “Explain the removed option and its replacement more clearly.” This
   is another accepted signal and another recorded operation in the same draft's
   conversation. It includes the current text and the submitted instruction.
7. Edit the text directly if needed. Approve the exact version displayed, then
   export it to a chosen Markdown file. The model does not approve or export it.
8. Export before quitting. Reopening restores saved sign-in registrations, but
   starts with no drafts or history. State that limitation clearly in the app.

No claim of perfect factual accuracy is made. Local validation can check that a
cited commit/file exists within the selected comparison; a human still reviews
whether the explanation is accurate.

## Execution and application boundaries

Use one Bounded Context, named `ReleaseNotes`, one main Aggregate type,
`ReleaseDraft`, one Agent type, `ReleaseNotesAgent`, and a small Projection for
the draft list and editor. There is one Agent instance per draft, sharing its
domain `ReleaseDraftId` while retaining its separate Entity state type.

Keep the renderer unprivileged. Electron's trusted Node.js side hosts the
application services, Bounded Context, AI registry, credentials, Git tools, and
in-memory storage lifecycle. Use one trusted backend process initially. Closing
or reloading the renderer must not discard its data while that backend remains
running. Do not add distributed coordination or an embedded database.

Use a narrow preload bridge. It accepts named application operations with
validated arguments, not arbitrary Commands, SQL, filesystem paths, URLs, or
shell instructions. In the trusted process, translate operations to the existing
public server/client APIs and generated messages. Keep the runtime behind a
private application bridge; do not introduce a general IPC transport package.
Use the existing public in-process transport: register `SpineServices` with
Connect's `createRouterTransport`, then construct the client with
`Client.usingTransport`. No local HTTP listener is needed.

The execution sequence is:

| Step | Operation                                                     | Timing                                                                    |
| ---- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1    | Renderer checks required form fields.                         | Synchronous, local UI work.                                               |
| 2    | Trusted service resolves Git revisions and posts a Command.   | Asynchronous filesystem/process and dispatch work.                        |
| 3    | Aggregate accepts the Command and produces a domain Event.    | Synchronous domain handler; storage and delivery are asynchronous.        |
| 4    | Agent reacts to that Event and invokes `this.ai.invoke(...)`. | Asynchronous; may wait for auth refresh, OpenAI, and local MCP tools.     |
| 5    | Agent returns a proposal or failure Event.                    | Local result construction, followed by asynchronous storage and delivery. |
| 6    | Aggregate admits or discards that result.                     | Synchronous domain handler; storage and delivery remain asynchronous.     |
| 7    | Projection updates; UI receives the new state.                | Asynchronous notification, then synchronous React rendering.              |
| 8    | User approves and exports a particular version.               | Synchronous domain decisions; asynchronous file write.                    |

Preserve the existing Entity transaction semantics and storage interfaces with
the in-memory provider. Do not describe a failed model call as rolling back its
recorded conversation. This example introduces no database transactions.

## Domain messages and rules

Use Commands, Events, Rejections and Queries to describe the signal flow.
Generation is a domain operation with a `ReleaseGenerationId`, not a separate
Request Entity. Create documented domain Protos under the example's Proto root,
following production JVM conventions. Use existing `spine.core.Version`,
`ConversationId`, `ModelRef` and timestamp types where applicable. The first
Entity-state field is its typed ID; do not repeat its implicit required and
validation options. Do not use proto3 `optional` or `readonly`. TS examples use
four spaces and TSDoc has a blank line before tags.

There is no `DraftRevision`, application version counter, or Projection ordering
watermark. Use actual Aggregate versions. The public client currently does not
expose `CommandContext.targetVersion`, so the relevant domain Commands carry
`expected_version: spine.core.Version`. Read state and its committed Version
together through the existing versioned Query response or trusted
`BoundedContext.stand().readVersioned(...)`. The editor displays content from
that same snapshot. Do not combine stale Projection content with a newly read
Aggregate version. Handlers compare the supplied Version with `this.version`;
the application never increments a version itself. See D-0138.

The following pending-generation and result-applicability rules belong only to
this example application. They are not Agent framework behavior. The application
explicitly chooses which facts to retain, includes them in its domain messages,
and checks them in its Aggregate handlers. The framework does not copy an
originating Aggregate's Version into Agent inputs or results and does not decide
whether a proposal remains applicable to another Entity.

| Message or Entity                                         | Meaning                                                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ReleaseComparison`                                       | Selected repository, full base/target commit IDs and comparison policy.                                                                                      |
| `ReleaseDraft` state                                      | Typed ID, title, comparison, audience, current document, retained approval, pending generation/input Version, conversation and accepted-generation receipts. |
| `ReleaseNotesAgent` state                                 | Typed draft ID, conversation and generation progress; the audit journal remains separate.                                                                    |
| `ReleaseGenerationRequested` Event                        | Complete accepted input snapshot, generation ID, actual input Version, catalog, conversation and nonsecret model/account selection.                          |
| `ReleaseNotesProposed` / `ReleaseGenerationFailed` Events | Generation ID and copied input Version, result or safe failure, and AI operation ID.                                                                         |
| `ReleaseNotesStaged` / `ReleaseProposalDiscarded` Events  | Aggregate decisions about whether the Agent outcome applies.                                                                                                 |
| Edit, approval and export Commands                        | Existing `Version` identifying the Aggregate snapshot on which the person's action is based.                                                                 |

The Aggregate accepts opening a draft, changing its comparison/audience,
generating, editing, approving and preparing export. Except opening, these
Commands carry the expected Aggregate Version and reject stale targets with
specific domain Rejections. The Agent reacts to `ReleaseGenerationRequested`
with `@React` and uses only the AI facade in Entity code. The Aggregate reacts
to the Agent's proposal/failure Events. The Projection subscribes to the
Aggregate's authoritative outcomes, including generation progress, and ignores
acknowledgement, discarded-proposal and export Events with no displayed effect.
The editor obtains its concurrency version from the Aggregate, not the Projection.

When generation is accepted, retain its ID and the Aggregate's actual
`this.version` as `pending_input_version`; put that Version in the accepted Event.
The Agent copies it into its result Event. Admit a result only if both the
generation ID and input Version match the pending pair. Material input changes,
manual edits, approval and successful staging clear pending work; a new
generation replaces it. A stale failure cannot change the current generation's
status. Do not compare the historical input Version with the Aggregate's current
Version: an acknowledgement can advance the latter without changing inputs.
The Agent's outgoing EventContext version describes the Agent, not the draft.

Edit structured sections/entries while preserving their evidence. Markdown is
the rendered output. Approval validates the expected Aggregate Version, displayed
bytes and digest, then stores those exact bytes plus the reviewed historical
Version. Material changes clear approval. Export checks its current expected
Version and that the retained approved bytes/digest still match the document;
it does not require the approval's historical Version to equal the current
Aggregate Version. Approval itself, acknowledgement and earlier export preparation
can advance Entity Version without changing approved content. A changed release
range clears incompatible content/evidence. Keep a draft's selected repository
fixed; open another draft for another repository.

Allow one nonterminal model operation across the app. Enforce admission atomically
in the trusted service, not merely through disabled buttons. Keep account/model
selection fixed until authoritative completion or rejection. Each registered
`ModelRef` identifies one registration/account/endpoint/concrete model. Append
late deployments with the existing registry `register()` without rebuilding the
Bounded Context. Defaults, limits, existing references and MCP policies remain
fixed. The repository's `resolveModel(kind, scope, sourceMessage, control)` checks
the accepted generation Event against the immutable admission and actor/tenant/
Agent scope, then binds its exact source Event ID. Subscription delivery is not
a prerequisite for selection. Preserve that binding through uncertain submission,
queueing and continuation. Existing saved selections skip the callback on
continuation. See D-0135 for callback bounds and selection authorization.

Assign the generation ID before posting its Command. Retain accepted generation
receipts for the session. Check a receipt before current expected-Version or
conversation checks. An identical Command payload, including its original
expected Version, emits `ReleaseGenerationAlreadyRequested`, without another
accepted-generation Event/model call or changes to pending inputs, approval,
conversation or receipts. Command ID and envelope timestamps are excluded from
the input fingerprint. Changed payload or expected Version under the same
generation ID rejects with `ReleaseGenerationConflict`. An acknowledgement
advances the framework Entity Version as usual; it must not invalidate pending
work or replace its source Event binding. See D-0136 as corrected by D-0138.

Reconcile uncertain Command submission using retained Aggregate receipts and
exact execution status. A genuinely rejected Command releases its admission;
a repeated Command acknowledging accepted work does not. Preserve the generation
ID and original input on an explicit repeat; the public client's `post` supplies
a new Command ID. If acceptance remains unknown, do not automatically repost.
Renderer reconnect must not admit another operation while the backend still
runs the first. Backend exit loses all these in-memory records; credentials
cannot reconstruct or replay work.

Use one conversation ID from the first generation for later generations of the
same draft. Build model inputs from accepted Event data and bounded recorded
history as needed. Store the complete conversation even when only part is sent
to the model, and record exactly what each model call received.

## Sign in with ChatGPT

Use the current official direct flow for local/open-source applications. This
supersedes the earlier exploratory design based on Codex backend endpoints.
Subscription inference goes to `https://api.openai.com/v1/responses`.

Use the documented OAuth flow with `openid-client` in the private app. The
inspected official SIWC DevKit packages are private and their source license
is noncommercial, so do not copy that implementation. Do not call generation
helpers from Entity code or bypass request accounting through hidden retries.
For pinned `openid-client` 6.8.8, call `enableNonRepudiationChecks` on every
per-issued-client configuration before authorization-code or refresh grants:
claim checks alone do not verify the ID-token signature. Do not implement JWT
cryptography.

Required behavior:

- Generate and retain one opaque host ID for this installation. Keep separate
  account registrations, their issued client IDs, and verified identities.
- First sign-in uses dynamic registration, fresh state, nonce, and PKCE, a
  loopback callback on `127.0.0.1`, and the system browser.
- Save the issued client ID before exchanging the authorization code. Validate
  ID-token signature, issuer, audience, expiry, and nonce. A returning account
  must match its saved identity and registration.
- Require the granted ChatGPT plan permission, not merely successful identity
  sign-in. Show connected-but-plan-disabled distinctly.
- Store tokens only in protected trusted-process storage, using macOS-backed
  credential encryption. Keep credentials out of Protos, Agent history,
  renderer storage, logs, and exported notes. Persist refresh replacements
  together and serialize refreshes for each registration.
- Query the account's available models and refresh that list on account change.
  Show model labels from the catalog rather than a hardcoded list of products.
- Show the selected account, model, **Using ChatGPT plan**, and **Manage usage**
  linking to ChatGPT's usage settings.
- Reconnection may renew the same registration for an outstanding operation.
  It may not switch that operation to a different account/model. Sign-out stops
  new work and follows the documented revocation and local credential-clearing
  behavior. If remote revocation cannot be confirmed, say so.

Authentication and catalog calls are infrastructure operations. They do not
become fake domain model invocations. All actual drafting, revision, correction,
and tool-continuation inference must pass through the Agent runtime.

Sources: [registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
[sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions),
and the official [Electron example](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt).

## Subscription adapter contract

Implement this first, as a new module inside the existing
`@spine-event-engine/ai-vercel-ax` package, exposed through `VercelAx`. Do not
create another published package. Document its configuration separately from
API-key OpenAI Responses. Browser sign-in, account pickers, token persistence,
and refresh-session management belong to the application authentication service.
Register the profile through `VercelAx.chatgptPlanModel(...)`: keep identity and
authorization callbacks, but have its connection callback return an explicit
access token and matching identity. The adapter constructs the SDK model using
its guarded fetch; reject this profile through the generic caller-built model
factory. This prevents accidental ambient API-key fallback. It must not depend
on Electron or open a browser.

The first milestone is independently usable from a Node.js application: export
the new profile through the package's public factory, document a complete typed
configuration example, and exercise it through the real Agent invocation path
with a controlled provider. The example supplies identity and authenticated
credentials through `resolveIdentity`, `authorizeUse`, and the dedicated `connect` hook;
verify their exact signatures before writing the snippet. Keep token refresh
behind the application connection service and preserve the provided request
control, bounded fetch, cancellation, and deadline behavior. A refresh must not
silently replay a failed inference request outside the recorded attempt budget.

Reuse the current OpenAI response decoding, Ax validation/correction, runtime tickets,
abort handling, and journal wherever their contracts match. Do not weaken the
Anthropic, API-key OpenAI, or Jev profiles.

The subscription profile must construct the accepted wire format before the
runtime records and sends it:

- HTTP Responses streaming, `stream: true`, and `store: false`.
- Explicit input array and developer instructions; no system-role input item.
- No `previous_response_id` or remote conversation dependency.
- No unsupported sampling, metadata, or output-token parameters.
- Correct function-tool namespace/additional-tools encoding for this route.
- Local MCP tools execute locally; hosted OpenAI MCP/connectors are not used.
- Success only after `response.completed`. Treat failed, incomplete, aborted,
  and disconnected streams separately, including subscription usage errors
  received after streaming begins.
- Retain ordered provider response items needed for tool continuation and
  subsequent requests. Do not reconstruct them from visible text alone.

The current `AiModel` validator requires `maxOutputTokens` for generation. The
subscription route rejects the corresponding wire field. Resolve this explicitly:
make a token ceiling optional for generation, keep the existing finite request,
tool, byte, and deadline limits mandatory, and advertise whether a deployment
can enforce a requested token ceiling. Reject an incompatible explicit ceiling
before inference. Do not silently omit it or claim a byte limit is a token limit.
Existing callers that specify a supported ceiling keep their behavior.

Use prompt-and-validation output mode initially unless a contract test proves
native constrained output for the subscription profile. Both paths still perform
local Protobuf/domain validation. A corrective request uses the concrete
validation issues, consumes the same operation's limits, and records the actual
corrective input. Do not label a response a hallucination based only on a parse
error. Neither Vercel nor Ax may perform unrecorded provider retries.

Validate the selected account/model binding before every physical request.
Refreshing credentials for the same registration is allowed; substituting a
different registration is not. Record only nonsecret registration references
and model identifiers with execution metadata.

Sources: [inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
and [current route restrictions](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
Recheck these during implementation because this integration is a preview.

## Local Git through MCP

Implement one small read-only MCP server inside the example. Use the framework's
existing MCP transport and tool registration; the model must genuinely make an
MCP tool call through that path. Do not substitute callbacks and call them MCP.

Resolve a selected directory to its working-tree repository root before reading
paths; bare repositories are outside this first example. Resolve both revision
names to commit objects before accepting generation. For v1, require the base
to be an ancestor of the target. Reject ranges containing unrelated-history
root commits explicitly, before claiming a complete catalog. List commits reachable
from the target but not the base; compare the two committed trees for net file
changes. Explain this comparison policy in the UI. A moved branch or tag cannot
change an already accepted generation Command. Do not read uncommitted files.

Offer three narrow tools:

| Tool                   | Input and result                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `list_release_changes` | The accepted comparison and a page token; returns commit summaries and changed paths with continuation.               |
| `read_change_patch`    | A commit/path from that comparison; returns a bounded patch with evidence identity and an explicit completeness flag. |
| `read_release_file`    | A path at the accepted target commit; returns bounded text for migration instructions or documented behavior.         |

The trusted service supplies the repository/comparison binding. The model cannot
select another repository, arbitrary revision, command, or filesystem path.
Use Git subprocess argument arrays without a shell; disable external diff,
text conversion, pagers, and other executable configuration affecting these
reads. Treat filenames as data, support unusual names, and do not follow
symlinks/submodules outside the selected committed tree. Handle binary files
and large patches explicitly. No truncation may look like complete evidence.

Build a bounded verified catalog of commit/file evidence before accepting the
generation Command, and include it in the typed model input. MCP reads details
only for those catalog entries. The current pure validation callback receives
the result and input, not a live tool transcript; it can therefore verify exact
catalog membership without a new validation API or mutable shared collection.
Distinguish valid evidence identity from proof that the model actually read a
particular detail or that its claim is true.

Record source identities and bounded tool results in mandatory history. Preserve
the excerpts needed by the evidence viewer, so missing/pruned Git objects do not
silently substitute current content. Links open a read-only in-app evidence
viewer. Export immutable commit/path references; do not promise hosted URLs for
a repository whose remote hosting is unknown. If the catalog or comparison
cannot fit the configured operation limits, ask for a narrower range. Do not
quietly claim to cover the entire release after reading only part of it.

Git content is untrusted input. Instructions found in a commit message or file
cannot grant additional tools, change authentication, approve a draft, or cause
an export. The generated text is rendered without executable HTML.

## In-memory storage and history access

Use the existing in-memory storage factory for all Bounded Context storage
families, including Entity state, Event Stores, System Events, mandatory Agent
history, and execution records. Do not create an example-specific substitute,
save-on-exit snapshot, disk journal, or embedded database dependency.

Recording is mandatory. Retain all recorded history for the backend process
lifetime without an opt-out, retention timer, or history-position counter. The
explicit in-memory scope means all of it is lost on process exit; this does not
change the framework's retention contract for durable providers. General
physical Entity deletion remains a separate task. Use the shared `Time` utility
for runtime clock reads. UI `.tsx` and non-runtime scripts remain excluded.

The trusted host needs an authoritative completion indication to release its
in-memory admission record, including failures before the Agent handler starts.
Add `repository.agentExecution(id, sourceId, scope)` as an exact read of the
existing execution record, projecting only its phase. `completed` and
`terminated` release admission; `accepted`, `active`, and
`completed-pending-delivery` do not. Missing records/read failures remain unknown.
Bind the source Event ID in `resolveModel` from the accepted signal scope,
following the admission rules above. A public subscription activated before
posting also observes the Event for the UI; it is not the prerequisite for model
selection. An immediate acknowledgement does not establish completion. Do not
add a persisted reservation system or restart-recovery API for this in-memory
example. History entries and UI spinners alone are not proof of terminal
execution.

The existing Agent methods are protected handler APIs. The production UI must
not import BlackBox or send artificial Agent Commands just to read history.
Add a public, read-only repository access path, reusing the existing indexed
storage and opaque cursor logic. Use `repository.agentHistory(id, scope)` to obtain an Agent-specific reader
with `fullHistory`, `conversationHistory`, `systemEventHistory`, and
`domainEventHistory` methods. Keep the current `HistoryRead`,
`ConversationHistoryRead`, and `HistoryPage` contracts and Proto result types.
Require an explicit scope (`{}` for a single-tenant repository); the trusted
application bridge authorizes access. See D-0134 for the accepted contract.

All four return newest entries first and allow continuation to older entries.
`fullHistory` retains its Proto oneof; conversation reads require the conversation
ID. Validate cursor scope, including Entity, tenant, repository, view, and
conversation. Reuse occurrence ordering and tie rules. Do not scan the
Bounded Context-wide Event Stores or make another copy in a Projection.
Reads must work without creating an Entity or dispatching a model operation,
and concurrent appends must not break older-page traversal.

The desktop history panel presents conversation, tools, failures, System Events,
and Agent-emitted domain Events separately or in a combined timeline. Aggregate
approval/edit Events are not falsely shown as Events emitted by the Agent;
show draft activity separately when needed. Render recorded content as inert
text. Apply page byte bounds without imposing a total-history ceiling.

## Desktop lifecycle and failure behavior

Use one application instance. On startup, restore protected account registrations,
create fresh in-memory storage and the Bounded Context, and enable the UI when
services are ready. Saved credentials do not contain draft Commands or cause
inference on launch. A renderer reload reconnects to the same live backend;
a complete backend restart begins a new empty session.

A request with an unknown provider outcome is not advertised as exactly-once
inference. Expired credentials, denied plan usage, exhausted quota, unavailable
models, tool errors, and invalid output leave the current session's editable
draft intact. Interrupted/uncertain work keeps its original account/model
binding until settled under the runtime's supported rules within the session.
Do not silently repeat a request to clear an uncertain status.

On normal quit, explain that unexported drafts and all session history will be
lost. Stop accepting new work and close services in dependency order. If work
is active, offer to wait or stop and quit using actual cancellation behavior.
The UI must not imply that stopping the local request proves the provider did
no work or consumed no usage. Account selection unlocks only after execution is
terminal, not when its spinner disappears. A forced exit loses domain state;
a later launch must not repeat inference or export automatically.

Export starts with a domain Command such as `PrepareReleaseNotesExport`, which
validates approval and expected Entity Version against the Aggregate and produces a
correlated Event containing the immutable approved Markdown. Checking approval
only in a potentially stale Projection is insufficient. The trusted process
then opens a save dialog, writes those exact bytes, and reports the exported
approved version only after the write succeeds. Later edits do not alter that prepared
snapshot. A new export Command requires approval of the current content.
A cancelled or failed save must not show success. A crash after writing may
leave a file without a receipt; do not automatically repeat or overwrite exports
on restart. Do not give the model an export/write MCP tool.
The user may explicitly select a destination inside the repository; this is a
manual Markdown export, not permission for model-directed repository writes.
Use the native dialog's explicit overwrite confirmation for an existing file.

Use context isolation, renderer sandboxing, disabled Node integration, a
restrictive content policy, validated IPC senders/arguments, and a fixed list of
external links. Tokens never cross the preload bridge. Model Markdown cannot
open arbitrary URLs or invoke application operations.

## Implementation sequence

These estimates cover uninterrupted agent implementation, focused tests,
documentation, reviews, fixes, and integration. They are estimates, not measured
completion times. External sign-in interaction and CI queue time are additional.

| Milestone                               | Deliverable and acceptance gate                                                                                                                                                                                                                          | Estimate  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1. Implement the subscription profile   | New module in `ai-vercel-ax`; authenticated connection contract; token-limit compatibility; exact request, streaming, tool-continuation, cancellation and failure fixtures. Existing provider regressions pass. No Electron or storage changes.          | 2–4 hours |
| 2. Connect desktop sign-in              | Inspect official SDK/API/license, implement browser sign-in and protected credentials, discover models, and complete a small real Agent subscription call through the profile using in-memory storage. Human authorization is needed for the live check. | 2–4 hours |
| 3. Implement the domain and local tools | Protos, Aggregate/Agent/Projection, immutable Git comparison, read-only MCP, production history reads, in-session admission/completion, and BlackBox scenarios.                                                                                          | 3–5 hours |
| 4. Build the release-notes UI           | Repository comparison, editor/evidence/history, approval/export, account/model controls, renderer reconnect, and explicit session-loss behavior. Packaged macOS launch works without development services.                                               | 2–4 hours |
| 5. Finish the example and PR            | Tutorial, authentication/configuration guide, deterministic UI/provider tests, live MCP smoke check when authorized, relevant independent reviews, release gates, and updated PR guide.                                                                  | 2–3 hours |

Total for the in-memory version: **11–20 hours**. External authorization and CI
queue time are additional. If human authorization is unavailable, continue
independent fixture/domain/UI work and report the live check as outstanding;
do not claim fixtures prove a real subscription interaction.

Persistent domain storage is deferred. A later milestone will select/prove an
embedded provider, then add reopen, crash recovery, and durable admission tests.
PGlite remains a candidate to evaluate then, not a dependency or an early gate
for the adapter or this example. Its implementation estimate is separate.

Keep this work on `agent-entities` in the existing PR. Do not create another
feature PR. Use one implementation agent for overlapping production changes.
Integrate milestone commits and push them according to repository policy.
Apply the common workspace-version policy if adding a workspace; do not create
an unnecessary new published package for an example-specific service.

## Planned file areas

| Area                                                         | Intended changes                                                                                                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `examples/release-notes/`                                    | Private example workspace: documented Protos, domain implementation, AI task definition, local MCP server, Electron/preload/React app, packaging, tests, and tutorial. |
| `packages/ai/`                                               | Explicit capability/limit compatibility needed by subscription deployments.                                                                                            |
| `packages/ai-vercel-ax/`                                     | Subscription profile, authenticated transport seam, route-specific requests, streams, continuations, and adapter tests.                                                |
| `packages/server/`                                           | Public read-only Agent history and necessary execution-status observation using existing repository storage.                                                           |
| `packages/server-blackbox-tests/` and affected package tests | Regressions for public history/limit contracts and existing providers. Application scenarios stay in the example.                                                      |
| Workspace, Proto, build, documentation, and CI configuration | Include the new legitimate example domain, generation, exports, packaging assets, checks, and deterministic desktop tests.                                             |
| User guide and existing PR description                       | Feature introduction and tutorial with authentication, MCP, session lifetime, and actual runnable example links.                                                       |

## Acceptance scenarios and test tools

Use BlackBox as the domain test entrance, with real domain Command/Event Protos
and the existing schema-first `post` API. Use scripted AI responses for ordinary
tests; assert domain outcomes and retained history rather than implementation
call counts alone.

- Open a draft, request notes, validate a supported proposal, and stage it.
- Require a Git MCP lookup before a successful structured result.
- Record malformed output, a specific corrective request, and its outcome.
- Stop when request/tool/byte/deadline limits are reached, retaining the old draft.
- Reject an explicit token ceiling unsupported by the selected deployment.
- Discard a result after manual editing, a newer generation Command, or approval.
- Keep account/model identity through queueing and reconnect within a session.
- Reconnect the renderer without losing the live backend state or starting work.
- Release admission after Command rejection or a failure before the handler runs.
- Prevent duplicate dispatch from a double click or lost renderer acknowledgement.
- Lose an acknowledgement after successful acceptance, reconnect the renderer,
  and retry the same generation after inbox deduplication expires. Assert one
  Agent invocation. Also repeat an older accepted generation after a newer one
  and reject an ID reused with changed input.
- Reopen the backend with empty domain storage, saved sign-in, and no inference.
- Distinguish Agent proposals from Aggregate admission/approval in projections.
- Reject stale edits/approvals and prevent export of an unapproved version.
- Read every history category and subsequent pages without making a model call.

Use real temporary Git repositories for tool tests, including moved refs,
non-ancestor ranges, merge commits, renames, unusual paths, binary/large files,
and hostile text. Do not require the developer's checkout as fixture data.

Use controlled HTTP/SSE fixtures for OAuth and provider tests. Cover wrong
state/nonce/identity, issued client-ID reuse, token rotation, missing plan scope,
streamed quota errors, tool continuation, interruption, and rejection of
unsupported request fields. Assert that credentials never enter history.

Use Playwright's Electron support for the user workflow with scripted providers.
Test renderer reconnect separately from a fresh backend process. The latter
retains protected sign-in registrations but has no drafts/history or automatic
model calls. Terminate during active work to verify that reopening does not replay
it. Test packaged assets, especially generated Proto/registry files.

A live smoke test must use the actual UI sign-in and complete one subscription
generation including a local MCP lookup. It requires a human to authorize the
account; do not inspect or reuse unrelated credentials. Keep this manual live
check out of CI and report honestly if it has not been performed. CI must pass
without subscription secrets or internet inference.

Run cheap preflight and focused checks during implementation, then the existing
release profile and audits once changes converge. Complete relevant independent
API, documentation, reliability, maintainability, and final security reviews
under the repository workflow. Keep review records outside the user tutorial.

## Documentation to ship

Write a tutorial for a developer who knows basic Aggregates and Process Managers
but has not used Agents. Begin with the release-note problem, then explain the
domain messages, accepted signal, model invocation, MCP request, validation,
proposal admission, history, approval, and export. Mark asynchronous operations
in explanations and use rendered diagrams or tables rather than unrendered
Mermaid as the only illustration.

Include real, typechecked, documented TS examples with four-space indentation,
correct Proto formatting, and complete imports. Explain which configuration is
framework API and which belongs to this desktop app. Describe authentication
setup, credential storage, account/model selection, usage limits, reconnect,
loss of drafts/history on backend exit, and the subscription-specific adapter
profile. Show history reading from both
an Agent handler and the desktop's read-only access path.

Keep the PR description a human introduction with examples and runnable links.
Do not add a generic Verification section or a planning/review diary to it.
