# Release Notes Studio

Turn a local Git comparison into editable Markdown release notes. The Agent proposes
structured claims with committed Git evidence; the application validates those
claims and converts an accepted proposal once to clean Markdown. You can then
edit, preview, copy, and export the exact current document.

The application runs locally. Selected changes are sent to OpenAI when you
choose to write. Drafts and history stay in memory for the backend session;
export Markdown before quitting if you want a lasting copy. Sign in again after
reopening the app.

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

1. The app first shows a sign-in dialog. Choose **Sign in with ChatGPT** and
   finish in the system browser. Sign in again each time you open the app.
   If authorization fails, the same dialog offers **Continue sign-in** for an
   issued client in the current app session.
2. On **Your releases**, choose **New release**. In **Changes**, choose a local
   Git project, then real local **From** and **To** revisions. The earlier
   commit must be in the later commit's history. Uncommitted changes are
   excluded. Enter a **Release** name, check the commit and file counts, then
   choose **Next**.
3. In **Writing style**, choose **Customers** or **Developers**, a **Plain** or
   **Friendly** tone, optional **Notes**, and a model advertised for the selected
   account. **Write** sends the selected changes to OpenAI. The writing screen shows
   progress and offers **Cancel**; cancellation preserves any prior Markdown
   and prevents a late proposal from replacing it.
4. When writing succeeds, the result opens in a Markdown editor. Edit any text, including headings,
   code blocks, and whitespace. Changes autosave in order; **Saved for this
   session** appears only after the trusted service acknowledges the bytes.
   **Preview** displays Markdown without executing HTML, opening links, or
   loading remote images. **Copy Markdown** copies the current editor text.
5. Choose **Export** to save the current exact UTF-8 Markdown through the
   native file dialog. The app flushes pending edits and checks the current
   Version before writing. Canceling the dialog does not save a file. If the
   result is uncertain after a write, inspect the selected destination before
   exporting again.
6. **Dashboard** returns to your in-memory releases. Reopen a card to continue
   editing its project-labelled document and release. **Sign out** is always in the top bar;
   pending edits are saved, and active writing is stopped before the account is
   cleared. Closing or quitting ends the draft session, so export first.

A draft-generation submission whose acknowledgement is uncertain retains its
original draft and generation identifiers for retry. An accepted generation
cannot silently restart with changed inputs. The Aggregate discards proposals
that no longer match the pending generation or that arrive after cancellation.

## Account and model selection

The system browser handles the official ChatGPT sign-in flow. The trusted
process receives the loopback callback, verifies the signed identity token,
and checks the granted `chatgpt.tokens.use.direct` permission. It uses the
selected account's model catalog instead of assuming a universal model list.

OAuth grants, issued client IDs, and the host ID remain only in the trusted
process's memory. Closing the app discards them. Tokens are not passed to the
renderer, stored in domain messages or Agent history, or included in exports.
Refresh is tied to the same issued registration and verified account while the
app remains open. The renderer uses a nonpersistent Electron session.
The system browser's own login state is separate from this app.

If an initial grant fails with `invalid_grant`, the next dialog sign-in can retry
the issued client in that app session with fresh browser authorization secrets.
Sign-out attempts remote refresh-token revocation and clears the in-session
registration; it reports when remote revocation could not be confirmed. The
next sign-in starts a fresh registration.

The trusted process reports a fixed authentication stage, category, and
allowlisted code to its terminal when sign-in fails. These diagnostics contain
no credentials, callback URL, account identifier, or provider prose.

The adapter uses the official Responses endpoint with ChatGPT plan permission.
There is no API-key fallback. See the [authentication and adapter explanation](USER_GUIDE.md#6-connect-an-authenticated-model)
for how the application connects sign-in to the Agent API.

## Git scope

The app reads committed changes only. A selected subdirectory resolves to its
working-tree repository root; bare repositories are unsupported. The accepted
comparison contains full commit IDs, so moving a branch afterward cannot change
that generation's input.

The catalog retains the selected committed range without an application count,
byte, or time ceiling. Caller cancellation and an explicitly supplied deadline
still stop work. Binary or missing detail is reported as incomplete rather than
silently truncated. Listing results are complete by default; a caller can request
a page size and continue with `nextPageToken`.

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
