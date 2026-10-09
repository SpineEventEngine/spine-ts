# Release Notes Studio

## Purpose and scope

Build a small desktop example in the existing Agent PR. A developer selects a
local Git repository and a release range, then gets release notes with links to
the changes that support them. The developer can request revisions, edit the
text, approve a version, and export Markdown.

The example must demonstrate useful Agent behavior: signal-triggered model
work, typed results, MCP tools, persistent state, bounded correction attempts,
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

The application runs locally and saves its data locally. Inference uses OpenAI
over the network. Repository content selected for drafting is therefore sent to
OpenAI. Explain this before the first generation request. Do not call the app
offline or imply that inference happens on the machine.

Include:

- Local repository selection and comparisons between two committed revisions.
- User-facing and developer-facing release notes.
- Explicit draft and revision requests; no background autonomous work.
- Evidence beside each generated entry.
- Manual editing, version-specific approval, and Markdown export.
- Sign in with ChatGPT, saved registrations, account selection, reconnection,
  and models available to that registration.
- All inference through the existing Agent AI facade using the ChatGPT plan.
- Persistent drafts, Entity state, domain Events, System Events, conversation
  records, and execution records.
- A history panel with pagination, including after an application restart.

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
8. Quit and reopen. The draft, approval, evidence, and paginated history remain.

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
database lifecycle. Prefer one trusted backend process initially; isolate the
embedded database in a utility process if the compatibility milestone shows
that it blocks the desktop event loop. Do not add distributed coordination.

Use a narrow preload bridge. It accepts named application operations with
validated arguments, not arbitrary Commands, SQL, filesystem paths, URLs, or
shell instructions. In the trusted process, translate operations to the existing
public server/client APIs and generated messages. Keep the runtime behind a
private application bridge; do not introduce a general IPC transport package.
If the existing client requires a listener, use loopback only and an
application-generated credential unavailable to the renderer. Prove that setup
before adopting it. Prefer an existing in-process transport when available.

The execution sequence is:

| Step | Operation                                                     | Timing                                                                        |
| ---- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1    | Renderer checks required form fields.                         | Synchronous, local UI work.                                                   |
| 2    | Trusted service resolves Git revisions and posts a Command.   | Asynchronous filesystem/process and dispatch work.                            |
| 3    | Aggregate accepts the request and produces a domain Event.    | Synchronous domain handler; persistence and delivery are asynchronous.        |
| 4    | Agent reacts to that Event and invokes `this.ai.invoke(...)`. | Asynchronous; may wait for auth refresh, OpenAI, and local MCP tools.         |
| 5    | Agent returns a proposal or failure Event.                    | Local result construction, followed by asynchronous persistence and delivery. |
| 6    | Aggregate admits or discards that result.                     | Synchronous domain handler; storage and delivery remain asynchronous.         |
| 7    | Projection updates; UI receives the new state.                | Asynchronous notification, then synchronous React rendering.                  |
| 8    | User approves and exports a particular version.               | Synchronous domain decisions; asynchronous file write.                        |

No database transaction stays open while waiting for OpenAI. Preserve the
existing Entity transaction semantics and short database reads/writes. Do not
describe a failed model call as rolling back its recorded conversation.

## Domain messages and rules

Create domain Protos under the new example's Proto root. Follow production JVM
Proto formatting and the repository's current example conventions. Use domain
messages such as `ReleaseDraftId`, `ReleaseGenerationId`, `GitCommitId`,
`RepositorySelectionId`, `ReleaseTitle`, `ReleaseInstruction`, and
`ReleaseNotesDocument`. A Git object identifier is not assumed to have a fixed
40-character length. Use existing `ConversationId`, `ModelRef`, and timestamp
types when they represent the intended concept. A domain `DraftRevision`
identifies reviewed inputs/content; do not confuse it with the framework's
Entity `Version`.

The first field of Entity state is its typed ID. Do not repeat the implicit
required/validation options for that field. Do not use proto3 `optional` or
`readonly`. Document messages, fields, handlers, and public TS APIs. Use four
spaces in TS examples and a blank TSDoc line before the tag section.

| Message or Entity                                 | Required meaning                                                                                                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ReleaseComparison`                               | Local repository selection, resolved base and target commit IDs, and the explicit comparison policy.                                                                                          |
| `ReleaseDraft` state                              | ID, title, comparison, audience, current document, document version, approval, and latest requested generation.                                                                               |
| `ReleaseNotesAgent` state                         | ID, conversation ID, and enough domain progress to associate proposals with their generation requests. Do not copy the full audit journal into state.                                         |
| `ReleaseGenerationRequested`                      | Draft ID, generation ID, input/document version, resolved comparison, verified evidence catalog, audience, instruction, current text, conversation ID, and nonsecret account/model selection. |
| `ReleaseNotesProposed`                            | Request identity, input version, structured entries with evidence, and AI operation identity. This is a proposal, not the approved document.                                                  |
| `ReleaseGenerationFailed`                         | Request identity and safe failure details. Preserve the current document.                                                                                                                     |
| `ReleaseNotesStaged` / `ReleaseProposalDiscarded` | Aggregate decision about whether the proposal applies to the current draft.                                                                                                                   |
| `ReleaseNotesEdited`                              | A replacement document tied to the version the user edited.                                                                                                                                   |
| `ReleaseNotesApproved`                            | The exact document version approved by the user.                                                                                                                                              |

The Aggregate accepts opening a draft, changing its comparison/audience,
requesting generation, editing, and approving. It emits the complete input
snapshot in `ReleaseGenerationRequested`. The Agent handles it with `@React`,
using only the AI facade in Entity code. The Aggregate also reacts to the
Agent's proposal/failure Events. The Projection subscribes to authoritative
Aggregate outcomes, not raw Agent proposals.

Before staging a proposal, match both the latest generation ID and its input
version. A manual edit, comparison/audience change, or approval invalidates a
pending proposal. A late result remains in history but cannot overwrite the
document or silently remove its approval. Editing an approved document clears
approval; export requires approval of the current version. Reject stale edit
and approval Commands with specific domain Rejections.

Edit structured sections and entries, preserving their evidence references;
Markdown is the rendered output, not an unrelated freeform document. Approval
checks the displayed revision/content digest and saves the exact rendered
Markdown bytes. An application update must not change an already approved
export. Changing the release range clears incompatible content and evidence.
Keep a repository selection fixed for a draft; open another draft for another
repository. Projection updates carry the resulting draft revision and ignore
older deliveries. A stale failure cannot overwrite a newer request's status.

Allow one model operation at a time across this small app. Keep account/model
selection fixed while an accepted generation is nonterminal. An invalidated
proposal does not by itself mean its execution has finished. Persist the
selection and outstanding request before dispatch, restore that restriction
after restart, and reconcile it with actual execution status. Enforce admission
in the trusted service atomically, not only through disabled UI controls. Each
registered `ModelRef` must identify one registration and concrete provider model;
changing the picker must not redefine an existing reference. A double click
must not create another paid operation for the same generation ID. A deliberate
new revision gets a new generation ID.

Reconcile the persisted admission record with Command acceptance and execution:
a rejected Command releases admission, an uncertain dispatch is checked before
resubmission, and a crash between admission and dispatch must not lock the app
permanently. Cover these cases with restart tests using the existing dispatch
and execution identities; do not add a second general workflow engine.

Use a conversation ID from the first generation and retain it for revisions of
that draft. Build each request from the accepted input snapshot and bounded
recorded history as needed. The stored conversation is complete even when only
part of it is included in a model request. Record the exact materialized request
so inspection shows what the model received.

## Sign in with ChatGPT

Use the current official direct flow for local/open-source applications. This
supersedes the earlier exploratory design based on Codex backend endpoints.
Subscription inference goes to `https://api.openai.com/v1/responses`.

Prefer the official SIWC local devkit for registration/session management if its
published package, license, and credential/authorized-fetch seam fit the Agent
adapter. Inspect those contracts in the first milestone. Do not call its
generation helper from Entity code or bypass request accounting through an
opaque helper with hidden retries. If necessary, implement the documented OAuth
flow with a maintained OAuth/OIDC library; do not implement JWT cryptography.

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

Add a separately identified ChatGPT subscription profile to `VercelAx`, with
documented configuration distinct from API-key OpenAI Responses. Reuse the
current OpenAI response decoding, Ax validation/correction, runtime tickets,
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
different registration is not. Persist only nonsecret registration references
and model identifiers with execution metadata.

Sources: [inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
and [current route restrictions](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
Recheck these during implementation because this integration is a preview.

## Local Git through MCP

Implement one small read-only MCP server inside the example. Use the framework's
existing MCP transport and tool registration; the model must genuinely make an
MCP tool call through that path. Do not substitute callbacks and call them MCP.

Resolve both revision names to commit objects before accepting generation.
For v1, require the base to be an ancestor of the target. List commits reachable
from the target but not the base; compare the two committed trees for net file
changes. Explain this comparison policy in the UI. A moved branch or tag cannot
change an already accepted request. Do not read uncommitted files.

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
generation request, and include it in the typed model input. MCP reads details
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

## Persistence and history access

Use disk-backed embedded storage. Reusing the PostgreSQL provider with PGlite is
the first candidate, not an assumed supported combination. PGlite exposes a
PostgreSQL wire bridge and Unix sockets, but its single-connection backend has
different connection behavior. Establish compatibility before building the app
around it. [PGlite socket documentation](https://pglite.dev/docs/pglite-socket).

The first storage experiment uses a private Unix socket, existing `pg` access,
and a single-client pool. Verify that this cannot deadlock nested operations.
Keep the socket directory private and protocol inspection disabled. Use a real
data directory and durable flush behavior, not memory storage or a save-on-exit
JSON copy. No model or MCP call holds a database connection unnecessarily.

Required compatibility cases come from the current provider implementation:
schema/catalog checks; table initialization; row locks and conflict handling;
transaction affinity; advisory transaction and session locks; Entity commits;
Agent state/history/execution completion; failed-client release; and reopen after
an abrupt process exit. Prove the relevant atomic write behavior with the actual
provider, not only a successful `SELECT 1`. Exercise Projections, Event Stores,
System Events, and indexed Agent history as well as Entity state.

If PGlite cannot meet these contracts through a small, honest integration, stop
this implementation milestone with a concrete storage alternative and estimate.
Do not replace the provider with a new general SQLite implementation or require
a separately installed database without revising this plan.

Retain all Agent history until general physical Entity deletion, which is a
separate task. No opt-out, retention timer, or history-position counter. Use
the shared `Time` utility for runtime clock reads. UI `.tsx` and non-runtime
scripts remain outside that requirement.

The trusted host also needs authoritative execution status for its persisted
admission record, including failure before the Agent handler starts. During the
first milestone, identify an existing supported server observation API or add a
narrow read-only operation alongside Agent inspection. It must distinguish
pending/running, interrupted with an uncertain outcome, and terminal execution
for the accepted signal identity. History entries and UI state alone are not
proof that execution is terminal. Keep provider handles, credentials, leases,
and mutation operations out of this public read contract.

The existing Agent methods are protected handler APIs. The production UI must
not import BlackBox or send artificial Agent Commands just to read history.
Add a public, read-only repository access path, reusing the existing indexed
storage and opaque cursor logic. Proposed shape: an Agent-specific history
reader obtained for a typed Entity ID and explicit tenant/authorization scope,
with `fullHistory`, `conversationHistory`, `systemEventHistory`, and
`domainEventHistory` methods. Keep the current `HistoryRead`,
`ConversationHistoryRead`, and `HistoryPage` contracts and Proto result types.
Finalize the accessor name against existing Repository APIs before coding.

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

Use one application instance for its data directory. On startup, open storage,
restore account registrations and deployment references, construct the Bounded
Context, reconcile accepted work, and then enable generation controls. Do not
automatically repeat a paid request solely because the window reopened.

Preserve the runtime's existing interrupted-execution rules. A request with an
unknown provider outcome is not advertised as exactly-once inference. Show an
interrupted/needs-attention state when another request would require user action.
Expired credentials, denied plan usage, exhausted quota, unavailable models,
tool errors, and invalid output must leave the editable draft intact.

On normal quit, stop accepting new work and close services in dependency order.
If work is active, present a clear choice to wait or stop and quit, using the
runtime's actual cancellation/interruption behavior. Test forced exit separately.
Account selection unlocks only when execution is terminal, not when the editor
hides its spinner. Interrupted or uncertain work retains its original binding
until it is explicitly settled under the runtime's supported recovery rules.

Export starts with a domain Command such as `PrepareReleaseNotesExport`, which
validates approval and expected revision against the Aggregate and produces a
correlated Event containing the immutable approved Markdown. Checking approval
only in a potentially stale Projection is insufficient. The trusted process
then opens a save dialog, writes those exact bytes, and reports the exported
revision only after the write succeeds. Later edits do not alter that prepared
snapshot. A new export request requires approval of the new current revision.
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

| Milestone                                 | Deliverable and acceptance gate                                                                                                                                                                           | Estimate  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1. Prove the two integration dependencies | Durable embedded-provider experiment; exact SIWC package/API/license inspection; subscription request/stream/tool contract tests. Resolve token-limit capability and credential injection before UI work. | 2–4 hours |
| 2. Complete reusable API support          | Subscription profile through Vercel/Ax, explicit limit compatibility, and production indexed history/execution reads. Existing OpenAI, Anthropic, and Jev behavior remains covered.                       | 3–5 hours |
| 3. Implement the domain and local tools   | Example Protos, Aggregate/Agent/Projection, immutable Git comparison, read-only MCP, and BlackBox scenarios including stale proposals.                                                                    | 3–5 hours |
| 4. Build the desktop workflow             | Sign-in/account/model UI, repository comparison, editor/evidence/history, approval/export, and reopen behavior. Packaged macOS launch works without development services.                                 | 3–5 hours |
| 5. Finish the example and PR              | Tutorial, auth/configuration guide, deterministic UI/provider/restart tests, permitted live subscription smoke test, relevant independent reviews, release gates, and updated PR guide.                   | 2–4 hours |

Total: **13–23 hours**, assuming the embedded-provider experiment succeeds.
Revise the estimate immediately if it requires a different storage design or
the official authentication package cannot be integrated as documented.

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
| `packages/storage-postgres/`                                 | Only changes proved necessary by the embedded-provider experiment; do not duplicate the SQL implementation.                                                            |
| `packages/server-blackbox-tests/` and affected package tests | Regressions for public history/limit contracts and existing providers. Application scenarios stay in the example.                                                      |
| Workspace, Proto, build, documentation, and CI configuration | Include the new legitimate example domain, generation, exports, packaging assets, checks, and deterministic desktop tests.                                             |
| User guide and existing PR description                       | Feature introduction and tutorial with authentication, MCP, persistence, and actual runnable example links.                                                            |

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
- Discard a result after manual editing, a newer request, or approval.
- Keep account/model identity through queueing, reconnect, and restart.
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
Launch a fresh process against the same disk directory to test reopen, and
terminate it during active work to test interruption. Test packaged assets,
especially the embedded database runtime and generated Proto/registry files.

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
and the subscription-specific adapter profile. Show history reading from both
an Agent handler and the desktop's read-only access path.

Keep the PR description a human introduction with examples and runnable links.
Do not add a generic Verification section or a planning/review diary to it.
