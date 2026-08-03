# T-0095 Build-Once Images Split

Status: Accepted for implementation

Parent: `T-0089`, Wave 5 E1

Task: `T-0095`

Classification: High-risk. The slice changes install portability, compiled
application entrypoints, container process ownership, and shared release/build
evidence. It does not change domain semantics, wire contracts, gateway routing,
or deployment topology.

## Outcome and architecture freeze

T-0095 is one bounded implementation slice with four ordered checkpoints. It
deepens current package and startup seams rather than introducing a package
publisher, deployment CLI, generic application runner, or second gateway.

The build/runtime boundary is:

1. pack the exact local Spine TS packages and Message Board model package;
2. install those tarballs into a fresh application repository outside the
   workspace;
3. run `spine-proto generate` for the model, then `compose` and `handlers` for
   the application, and compile once;
4. retain compiled runtime output and production dependencies; and
5. start only compiled JavaScript. Runtime must not contain or invoke the Proto
   CLI, TypeScript compiler, workspace traversal, or a repository build.

One compiled Message Board application artifact owns separate, explicit
combined and application-only Node entrypoints. A third Message Board-specific
entrypoint assembles the already-implemented standalone browser gateway. The
existing `spine-delivery-server` bin remains the simple delivery-server
entrypoint. No framework public API is added merely to start a container.

The same locally built Message Board image contains the combined and
application-only entrypoints. Selecting the container command changes process
assembly only; it does not rebuild the image, regenerate code, change bounded
contexts, or fork domain source. The standalone gateway and delivery server are
separate local images made from the same exact-version package set.

## Current seams to reuse

- `@spine-event-engine/proto-tools` already ships the `spine-proto` bin and
  supports `generate`, `compose`, and `handlers` from `process.cwd()`.
- `packages/proto-tools/test/external-consumer.test.ts` already proves packed
  model generation/composition without workspace links. The new acceptance
  deepens this into one real fresh application build and adds handlers plus
  installed runtime startup; it must not create another general pack library.
- `examples/message-board/model` already owns the model manifest, generated
  module export, and packed Proto payload. `examples/message-board/app` already
  composes `typeRegistry`, discovers `dist/generated/handler`, and owns the
  Message Board bounded context.
- `MessageBoardApplication.createContext(storageFactory)` is the application
  storage seam. Deployment/container code may pass configuration and secrets,
  but only Message Board application code may instantiate/select its
  `StorageFactory`. Do not add a framework provider selector.
- `Server.run()` and `ProcessServerCoordinator` already install direct
  `SIGINT`/`SIGTERM` handling and retire the final `ServerEnvironment`.
- Supplying `Server` with `browser.backend.baseUrl` already selects the
  standalone gateway and reuses `BrowserServer`, `UnaryGateway`,
  `SubscriptionGateway`, exact auth routes, durable bindings, and bounded
  shutdown. Do not add a gateway class or router.
- `@spine-event-engine/delivery-server` already ships
  `dist/bin/spine-delivery-server.js`, reads its finite listener/state bounds
  from environment, installs Node signal handlers, and exposes gRPC Health.
  The image only packages and exercises it; it does not add a durable or HA
  delivery mode.

## Minimal runtime contract

The contract is application-specific and compiled-output-first. Exact source
filenames may use the existing `*-entry.ts` convention, but their built targets
and behavior are fixed:

| Process                          | Required compiled command                                                                 | Contract                                                                                                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Message Board combined           | `node dist/src/combined-entry.js`                                                         | Application code selects storage, assembles the Message Board context and existing browser gateway, then calls `Server.run()`.                                                                                     |
| Message Board application-only   | `node dist/src/application-entry.js`                                                      | The same application artifact and context start the native Spine listener without a browser gateway, then call `Server.run()`.                                                                                     |
| Message Board standalone gateway | `node dist/src/gateway-entry.js`                                                          | Message Board supplies its existing registry, session, authorization, context, clock, fingerprint, and durable-binding collaborators to `Server` with `browser.backend.baseUrl`; it owns no local bounded context. |
| Simple delivery server           | `node node_modules/@spine-event-engine/delivery-server/dist/bin/spine-delivery-server.js` | Preserve the existing `HOST`, `PORT`, `MAX_INBOUND_MESSAGE_SIZE`, `SHARD_PROCESSING_TIMEOUT`, `MAX_RETAINED_MESSAGES`, `MAX_RETAINED_BYTES`, and `MAX_TRACKED_SHARDS` contract.                                    |

The three Message Board entrypoints accept configuration only from a small,
application-owned environment reader. It must fail before listener work when a
required value is absent or malformed, use the current server option names,
and redact values from errors. At minimum it owns canonical `HOST`, `PORT`,
browser origin, backend URL in gateway mode, durable registry namespace in
gateway production mode, and runtime-only authentication/storage collaborators.
Do not introduce arbitrary module loading, unrestricted flags, config-file
discovery, or a provider-name switch in Docker/Compose code.

Application storage selection remains in Message Board source. The accepted
production acceptance provider is the existing Datastore adapter, which may be
pointed at the Datastore emulator by standard runtime configuration. Both
combined and application-only entrypoints call the same application-owned
factory selection. Neither Dockerfile, the image build helper, nor T-0096 may
branch on `mysql`, `datastore`, `memory`, or another application provider.
Local unit/browser entrypoints may keep explicit in-memory storage for their
existing local-only contract, but no production image may silently select it.

Gateway registry storage is a distinct gateway lifecycle dependency, not
Message Board application-data selection. The gateway entrypoint may assemble
the existing `DurableSubscriptionBindings` from explicitly supplied registry
configuration and an existing `StorageFactory`; it must keep namespace and
finite lease/cleanup/record limits explicit and fail closed in production.
T-0095 does not change the durable registry contract or coordination behavior.

Secrets are runtime inputs only. No package, Docker build argument, image
environment default, generated file, layer, test snapshot, log, or readiness
line may contain an authentication token, signing key, cookie secret, storage
credential, or test sentinel. A required secret/configuration value fails with
its field name, never its value.

Every final image uses exec-form `ENTRYPOINT`/`CMD` whose PID 1 is Node. There
is no shell entrypoint, package-manager process, init wrapper, generation step,
or compile step between the container runtime and Node. `SIGTERM` and `SIGINT`
must make each smoke process exit within the test's finite deadline and release
its listener. A timeout is an acceptance failure; the test harness may force
cleanup only after recording that failure.

## Capability precheck

The orchestrator established this worktree's capability before implementation:

- Docker client/server `20.10.24` are reachable;
- Docker Compose `2.17.2` is installed, although E1 must not invoke Compose;
- Node `24.18.0` satisfies the repository engine; and
- pnpm `11.9.0` matches `packageManager`.

Before the first RED run, the implementation owner records fresh outputs from
`docker version`, `docker info`, `docker compose version`, `node --version`, and
`pnpm --version`, plus a bounded loopback bind. An unavailable Docker daemon is
a capability failure to diagnose, not permission to replace image acceptance
with static Dockerfile assertions. Compose capability is evidence for T-0096
only and creates no T-0095 topology work.

## Checkpoint 1 — Fresh packed build

Add one focused acceptance harness by deepening the current Proto Tools packed
consumer fixtures. The first RED run is exact:

```bash
pnpm --config.verify-deps-before-run=false exec vitest run \
  packages/proto-tools/test/external-consumer.test.ts \
  packages/proto-tools/test/proto-tools.test.ts \
  scripts/build-once-package.test.mjs
```

`scripts/build-once-package.test.mjs` is initially RED because the current
Message Board `start` script traverses the monorepo and no installed runtime
artifact/entrypoints exist. The test must prove all of the following in one
temporary root outside the repository:

1. Pack every local runtime/build dependency needed by the Message Board model
   and app at the root version. Inspect tarball manifests and reject
   `workspace:`, `link:`, `portal:`, repository-absolute paths, mismatched local
   versions, or undeclared local imports.
2. Install from those tarballs into a fresh repository with no workspace file,
   no source-package symlink, and no module whose real path enters the Spine TS
   checkout. Third-party packages use the normal pinned package-manager graph;
   the test must not copy or symlink this repository's `node_modules`.
3. Run the installed CLI, not a workspace source path: model `generate`, app
   `compose`, app `handlers`, then one TypeScript compilation. Record command
   invocations so a missing, repeated, or runtime invocation fails.
4. Assert generated model JavaScript/type declarations, composed
   `typeRegistry`, compiled handler registry, and both compiled Message Board
   application entrypoints exist in the artifact. Generated source stays
   untracked in this repository.
5. Pack/install the built application runtime, remove the fresh repository's
   source, Proto input, config, TypeScript, Proto Tools, caches, and compiler,
   then start installed JavaScript from the reduced tree. It must resolve every
   import and handle a bounded signal shutdown without reaching the repository.
6. Scan authored/generated/runtime text for the repository absolute path and
   prohibited dependency specs. The temporary tree is removed in `finally`
   with a finite subprocess timeout and diagnostics.

Do not refactor the existing model-graph/generation implementation unless this
real consumer exposes a product defect. A defect correction remains within the
existing CLI/package metadata seam and receives its own focused regression.

## Checkpoint 2 — One application artifact, two modes

RED tests under `examples/message-board/app/test/` are added before production
entrypoints. The focused command is:

```bash
pnpm --config.verify-deps-before-run=false exec vitest run \
  examples/message-board/app/test/deployment-entrypoints.test.ts \
  examples/message-board/app/test/local-entry.test.ts
```

The tests must initially fail because the explicit built entrypoints and
application-owned deployment configuration do not exist. GREEN acceptance:

- one generated handler registry and one set of compiled domain classes serve
  both modes; the test hashes the relevant files before and after each start;
- combined starts the existing browser/native assembly; application-only opens
  only the native application listener; neither performs generation,
  compilation, package installation, or workspace access;
- both modes use the same Message Board-owned storage selection and explicit
  Datastore-emulator acceptance can write through one app-selected factory;
- missing production storage, remote facility, browser origin, or other
  required configuration fails before listener bind and does not log values;
- `SIGINT` and `SIGTERM` each exit successfully within 10 seconds, remove
  signal listeners, close intake/environment resources, and release the port;
- the existing local entrypoint behavior remains compatible and explicitly
  local-only; and
- no framework export, runner abstraction, provider registry, or domain-code
  variant is introduced.

If the current application package metadata does not retain its compiled
generated handler registry or entrypoints, correct only its `files`, `exports`,
scripts, and exact local dependencies. A runtime `start*` script may invoke
only `node dist/...`; generation and `tsc` belong to `build`/`prepack`.

## Checkpoint 3 — Standalone gateway and local images

One small local image build helper under
`examples/message-board/deploy/container/` stages exact-version tarballs in a
temporary Docker context and builds fixed local tags. It accepts no registry,
push, credentials, topology, or arbitrary Docker arguments. Root `package.json`
may expose only fixed `images:build:local` and `test:images:local` scripts.

Use one multi-stage Dockerfile unless RED evidence proves separate files are
clearer. Its targets are exactly `message-board`, `standalone-gateway`, and
`simple-delivery-server`. Pin the Node base image by immutable digest after
current-image verification. Builder layers may install build tools; final
layers contain production dependencies and compiled artifacts only. Never copy
the repository, Docker socket, `.git`, test sources, caches, local environment
files, generated TypeScript, package tarballs, or package-manager store into a
final layer.

The RED command is:

```bash
pnpm --config.verify-deps-before-run=false test:images:local
```

It initially fails because the container contract and build script are absent.
The deterministic acceptance must:

1. build all three fixed local tags from tarballs whose package names, versions,
   and SHA-256 values were captured before Docker build;
2. prove the Message Board combined and application-only commands use the same
   image ID and the same compiled domain/registry hashes;
3. start the standalone gateway against a bounded test backend through the
   current `browser.backend` seam, and start the simple delivery server through
   its existing bin; readiness is a listener/readiness line only, not a new
   application health endpoint;
4. inspect PID 1 as Node and send both supported signals across the image
   matrix, requiring exit and listener release within 10 seconds;
5. inspect image config, history, and an exported filesystem for a unique secret
   sentinel supplied only at `docker run`, the checkout path, tarballs, caches,
   package stores, `.git`, tests, TypeScript sources, source maps when not
   required, Proto Tools, TypeScript, and generated source; none may be present;
6. prove required compiled model descriptors, composed registry, handler
   registry, application entrypoints, gateway collaborators, and delivery bin
   are present and importable; and
7. remove every started container, image test network if one was created,
   temporary context, exported layer archive, and fixed local tag in `finally`.

The test may use `docker run` and a test-created bridge/network solely to
connect one gateway smoke process to one backend. It must not create a Compose
file, production service graph, replica/failover test, named durable volume,
Kubernetes manifest, or reusable topology harness. Those are T-0096.

## Checkpoint 4 — Convergence and release gate

Before review, run the complete focused package/entrypoint/image acceptance and
changed-source coverage. Every changed production TypeScript file must meet at
least 90% statements, branches, functions, and lines. Container/build tooling
must have deterministic success, failure, cleanup, command-injection refusal,
and no-publish tests even where V8 coverage is not meaningful.

The mandatory cheap preflight is:

```bash
pnpm --config.verify-deps-before-run=false proto:generate
pnpm --config.verify-deps-before-run=false typecheck:build:generated
pnpm --config.verify-deps-before-run=false exec eslint \
  examples/message-board/app/src examples/message-board/app/test
pnpm --config.verify-deps-before-run=false exec prettier --check \
  package.json pnpm-lock.yaml scripts/build-once-package.test.mjs \
  examples/message-board/app examples/message-board/deploy/container
pnpm --config.verify-deps-before-run=false docs:check:generated
git diff --check
git status --short
```

Add focused package metadata, generated-cleanliness, no-workspace-spec,
end-user API prohibition, and Markdown-link checks for changed files. The
pre-review lint also rejects stale task status, public deployment claims beyond
E1, duplicated package/version constants, accidental public exports, Docker
provider-selection strings, publication commands, and Compose/Kubernetes/JVM
paths in the diff.

Run one complete relevant specialist wave after mechanical convergence:

- style/maintainability: applicable to entrypoint/configuration structure,
  package/build scripts, Dockerfile depth, and avoidance of a runner/provider
  framework;
- documentation completeness: applicable to changed Message Board/package
  commands, image contract, lifecycle, storage ownership, and local-only limits;
- TypeScript/API docs: applicable to package manifests/exports and any authored
  declarations, but reviewers must reject unnecessary new public framework API;
- performance/reliability: applicable to install reproducibility, image size
  inputs, PID 1, startup/rollback, signals, shutdown deadlines, subprocess
  bounds, cleanup, and retained resources.

Final security review remains T-0097/G1, not a new T-0095 lane. T-0095 still
mechanically proves secret exclusion and fail-closed runtime configuration.
Collect the whole specialist wave and return one accepted correction batch to
the same implementation owner. Reopen only substantively affected concerns.

After review convergence and a fresh cheap preflight, run exactly one final
repository release profile:

```bash
pnpm --config.verify-deps-before-run=false verify:release
```

The Docker/package acceptance remains a separately recorded required gate; do
not hide it inside or repeatedly invoke `verify:release` as a diagnostic loop.

## Exact implementation ownership

One existing `implementer`, explicitly `gpt-5.6-terra` / medium, owns the whole
E1 implementation context so package, artifact, and image assumptions converge
together. Its write boundary is limited to:

- root `package.json`, `pnpm-lock.yaml`, and the minimum package/build
  acceptance under `scripts/`, preferably only
  `scripts/build-once-package.test.mjs`;
- package metadata/build fixes strictly required by real tarball acceptance in
  `packages/*/package.json`, with production source changes limited to a proven
  packaging defect in the existing Proto/server/delivery seams;
- `packages/proto-tools/test/external-consumer.test.ts` and
  `packages/proto-tools/test/proto-tools.test.ts` only to share/deepen their
  existing packed-consumer evidence without weakening isolation;
- `examples/message-board/model/package.json` and its existing build metadata
  only when packed generation requires it;
- `examples/message-board/app/package.json`, `tsconfig.json`,
  `spine-proto.json`, existing application source, the minimum new
  deployment/entrypoint source, and mirrored tests;
- `examples/message-board/deploy/container/**` for the Dockerfile, fixed local
  build helper, image acceptance, and narrowly scoped container README if a
  command needs explanation; and
- focused Message Board/package README or REFERENCE claims required by changed
  commands. Broad deployment guidance stays in T-0097.

The owner must not edit `interop/envoy/**`, `compatibility-tests/jvm/**`,
Compose/Kubernetes paths, other examples, generated output, release
publication configuration, or either protected human-review file. A defect
outside this boundary returns to the orchestrator for an explicit scope
decision; it is not silently absorbed.

## Risks and controls

- **False portability from workspace links:** real-path and dependency-spec
  scans run after real tarball installation; existing manual extraction alone
  is insufficient.
- **Build work at runtime:** reduce the runtime tree, record command counts,
  remove build inputs/tools, and start only installed JavaScript.
- **Two artifacts drifting:** hash one built Message Board image/artifact and
  run both commands without a rebuild.
- **Storage ownership inversion:** tests scan deployment/container code for
  provider branching and assert both modes call the same application-owned
  selection.
- **Native dependency mismatch:** install production dependencies inside the
  pinned Linux builder/runtime architecture; never copy macOS `node_modules`.
- **Signal masking or unbounded cleanup:** Node is PID 1; tests send signals and
  bound exit/port release, while cleanup always attempts every owned resource.
- **Secret leakage:** use runtime-only sentinels, inspect config/history/layers,
  and keep error/readiness output value-free.
- **Image-build scope creep:** one fixed local builder, three targets, no
  registry/push arguments, no Compose/Kubernetes, and no base-image framework.

## Explicit exclusions and next boundary

T-0095 does not publish npm packages or images; create a registry, versioning
scheme, SBOM/signing pipeline, or CI release job; build or launch Spine JVM;
add auth/OIDC product flows; change subscription durability; add a health API;
add another delivery mode; define service discovery, load balancing, replicas,
failover, Envoy topology, secrets orchestration, volumes, Compose, Kubernetes,
Helm, operators, or rollout policy.

T-0096 consumes the fixed local tags and runtime inputs to prove combined and
two-gateway/two-application topologies and minimal Kubernetes references. It
must not repair build-once behavior by compiling/generating at startup or by
forking the Message Board artifact.

No governing contradiction or architecture blocker is established.
