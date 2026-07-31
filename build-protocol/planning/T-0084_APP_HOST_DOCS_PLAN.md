# T-0084 Application Host And Documentation Plan

Status: Accepted
Baseline: `9d8c2c76d3c1d44abd727d9b53e54ee39a31356f`

## Direction

Deepen the existing `Server`. Do not create an application-host package or a
second runtime abstraction.

- `Server.start()` remains the embedding API and installs no process-global
  signal behavior.
- `Server.run()` starts the configured endpoint and gives the framework
  process-level `SIGINT`/`SIGTERM` shutdown ownership.
- A small browser-gateway builder option makes the public listener serve the
  authenticated browser protocols while keeping the internal native backend
  private.
- `server` consumes the existing public `auth` gateway/session contracts. The
  dependency direction is acyclic because `auth` does not depend on `server`.
- End-user code supplies bounded contexts, storage, session/auth policy,
  actor/tenant resolution, type registry, and allowed browser origins. The
  framework supplies listeners, routing, credential extraction, CORS,
  readiness, rollback, signals, and retryable shutdown.
- Chat keeps only its bounded-context/domain policy and local development
  session choice. Its generic `local-cors.ts`, `local-lifecycle.ts`,
  `local-server-seams.ts`, and topology assembly are removed.

The implementation owner may improve the exact builder name and group existing
auth collaborators into the smallest coherent public options object. It must
not export listener, router, lifecycle, coordinator, or test-seam types.

## Rejected Alternatives

- A new hosting package, `Application`, `ApplicationHost`, or `RuntimeHost`:
  duplicates the JVM-familiar `Server` and adds vocabulary.
- Hosting in a client package: reverses client/server ownership.
- Requiring callers to build Connect routers, listeners, CORS, or lifecycle:
  preserves the exact boilerplate the task must remove.
- Requiring Envoy/Docker for ordinary local browser use: expands deployment
  scope without a protocol need.
- Exposing the internal native endpoint: creates an authentication bypass.
- An unauthenticated browser mode or fixed framework principal: weakens the
  accepted trust boundary.
- Automatic signal hooks in `start()`: surprises embedded consumers and tests.
- A generic CORS or lifecycle plug-in framework: over-engineers the required
  exact-origin browser RPC behavior.

## Implementation Order

### 1. Process-owned native server

Add `Server.run()` and one package-internal process coordinator. Prove test
first that readiness follows listener bind; signals, explicit close, and
concurrent close share work; failed close is retryable and marks process
failure; startup failure unregisters ownership; multiple running servers use
one signal pair and close in reverse successful-start order.

### 2. Authenticated browser server

Add the smallest server builder option and private browser-host modules. Reuse
`UnaryGateway`, `SubscriptionGateway`, `InMemorySubscriptionBindings`,
`NativeSubscriptionCreator`, and `createNativeGatewayServices`.

Prove test first:

- internal native readiness precedes public bind;
- gRPC-Web and Connect both work;
- exact allowed origins and preflight work, while forbidden origins reach no
  RPC implementation;
- bearer and existing opaque-cookie credentials are extracted by framework
  code;
- trusted actor/tenant/context replacement and subscription ownership are
  unchanged;
- the internal endpoint and credentials never reach responses, backend data,
  or logs;
- each failed startup phase rolls back prior resources;
- close stops public intake, settles subscription work, closes the listener,
  then closes the native server;
- concurrent and retry close preserve completed phases and stable failures.

TLS, reverse proxies, OIDC routes, identity provisioning, durable sessions,
deployment topology, and a configurable lifecycle framework remain out of
scope.

### 3. Chat migration

Replace the example-owned topology with a short direct use of the public
server API. Delete generic hosting files and move their generic tests to the
framework. Retain only Chat policy, context resolution, local session policy,
registry, and end-to-end acceptance. Remove unused direct Connect/server
dependencies. Keep one-command server and web starts.

### 4. Human and agent documentation

After the public API freezes:

1. Rewrite the root entry and affected server/auth/client guides.
2. Rewrite the remaining production package READMEs while preserving detailed
   contracts in their existing `REFERENCE.md` files.
3. Add the eight missing references: root, Chat family, six example packages.
4. Rewrite all example READMEs as friendly beginner paths and move topology,
   trust, lifecycle, test, extension, and limitation detail into the references.
5. Audit all 32 repository READMEs for misplaced internal language, inaccurate
   claims, broken links, and unfriendly presentation.

The binding module-entry inventory is the root, 15 production packages, six
example packages, and the Chat family: 23 README/reference pairs. A mechanical
check must derive this inventory, require both files and the human-to-agent
link, and scan prohibited implementation-history wording. Specialized fixture,
Proto-source, API/architecture index, interoperability, compatibility, and
protocol READMEs remain in their natural locations but receive the same
accuracy and plain-language audit.

Each human README uses the validation-ts reference style thoughtfully:

- immediately says what the module helps a person do;
- shows the main benefits/jobs and a minimal quick start;
- provides approachable navigation and a package/example map when useful;
- states prerequisites, supported limitations, and development commands in
  plain language;
- links related guides and labels `REFERENCE.md` as coding-agent material;
- avoids internal implementation and project-management narrative.

Each reference records current responsibilities, exclusions, exports,
lifecycle/error/trust/resource behavior, extension points, limits, and focused
verification commands, with a backlink to the human README.

### 5. Closure

Run focused runtime and docs checks, every documented example command, real
Chat browser acceptance, full native verification, all four specialist review
concerns, correction and affected re-review, task commit/push, merge, post-merge
verification/push, and remote equality. Finally start:

```sh
pnpm --dir examples/chat/app start
pnpm --dir examples/chat/web start
```

Report `http://127.0.0.1:5173` only after a visible server-backed operation and
clean browser/server diagnostics are observed.
