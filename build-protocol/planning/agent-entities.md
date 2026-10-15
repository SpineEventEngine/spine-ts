# Signal-driven Agent entities

Implemented in [PR #18](https://github.com/SpineEventEngine/spine-ts/pull/18).

## Delivered scope

- Agents have Protobuf IDs and state, repositories, generated signal routing,
  and `@Assign`, `@React`, and `@Command` handlers. Work starts from a signal.
- Application handlers use the AI facade. Provider integration supports OpenAI,
  Anthropic, ChatGPT subscriptions, and non-generative OpenRouter decisions.
- Model selection and authentication can be configured at application,
  Bounded Context, repository, and Agent-instance scope.
- MCP interactions and model outcomes are recorded. Conversation records,
  System Events, and emitted domain Events have mandatory repository-indexed
  history, newest first, with an explicit conversation ID.
- Recorded execution results support recovery. Whether a result still applies
  to application state remains an application decision.
- BlackBox supports Agent scenarios with scripted model outcomes.
- Release Notes Studio demonstrates local Git comparison, MCP tools, ChatGPT
  sign-in, generation, Markdown editing, Preview, and export in MōBrowser.
  Credentials, drafts, and histories remain in memory for the app session.

Human-facing package and example READMEs should explain the task before setup, then walk
through actual application code. Adjacent `REFERENCE.md` files hold detailed
contracts for coding agents. Keep the established framework and To-Do guides;
do not add a second guide that repeats a new example README.

## Maintenance references

- [Agent API and configuration](../../packages/server/REFERENCE.md)
- [AI facade](../../packages/ai/REFERENCE.md)
- [Provider adapters and authentication](../../packages/ai-vercel-ax/REFERENCE.md)
- [Agent testing](../../packages/testing/REFERENCE.md)
- [Support-ticket example](../../examples/support/README.md)
- [Release Notes Studio](../../examples/release-notes/README.md)
- [Studio workflow and implementation](../../examples/release-notes/REFERENCE.md)

General physical Entity deletion remains a separate deferred task. This feature
introduces no Agent-specific purge API.

## Studio history drawer

Add a signed-in-only right drawer with collapsible release sections, using the
existing repository `fullHistory()` API and desktop bridge. Show creation age
(`just now`, `2m ago`, `3h ago`, `6d ago`, `7mo ago`, `1y 3mo ago`), chat-style
records, four-line previews, and centered full-content dialogs. Preserve complete
history through cursors, refresh expanded histories, and discard pending UI reads
on sign-out. Creation age must not change after editing a release.

Show message expand controls on hover or keyboard focus. Label tool activity
as MCP calls and results, and application events as App activity.
Keep History and Sign out in matching, centered icon buttons at the header's right edge.

Keep the addition within the example: read indexed history through the existing
API, retain the original draft creation time separately from edit time, and
format records for display. Do not add another audit store or framework API.

## Copies of mutable objects

Keep cloning only where another caller can actually mutate a retained object,
or where an independent value must be changed without changing its source.
Trace the complete call path before retaining a defensive copy. Do not clone
values again when an earlier getter, storage read, or serialization operation
already provides a separate object and no mutable reference is shared.
