# T-0083 Example Startup Plan

## Outcome

Every example receives a copy-paste command that owns its required preparation.
Chat receives two independent commands: one long-running local server-side
topology and one Vite React UI. The visible UI communicates with the real Chat
backend only through the application authentication gateway.

## Global Constraints

- Reuse the existing root Protobuf generation and TypeScript build pipeline;
  do not invent package-local generation infrastructure.
- Do not change framework public APIs, domain behavior, serialized contracts,
  persistence, deployment policy, or identity-provider policy.
- Bind all demonstration listeners to loopback by default.
- Accept only the configured browser origin at the local Chat gateway.
- Use a documented local-only bearer fixture without committing or logging a
  secret.
- Keep the existing Envoy/Docker HTTPS interoperability path intact. It remains
  the universal browser deployment reference and is not required for the local
  two-command demo.
- Generated output remains ignored and uncommitted.
- Use test-first behavior changes and one overlapping production-code owner.
- Do not build Spine JVM or use either protected human-review file.

## Slice 1: Existing Executable Examples

### Behavior

- Projects `load` prepares the workspace, runs the smallest or configured load,
  prints one result, closes its server/sessions, and exits.
- Orders `load` does the same and remains explicitly an in-memory demonstration,
  not live Datastore.
- To-Do `start` prepares the workspace, starts the fixed local listener, prints
  readiness only after bind, retains the running server, and closes it exactly
  once on `SIGINT` or `SIGTERM`.
- To-Do `smoke` remains a separate client command used against the running
  server.

### TDD

1. Add a failing manifest/startup-contract test proving each public command
   owns the root preparation pipeline.
2. Add a failing injected lifecycle test for To-Do readiness and both signals.
3. Add a failing child-process test proving signal exit is successful and the
   port is released.
4. Make the smallest manifest and process-entry changes that pass.

### Likely Files

- `examples/{projects,orders,todo}/package.json`
- `examples/todo/src/index.ts` or one small process-entry sibling
- focused script/lifecycle tests

## Slice 2: Standalone Chat Server

### Topology

```text
React browser
  -> Connect over loopback HTTP with exact-origin CORS
  -> native application auth gateway
  -> native gRPC transport
  -> ChatApplication backend on an internal ephemeral loopback port
```

Compose existing `ChatAuthorizationPolicy`, `ChatContextResolver`,
`UnaryGateway`, `SubscriptionGateway`, `InMemorySubscriptionBindings`,
`NativeSubscriptionCreator`, `createNativeGatewayServices`, and
`ChatApplication`. Declare direct Connect Node dependencies in the Chat app
manifest. Keep the topology/process owner internal to the example package.

### Lifecycle

1. Start the backend on an ephemeral loopback port.
2. Acquire local auth/session and subscription resources.
3. Bind the loopback HTTP gateway with exact-origin CORS.
4. Print one stable readiness line only after successful bind.
5. On close, stop gateway intake, cancel/close subscription bindings, close the
   listener, close local session/auth resources, and close the backend.
6. Attempt all cleanup steps, bound waits, aggregate failures, and make close
   idempotent.

### TDD

- Partial-start failure closes every earlier acquisition.
- A real ephemeral gateway permits authenticated post/read/subscribe/cancel.
- Exact-origin preflight admits only supported methods and headers.
- Missing/invalid bearer and an unauthorized room forward no backend work.
- Child-process `SIGINT` and `SIGTERM` close resources successfully.

### Likely Files

- internal files under `examples/chat/app/src/`
- `examples/chat/app/package.json`
- app lifecycle and integration tests
- lockfile importer metadata

## Slice 3: Real Chat Web Entry

Preserve `ChatBrowserApp`. Replace the visible Vite entry with a local
development host that creates `BrowserSession.bearer()` and
`Client.forConnect()`, targeting the documented gateway URL. Keep deterministic
fixture behavior test-only. On teardown or hot-module replacement, unmount
React and close the client and session.

### TDD

- Unit tests cover configuration defaults, invalid configuration, and teardown.
- Real Chromium acceptance starts the separate server and web commands, loads
  the UI, posts text, observes server-backed Projection state, and proves
  subscription cleanup.
- Browser console errors, page errors, and server stderr fail the test.
- Server loss produces an honest client error; no deterministic fallback data
  appears.

### Likely Files

- `examples/chat/web/src/`
- `examples/chat/web/index.html`
- `examples/chat/web/package.json`
- Playwright configuration and tests

## Slice 4: Documentation

Review and correct every README under `examples/` and
`examples/todo/USER_GUIDE.md`. Add a Chat model README.

Each entry document states:

- Node and pnpm prerequisites and the install boundary;
- exactly one supported run/start command;
- the generation/build work owned by that command;
- expected readiness or success output;
- whether the command is long-running or one-shot;
- exact shutdown action and cleanup behavior;
- local, in-memory, and non-production limitations.

The Chat family README presents the two terminal commands and the UI URL.
Chat app/web docs distinguish direct local Connect from the retained
Envoy-based HTTPS interoperability suite.

## Acceptance And Review

Execute all public commands from a freshly installed/generated-clean worktree:

1. Projects load.
2. Orders load.
3. To-Do start, smoke, `SIGINT`, and `SIGTERM`.
4. Chat server start.
5. Chat web start.
6. Real Chromium post/read/subscription flow with clean browser and server
   diagnostics.
7. Stop both Chat processes and prove their ports/resources are released.

Then run focused suites, end-user API scans, docs/API checks, generated
cleanliness, formatting/diff integrity, and full `pnpm verify` with at least
90% branch coverage.

One complete review wave covers:

- style/maintainability for process/topology structure;
- documentation for every command and behavioral claim;
- TypeScript/API docs for authored entry points and snippets;
- performance/reliability for readiness, CORS, streaming, cleanup, signals,
  and bounded waits.

Review explicitly checks loopback binding, exact-origin CORS, bearer redaction,
no backend bypass, and no production-auth claim. No separate security lane is
required because the task does not change a framework security boundary.
