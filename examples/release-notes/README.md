# Release Notes Studio

Turn a local Git comparison into release notes that a maintainer can check,
edit, approve, and export. An Agent drafts entries and can inspect committed
changes through three read-only MCP tools. Each entry cites its supporting
commit, parent, and file; the maintainer decides whether the explanation is right.

The application runs locally. Model inference uses the selected ChatGPT account
at OpenAI, so selected repository content can leave the machine. Drafts and
history are kept in memory for the backend session. Export approved Markdown
before quitting; saved sign-in registrations do not restore drafts.

Read the [Agent tutorial](USER_GUIDE.md) to follow the Commands, Events, model
configuration, validation, MCP calls, and history APIs behind the application.

## Run on macOS

Use Node.js 24 or later, the repository's pinned pnpm version, and an installed
Git executable. From the repository root:

```sh
pnpm install --ignore-scripts
pnpm --filter @spine-event-engine/example-release-notes exec install-electron --no
pnpm --filter @spine-event-engine/example-release-notes build
pnpm --filter @spine-event-engine/example-release-notes start
```

Create a local macOS application bundle with:

```sh
pnpm --filter @spine-event-engine/example-release-notes package
```

This source example is not code-signed or notarized. Windows and Linux installers
are outside its current scope. No Codex installation, terminal sign-in, API key,
Docker container, or separately installed database is required.

## Prepare a release

1. Choose **Continue with ChatGPT** and complete sign-in in the system browser.
   Select an account with plan permission, then choose a writing model. In a
   small window, expand **Account and model** to reach these controls. Signing
   in alone does not grant plan inference permission.
2. Enter the earlier commit, branch, or tag in **From**, and the later one in
   **To**, then choose the local repository. The earlier commit must be in the
   later commit's history. Changes you have not committed are excluded.
3. Enter a release title and audience, then choose **Open release draft**.
   After opening a draft, **Change repository or commits** expands the setup
   controls. **Session drafts** switches between drafts in the running app.
4. Add an optional instruction, such as “Explain changes that require library
   users to update their code,” then choose **Write a draft**. The app uses the
   selected account and model and does not switch them while writing.
5. In **Write**, edit the entries and select their sources. Use **Sources** to
   inspect committed changes. A matching citation proves that a change belongs
   to the comparison; it does not prove the explanation is correct. Exported
   citations name the file, commit, and parent commit so the evidence can be
   located in the local repository without a public hosting URL.
6. Choose **Save edits**, or ask for another draft with more specific instructions.
   Switching tabs keeps unsaved edits. An older suggestion cannot replace an edit
   that the application has already accepted.
7. Open **Preview**, choose **Refresh preview**, and review the formatted notes.
   Save unsaved edits first. Links and images show their destinations without
   opening or loading them; **Show export text** reveals the exact Markdown.
   Choose **Approve release notes**, then **Export release notes** to save the
   approved Markdown through the native file dialog. Cancelling does not save
   a file. The macOS dialog asks before replacing an existing file. If saving
   fails, check the destination and refresh the draft before trying again.
8. In **Activity**, use **View** to choose **Everything**, **Writing**,
   **Progress**, or **Draft changes**. Choose **Load activity**, then
   **Earlier activity** to continue. Entries are summaries of recorded writing
   and source lookups, with the newest first; internal records are not displayed.
9. Export before choosing **Quit**. Reloading the window keeps the running
   session. Reopening after quitting starts with empty drafts and activity.

If submission remains unconfirmed, **Retry saved draft** repeats the
saved Command with its original instruction, account, model, and comparison.
It does not use newly edited inputs. The app does not repost automatically, and
the Aggregate's retained receipt prevents an accepted generation from starting
again.

If the draft changes before its generation Command is handled, the app can
receive a rejection for that generation. It shows the rejection and allows you
to generate again from the current draft; it does not repeat the rejected
Command. A timeout without a confirmed outcome stays unconfirmed. Reloading the
window preserves a rejection already observed by the running backend.

While generation is active or unconfirmed, **Quit** or closing the window offers **Wait**
or **Stop and quit**. Wait keeps the session open. Stopping closes the Bounded
Context before the window, but the provider may already have performed work and
charged plan usage. If the app stops after writing an export but before showing
success, the file may already exist. Reopening never repeats an export automatically.

## Account and model selection

The system browser handles the official ChatGPT sign-in flow. The trusted
process receives the loopback callback, verifies the signed identity token,
and checks the granted `chatgpt.tokens.use.direct` permission. It uses the
selected account's model catalog instead of assuming a universal model list.

Tokens are encrypted with Electron `safeStorage` and remain in the trusted
process. They are not passed to the renderer, stored in domain messages or Agent
history, or included in exports. Refresh is tied to the same issued registration
and verified account. **View plan usage** opens the account's ChatGPT usage settings.

If an initial grant fails with `invalid_grant`, retry using the retained issued
client registration. Reconnection uses fresh browser authorization secrets.
Sign-out attempts remote refresh-token revocation and clears local credentials;
it reports when remote revocation could not be confirmed. The installation ID
and issued client mapping remain available for a later reconnection.

The adapter uses the official Responses endpoint with ChatGPT plan permission.
There is no API-key fallback. See the [authentication and adapter explanation](USER_GUIDE.md#6-connect-an-authenticated-model)
for how the application connects sign-in to the Agent API.

## Git scope and limits

The app reads committed changes only. A selected subdirectory resolves to its
working-tree repository root; bare repositories are unsupported. The accepted
comparison contains full commit IDs, so moving a branch afterward cannot change
that generation's input.

The catalog allows up to 200 commits, 2,000 net changes, and 2,000 per-parent
evidence entries, with a 200 KB bound on aggregate Git output and retained catalog
data. Git admission also has a ten-second deadline. If the range exceeds a bound,
select a narrower range. Binary, missing, or oversized detail is reported as
incomplete rather than silently truncated.

The MCP worker exposes only `list_release_changes`, `read_change_patch`, and
`read_release_file` for accepted evidence. It cannot edit code, fetch arbitrary
paths, push, publish a release, or execute a model-supplied shell command.

## Follow the implementation

| Area                                                   | Code                                                    |
| ------------------------------------------------------ | ------------------------------------------------------- |
| Domain IDs, Commands, Events, and state                | [Protobuf model](proto/spine/examples/releasenotes)     |
| Aggregate, Agent, and Projection                       | [Domain handlers](src/domain/index.ts)                  |
| Typed model operation and citation validation          | [Model definition](src/domain/model.ts)                 |
| Account-bound ChatGPT deployment                       | [Model selection](src/trusted/plan-model-selection.ts)  |
| Public client, production history, and execution reads | [Trusted service](src/trusted/studio-service.ts)        |
| Local read-only tools                                  | [MCP registration](src/trusted/git-mcp-registration.ts) |
| Commands and domain outcomes through BlackBox          | [Domain tests](test/release-domain.test.ts)             |
| Real adapter and MCP protocol fixtures                 | [Agent integration test](test/release-agent.test.ts)    |

Automated tests use controlled OAuth and provider responses, not a live account.
The development and packaged Electron checks can be run with:

```sh
pnpm --filter @spine-event-engine/example-release-notes test:electron
```

A live subscription check requires a person to complete the actual browser
sign-in. A successful fixture test does not establish that a particular account
has plan permission, remaining usage, or access to a chosen model.
