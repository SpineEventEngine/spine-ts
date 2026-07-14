# T-0038 Framework Children Execution Plan

Status: Accepted for execution
Parent: `T-0038-accepted-capability-audit`
Role: requirements splitter
Expected profile: `gpt-5.6-sol` / `high`
Actual profile: `gpt-5.6-sol` / `high`
Write scope: this file only

## Canonical Skill Applicability Check

This check was recorded before planning actions, as required by
`BUILD_PROTOCOL.md#skills-and-tooling`. No subagent is used or permitted for
this assignment.

### Sources checked

| Source                             | Scope and evidence                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session skill inventory            | The session exposed the task-relevant planning/design subset: `planning-with-files`, `epic-breakdown-advisor`, `architecture-patterns`, `codebase-design`, `api-design-principles`, `domain-modeling`, `architecture-decision-records`, `test-driven-development`, `javascript-testing-patterns`, `nodejs-backend-patterns`, `typescript-advanced-types`, and `verification-before-completion`.                       |
| Task-provided skill names or paths | None. The assignment requires the canonical check but names no skill.                                                                                                                                                                                                                                                                                                                                                 |
| Repo expected-skill manifest       | Read `build-protocol/skills/EXPECTED_SKILLS.md`; it records eight expected skills and includes `planning-with-files`, `architecture-decision-records`, `typescript-advanced-types`, `nodejs-backend-patterns`, and `verification-before-completion` from their stated source repositories.                                                                                                                            |
| User-installed entrypoints         | `find ~/.agents/skills -maxdepth 2 -type f -name SKILL.md -print` checked the full readable directory and returned 47 entrypoints.                                                                                                                                                                                                                                                                                    |
| Installed-skill lock               | `~/.agents/.skill-lock.json` was readable at lock version 3 with 47 records. Relevant records identify `othmanadi/planning-with-files`, `deanpeters/Product-Manager-Skills`, `mattpocock/skills`, `wshobson/agents`, and `obra/superpowers`, with local relative `SKILL.md` paths. The selected entrypoints were readable; the epic skill's referenced `workshop-facilitation` entrypoint was not installed/readable. |

### Selected skills read before planning

| Skill                            | Source                              | Applicability and instructions applied                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `planning-with-files`            | `othmanadi/planning-with-files`     | The work is a durable, multi-step research plan. The assigned plan file is the sole persistent artifact. Its default root `task_plan.md`, `findings.md`, and `progress.md` files are not created because explicit sole-write ownership is authoritative.                                                                                                                                           |
| `epic-breakdown-advisor`         | `deanpeters/Product-Manager-Skills` | The parent must become two branchable, testable slices. Apply the simple/complex and business-rule split ideas while preserving end-to-end behavior; project architecture-significance rules replace generic product-story sizing. Its referenced `workshop-facilitation` skill was unreachable, so the complete user brief supplied the best-judgment entry mode without an interactive workshop. |
| `architecture-patterns`          | `wshobson/agents`                   | T-0038b composes bounded contexts through existing ports/adapters. Preserve dependency direction and keep ZeroMQ as an adapter outside framework/domain behavior.                                                                                                                                                                                                                                  |
| `codebase-design`                | `mattpocock/skills`                 | Define one small framework-owned interface that hides process routing/composition, use existing seams, and avoid publicizing internal lifecycle or transport details.                                                                                                                                                                                                                              |
| `verification-before-completion` | `obra/superpowers`                  | Do not report completion until fresh Prettier and `git diff --check` evidence for this sole file has been read.                                                                                                                                                                                                                                                                                    |

### Relevant-looking skills not applied

| Skill                           | Source                                     | Reason                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api-design-principles`         | `wshobson/agents`                          | Fully read during triage, but its REST/GraphQL guidance does not govern this TypeScript framework interface or Protobuf type URL. Project public-contract rules govern instead. |
| `domain-modeling`               | `mattpocock/skills`                        | Fully read during triage. This plan consumes established project/JVM language but must not alter the domain glossary or write an ADR.                                           |
| `architecture-decision-records` | Repo expected-skill manifest               | An ADR would be outside sole ownership; the accepted audit and existing architecture records already establish the decisions to slice.                                          |
| `test-driven-development`       | Session inventory and installed-skill lock | The child implementers must execute RED/GREEN/refactor, but this role writes no tests or implementation. The plan will define exact observable RED cases.                       |
| `javascript-testing-patterns`   | Session inventory and installed-skill lock | Test-framework mechanics belong to child implementation; existing repository test conventions and focused gates are sufficient for requirements splitting.                      |
| `nodejs-backend-patterns`       | Repo expected-skill manifest               | Generic HTTP/backend patterns are not the issue; the work is existing framework runtime composition and IPC.                                                                    |
| `typescript-advanced-types`     | Repo expected-skill manifest               | No difficult type-level design has been demonstrated; the public names and ownership seam matter more than advanced type machinery.                                             |
| `requesting-code-review`        | Repo expected-skill manifest               | This role defines reviewer relevance but does not request or run a review wave.                                                                                                 |
| `using-git-worktrees`           | Repo expected-skill manifest               | The orchestrator supplied the existing worktree; this role must not change Git state.                                                                                           |
| `subagent-driven-development`   | Repo expected-skill manifest               | Explicitly prohibited, and requirements splitting is not implementation.                                                                                                        |

Conflict resolution: installed skills are advisory. The assignment,
`BUILD_PROTOCOL.md`, the completion plan, and the one-file ownership boundary
govern. In particular, the planning skill's companion files and the domain
skill's glossary/ADR writes are excluded.

## Inspected Evidence

### Accepted audit findings and active requirements

- `build-protocol/tasks/T-0038-accepted-capability-audit/TASK.md` and
  `build-protocol/reviews/T-0038-accepted-capability-audit.md` accept two HIGH
  framework defects. T-0038a is the invalid custom fallback-prefix path through
  `getTypeUrlPrefix()` and `deriveTypeUrl()`. T-0038b is the gap between
  callback-only `RuntimeTransportBinding` and the otherwise unattached
  `ServerEnvironment.transport`; both children must integrate before the parent
  matrix is rerun and re-reviewed.
- `build-protocol/TECHNICAL_SPEC.md` makes local multi-process execution over an
  abstract, initially ZeroMQ-backed transport a framework purpose and requires
  multiple Node processes. The completion plan narrows the initial-release
  proof to same-host command/event/delivery behavior and expressly excludes
  distributed transport, production supervision, production topology policy,
  and speculative query/subscription/system routing.
- `build-protocol/PROJECT_COMPLETION_PLAN.md#T-0040a` says an example-discovered
  missing mandatory public framework seam must become a tiny T-0038 child before
  example edits resume. Accepted review has already triggered that rule, so
  T-0038b owns the framework seam and T-0040a may only compose and demonstrate
  it.

### T-0038a current TypeScript behavior

- `packages/core/src/index.ts`: `deriveTypeUrl()` calls `getTypeUrlPrefix()` and
  removes trailing slashes without validating the remaining prefix. A custom
  fallback of `/` therefore becomes empty and yields `/<full.type.Name>`.
- The same file shows the compatibility boundaries: a schema file's Spine
  `type_url_prefix` option wins; a schema without that option defaults to
  `type.googleapis.com`. `packAny()` (and therefore `packCommand()` and
  `packEvent()`) and implicit `TypeRegistry.register()` derivation expose no
  custom fallback input; they use only file-option/default derivation and are
  preservation surfaces, not propagation paths for the malformed caller input.
  Explicit registry URLs already require a non-empty
  `<prefix>/<schema.typeName>` form.
- `packages/core/test/index.test.ts` proves valid Spine-option URLs, the default
  fallback, explicit registry URLs, and packing, but has no invalid custom
  fallback case. No new fallback option exists on packing APIs, so T-0038a must
  not invent one merely to manufacture another defect path.

### T-0038b current TypeScript behavior

- `packages/server/src/runtime/runtime-transport.ts` registers command
  responders and event subscribers, validates envelopes, then invokes required
  caller-supplied `onCommand`/`onEvent` callbacks through a separate
  `SingleProcessServerRuntime`. It does not post to a `BoundedContext`.
- `packages/server/test/runtime/runtime-transport.test.ts` proves callback
  execution, including a ZeroMQ path, but the callbacks only append observation
  strings. It does not prove repository handlers, event-bus behavior, inbox
  delivery, or framework server ownership.
- `packages/server/src/context/bounded-context.ts` already owns the real
  `CommandBus`, `EventBus`, repository dispatch, inbox handoff, and public
  `commandBus().post()` / `eventBus().post()` endpoints. Its delivery descriptor
  is package-internal and already consumed by environment attachment.
- `packages/server/src/server/server-environment.ts` publicly selects one
  adapter-neutral `SignalTransport` and owns it only when configured to do so.
  `packages/server/src/server/server.ts` builds contexts, attaches their
  delivery descriptors, waits for startup recovery, and opens HTTP/2, but never
  reads `environment.transport` and owns no runtime transport handle.
- Existing close order is network intake/sessions, environment detach and
  delivery quiescence, then contexts/resources and any owned environment.
  Transport intake must join that sequence without taking delivery ownership
  away from `ServerEnvironment`.
- `packages/transport/src/zeromq/signal-transport.ts` supplies real same-host
  request/respond and publish/subscribe over deterministic `ipc://` endpoints.
  Peers share an absolute private IPC directory and adapter identity; transport
  resources have bounded request/receive waits and idempotent close handles.

### Spine JVM guardrail and smallest familiar concept impact

Inspected local notes:

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`, especially
  runtime parts, context integration, environment wiring, and lifecycle;
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`, especially bus
  semantics and repository-to-inbox delivery.

Inspected corresponding local source under the available `core-jvm/server`
checkout:

- `server/src/main/java/io/spine/server/integration/IntegrationBroker.java`;
- `server/src/main/java/io/spine/server/BoundedContext.java`;
- `server/src/main/java/io/spine/server/ServerEnvironment.java`;
- `server/src/main/java/io/spine/server/Server.java`.

Exact impact: JVM `BoundedContext` constructs and closes its internal
`IntegrationBroker`; the broker obtains transport from `ServerEnvironment`,
shares that transport across contexts/process components, and feeds received
external events into the context event bus. JVM `Server.start()` remains a
network lifecycle operation and shutdown closes network before contexts. The
smallest familiar TypeScript impact is therefore one package-internal
context-to-transport composition owned by existing `Server` lifecycle and
backed by existing `ServerEnvironment.transport`. It must enter existing
context buses and existing environment-owned delivery, not expose a new public
broker, callback registry, worker supervisor, lifecycle abstraction, or ZeroMQ
detail. JVM's broader integration configuration exchange and system machinery
are not required by this child.

## Split Decision And Order

The parent defect batch passes the architecture-significance threshold for
exactly two children:

1. T-0038a changes validation semantics at the public/serialized type-URL
   boundary.
2. T-0038b adds the missing bounded-context/runtime/server composition for
   same-host process execution.

The children are independently reviewable and branchable, but integration is
serial through `main`: branch T-0038a from current verified `main`, complete,
review, and verify it, then merge and push updated `main`. Branch T-0038b only
from that updated `main`, complete, review, and verify it, then merge and push
`main` again. Only afterward back-merge updated `main` into the still-open
T-0038 parent. Never branch T-0038b from the unmerged parent or back-merge a
child branch into the parent before that child's `main` integration. Do not
combine their implementation or review packages.

## T-0038a: Canonical Fallback Type URLs

### Outcome and ownership

One implementation owner tightens only fallback-prefix validation in
`@spine-ts/core`. It owns the smallest core source/test/TSDoc/package-doc set
and its own task/work/review records. Expected implementation profile:
`gpt-5.6-terra` / `medium`. Terra High is reserved for correctness, public-API,
and reliability review of this serialized compatibility boundary. No Protobuf
source, generated output, server/runtime, transport, example, or unrelated
documentation change belongs in this child.

### Exact contract

- `deriveTypeUrl(schema, { fallbackPrefix })` must validate the fallback only
  when the schema file has no Spine `type_url_prefix` option.
- After removing permitted trailing `/` separators, a fallback must retain a
  non-empty prefix and contain no whitespace. Therefore `""`, whitespace-only
  values, `/`, and `///` reject with one deterministic `TypeError` before any
  type URL is returned.
- A valid fallback such as `type.example.test` remains valid. Existing trailing
  slash compatibility remains: `type.example.test/` and repeated trailing
  slashes canonicalize to exactly
  `type.example.test/<schema.typeName>`.
- A valid Spine file option continues to win over any supplied fallback. An
  unused malformed fallback must not override or invalidate that file option.
- Omitting the fallback for a schema without the Spine option continues to use
  `DEFAULT_TYPE_URL_PREFIX` (`type.googleapis.com`).
- `getTypeUrlPrefix()` observes the same fallback validation because it is the
  public prefix-selection function. Do not add a second validator or a new
  public error class.
- `packAny()` / `packCommand()` / `packEvent()` gain no fallback parameter.
  Their implicit derivation remains canonical. `TypeRegistry.register()` keeps
  implicit default derivation and its existing explicit full-URL validation.
- No accepted valid type URL changes bytes or text. The only compatibility
  break is fail-fast rejection of inputs that previously produced a
  noncanonical URL.

### TDD slices

1. **RED — direct invalid fallback.** In `packages/core/test/index.test.ts`, use
   a schema without the Spine option and assert the exact error class/message
   for `/`; table-drive the other malformed forms.
2. **GREEN — one fallback validator.** Validate the selected fallback inside
   the existing prefix owner without changing the returned text of valid
   prefixes; let `deriveTypeUrl()` keep its existing trailing-slash removal and
   append exactly one separator. Keep file-option precedence unchanged.
3. **Regression — valid compatibility.** Prove valid bare/trailing-slash custom
   fallbacks, Spine-option precedence even with an unused `/` fallback, and the
   existing default URL.
4. **Preservation — implicit consumers.** Prove packing a no-option schema and
   implicit `TypeRegistry` registration still produce the canonical default
   URL; prove explicit valid registry URLs are unchanged. These are preservation
   tests, not a reason to expand packing options.
5. **Refactor only if needed.** Keep validation in one owner and avoid a new
   exported helper, error hierarchy, or duplicated regex/policy constant.

### Acceptance criteria

- No public derivation call can return `/<schema.typeName>` from a malformed
  fallback.
- Every malformed fallback case rejects deterministically before a caller can
  receive a prefix or derived type URL from the direct custom-fallback option
  path.
- Valid Spine-option, default-fallback, valid custom-fallback, packing, and
  explicit/implicit registry behavior remain byte/text compatible.
- The public TSDoc for `DeriveTypeUrlOptions`, `deriveTypeUrl()`, and
  `getTypeUrlPrefix()` states accepted normalization and the `TypeError` case.
  `packages/core/README.md` adds one concise fail-fast note. Broader user-guide
  or architecture rewrites remain T-0039.
- No export is added or removed; `scripts/check-api-docs.mjs` retains the same
  core export allowlist.

### Focused gates

Run in this order, regenerating ignored output only through normal scripts:

1. `pnpm --config.verify-deps-before-run=false exec vitest run packages/core/test/index.test.ts`
2. `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
3. `pnpm --config.verify-deps-before-run=false exec eslint packages/core/src/index.ts packages/core/test/index.test.ts`
4. `pnpm --config.verify-deps-before-run=false docs:check:generated`
5. Prettier check over the exact changed child files and `git diff --check`
6. After clean review, final task `pnpm --config.verify-deps-before-run=false verify`

### Review relevance

- Style/maintainability: relevant; require one policy owner and no helper/error
  proliferation.
- Documentation: relevant; public rejection and compatibility wording changed.
- TypeScript/API docs: relevant at Terra High; public option/function contracts
  and unchanged exports must be verified.
- Performance/reliability: relevant at Terra High; malformed serialized input,
  direct custom-fallback rejection and packing/implicit-registry preservation
  tests cover the defect and its compatibility boundary.
- Security: no per-task lane by protocol. Record validation/type-confusion
  relevance for the final T-0041 gate.

## T-0038b: Context Transport Composition

### Outcome and ownership

One implementation owner adds framework-owned same-host command/event intake
that reaches real bounded-context buses and existing delivery under the
existing server/environment lifecycle. Expected implementation profile:
`gpt-5.6-terra` / `medium`. Terra High is reserved for correctness, public-API,
and reliability review of startup/close ordering, shared transport ownership,
and asynchronous execution. The child owns the smallest server
runtime/server/context source and tests, the focused cross-process fixture,
affected public TSDoc/docs, and its own task/work/review records. Production
ZeroMQ changes are excluded unless a focused test proves an adapter defect that
blocks this exact composition; such a finding must be replanned rather than
absorbed casually.

### Framework-owned interface and ownership boundary

- Add no new public root symbol. The public composition remains the familiar:
  `Server` + added `BoundedContext` + `ServerEnvironment.transport`.
  `Server.start()` makes the selected environment transport operative for the
  contexts it assembles.
- Add one package-internal context transport adapter (use a name of at most four
  semantic components, such as `ContextTransport`) behind the existing package
  access pattern. It reuses the existing routing/topic rules and the existing
  `RuntimeTransportBinding` binder, gate, runtime queue, validation, and handle;
  it does not create another public binding or lifecycle abstraction.
- Preserve the public callback-based `RuntimeTransportBinding.open()` contract
  for compatibility. Add only package-internal access that substitutes
  framework callbacks: accepted commands call the owning context's
  `commandBus().post()`, and accepted events call its `eventBus().post()`.
- Derive transport routes from the built context's actual accepted command and
  event types. Use the same canonical `TransportTopic` routing keys and
  command competing-consumer/event fan-out semantics already implemented.
  Do not ask application code to materialize handlers or pass callback
  registries.
- One inbound event is posted exactly once to one bounded-context `EventBus`.
  That bus owns dispatcher fan-out, event storage, repository routing, inbox
  writes, and delivery. Never post the same envelope once per
  `EventRuntimeRoutingRoute`; that would duplicate storage and delivery.
- `ServerEnvironment` remains the sole delivery readiness/generation owner and
  the owner (when configured) of transport closure. A context transport handle
  owns only its route registrations and intake runtime, never the transport
  instance, delivery worker, storage, or context.
- The ZeroMQ adapter stays reachable only from
  `@spine-ts/transport/zeromq`; endpoint paths, sockets, adapter identity, and
  process control do not appear in `@spine-ts/server` public declarations.

### Startup and close semantics

The successful `Server.start()` order becomes:

1. build contexts/resources;
2. attach context delivery descriptors and complete finite startup recovery;
3. open one context transport binding per built context against
   `ServerEnvironment.transport` in deterministic context order;
4. open the HTTP/2 listener;
5. resolve `start()` only after all four phases complete.

The successful `RunningServer.close()` order becomes:

1. stop HTTP/2 intake and active sessions;
2. close context transport registrations and drain their already accepted
   callback work without closing the shared transport;
3. detach from `ServerEnvironment` and await environment-owned delivery
   quiescence while contexts/storage/transport remain open;
4. close contexts and explicit resources;
5. close an owned environment, which then closes owned delivery/tracing,
   transport, and storage facilities in its established order.

Lifecycle failure rules:

- A partial transport-binding open closes every acquired registration and its
  runtime. The listener must not open. If registration cleanup cannot be proven,
  retain contexts, environment attachment, transport, storage, and resources;
  a cleanup-only `Server.start()` retry resumes unfinished binding cleanup
  before detach or dependency closure.
- Transport-binding close is an ingress hard gate like network close. If it
  fails, do not detach delivery or close endpoint dependencies. Retry only
  unfinished registrations; already closed registrations are not closed again.
- Closing a server with a caller-owned/shared environment closes only that
  server's route registrations. It must not close the transport or interrupt a
  sibling server's disjoint routes.
- Duplicate command responder ownership on the same transport route fails
  startup deterministically and cleans the failed server's partial ownership;
  do not add topology or arbitration policy.
- Command request acceptance continues to mean accepted for asynchronous work,
  not handler completion. Binding/runtime close waits for the framework
  callback promise, and environment detach then waits for resulting delivery.

### Command, event, and delivery behavior

- A valid transported command is envelope/type-URL validated, acknowledged as
  accepted after asynchronous context intake, posted once to the owning
  `CommandBus`, routed to the registered repository/dispatcher, and may emit
  normal framework-owned events.
- A valid transported event is envelope/type-URL validated, posted once to the
  owning `EventBus`, stored under existing event-bus rules, and fanned out by
  that bus.
- Process-manager/projection work created by either path uses the existing
  `HANDLE_COMMAND`, `REACT_UPON_EVENT`, and `UPDATE_SUBSCRIBER` inbox handoff.
  Existing `ServerEnvironment` delivery drains and quiescence remain the only
  delivery owner. No new delivery label, retry, scheduler, or direct callback
  engine is introduced.
- Invalid envelopes/type URLs fail before context bus intake. Query,
  subscription, system, catch-up, import, and outbound integration-broker
  routing are not inferred from this slice.

### TDD slices

1. **RED — server uses environment transport.** With a built context and a
   recording `SignalTransport`, prove current `Server.start()` registers no
   command/event routes. Specify the new result: all actual accepted types are
   registered before listener readiness, empty contexts register nothing, and
   application callbacks are unnecessary.
2. **GREEN — context adapter through existing binding.** Add package-internal
   route extraction and framework callbacks to context buses. Unit-test
   command unicast, one-post event fan-out, malformed-envelope refusal, and no
   duplicate event delivery with multiple handlers for one event type.
3. **RED/GREEN — lifecycle ownership.** Cover binding-open failure before
   listener, cleanup-only retry, close-before-detach ordering, accepted-work
   drain, shared caller-owned transport reuse, owned-environment final transport
   close, duplicate responder failure cleanup, and idempotent/retryable close.
   Reuse the established T-0037f lifecycle fixture instead of creating a second
   lifecycle harness.
4. **RED/GREEN — real cross-process acceptance.** Add one test-only child worker
   fixture. The child assembles a real bounded context, environment with
   ZeroMQ `SignalTransport`, and `Server`, then reports ready only after
   `Server.start()` resolves. The parent uses a distinct transport instance
   with the same private IPC directory and adapter identity to:
   - request one packed generated command and observe the accepted-for-async-work
     result;
   - prove the child handler ran and its emitted event reached existing inbox
     delivery/projection state;
   - publish one packed generated event and prove exactly one child event-bus
     post per received transport callback and one resulting inbox delivery
     update for the event identity.
     Node process IPC may carry only readiness, bounded observations, and shutdown
     control; command/event payload traffic must traverse ZeroMQ.
5. **Refactor/closure.** Keep the internal adapter deep and small, remove test
   hooks that expose internals, update public observable docs, and run the
   lifecycle/runtime regression set before full verification.

### Cross-process fixture teardown and time bounds

- Create a unique absolute temporary IPC directory with private permissions and
  a deterministic test-only adapter identity shared by parent and child.
- Bound child-ready, command response, eventual delivery observation, graceful
  shutdown, and child exit separately (target 2 seconds for transport requests
  and 5 seconds for process/eventual-state phases). Timeout errors must name the
  phase, child state/exit data, expected signal type, and observed bounded
  milestones without payload bytes or secrets.
- Account for ZeroMQ pub/sub join timing with bounded repeated publication of
  one fixed event identity. Transport is not upgraded to an exactly-once
  contract: the assertion is that every received transport callback posts once
  and existing inbox dedup prevents duplicate delivery for that identity. Do
  not add sleeps or retry policy to production code.
- In `finally`, request graceful child shutdown, close the parent transport,
  await child exit, terminate only a stuck test child after the bounded grace
  interval, and remove the IPC directory. The child closes `RunningServer` and
  its owned environment/transport before acknowledging shutdown.
- The test must fail on leaked child processes, open listeners/sockets, stale
  socket files, duplicate handler/delivery observations, or timeout.

### Acceptance criteria

- Existing public `Server`/`ServerEnvironment` composition runs real
  transported command and event intake without caller callbacks or private
  source imports.
- `Server.start()` does not resolve or listen before delivery recovery and all
  context transport registrations are ready.
- The real child-process ZeroMQ fixture proves command handling, event handling,
  and environment-owned inbox delivery in the other process.
- Close/failure tests prove intake stops before delivery detach and dependency
  teardown, accepted work drains, retries do not duplicate successful phases,
  and shared/owned transport semantics remain distinct.
- Public roots add no lifecycle, broker, process, ZeroMQ, callback registry,
  query/subscription/system routing, or delivery-internal symbol.
- Public TSDoc for `Server.start()`, `RunningServer.close()`,
  `ServerEnvironment.transport`, and `RuntimeTransportBinding` describes the
  observable composition and ownership. Update `packages/server/README.md`,
  `docs/USER_GUIDE.md`, and `docs/architecture/README.md` only where needed to
  explain current same-host command/event execution and limitations. Generated
  TypeDoc/API checks remain aligned. Do not edit the to-do example; T-0040a
  owns its composition and guide proof after this seam integrates.
- Compatibility note: existing callback binding remains source-compatible;
  existing valid routes/envelopes do not change. A server with added contexts
  now activates their routes on its environment transport, so route ownership
  conflicts can fail startup rather than remaining silently unused.

### Focused gates

Run narrow tests first, then lifecycle regressions:

1. New context/server transport unit test plus
   `packages/server/test/runtime/runtime-transport.test.ts` and
   `packages/server/test/runtime/runtime-routing.test.ts`
2. `packages/server/test/bus/{command-bus,event-bus}.test.ts`, the affected
   context inbox-handoff tests, and the focused projection/process-manager
   delivery tests used by the fixture
3. `packages/server/test/server/server.test.ts` and
   `packages/server/test/server/server-lifecycle-integration.test.ts`
4. Native real child-process/ZeroMQ test plus
   `packages/transport/test/zeromq/{signal-transport,local-ipc-smoke}.test.ts`
5. `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
6. ESLint over changed TypeScript, cleanup-rule scan, and public-root/internal-
   leak scans
7. `pnpm --config.verify-deps-before-run=false docs:check:generated`, Prettier
   over exact changed files, and `git diff --check`
8. After clean review, native final task
   `pnpm --config.verify-deps-before-run=false verify`

The orchestrator should materialize the exact Vitest file list from the final
diff rather than running unrelated suites in early loops. Native execution is
required for the child-process, loopback, and ZeroMQ gates if the managed
sandbox denies IPC/listen permissions.

### Review relevance

- Style/maintainability: relevant at Terra High; check module depth, one
  lifecycle owner, naming limit, and absence of duplicate routing/lifecycle
  machinery.
- Documentation: relevant at Luna Medium; check current observable behavior,
  same-host limits, ownership, and no production/supervision claims.
- TypeScript/API docs: relevant at Terra High; verify unchanged public roots,
  callback compatibility, no internal leaks, and accurate TypeDoc.
- Performance/reliability: relevant at Terra High; inspect startup/close races,
  shared transport, command unicast/event fan-out, duplicate delivery,
  idempotent cleanup, bounded waits, and real process evidence.
- Security: no per-task lane by protocol. Carry private-directory, endpoint
  identity, untrusted envelope validation, process cleanup, and timeout evidence
  forward to T-0041.

## Parent Audit Reintegration

1. Branch T-0038a from current verified `main`. Freeze and accept it only after
   its focused gates, all four concern dispositions, final task verify, and
   matching actual dispatch metadata are durable; then merge it into `main` and
   push updated `main`.
2. Branch T-0038b from that updated `main`, never from the unmerged T-0038
   parent. Accept it only after native child-process evidence, lifecycle
   regressions, all concern dispositions, final task verify, and matching actual
   profile evidence; then merge it into `main` and push updated `main`.
3. Only after both child branches have integrated through `main`, back-merge
   updated `main` into the still-open T-0038 parent. Never back-merge either
   child branch directly into the parent before its `main` integration.
4. Resume the existing parent audit author. Rerun the matrix against integrated
   source/tests/docs/package roots; do not trust pre-child counts.
5. Reclassify the type-URL row as `IMPLEMENTED` with direct malformed-fallback
   evidence plus unchanged packing and implicit-registry preservation evidence.
   Reclassify same-host framework execution as `IMPLEMENTED` with server-owned
   context binding, lifecycle, and real child-process command/event/delivery
   evidence.
6. Keep the to-do child-process row as `EXAMPLE_GAP → T-0040` until T-0040a
   composes the now-existing public `Server`/`ServerEnvironment` seam. Its scope
   must no longer imply a missing framework callback or private import.
7. Rerun the parent's API/export, generated-clean, focused capability,
   classification, Prettier, and diff gates; then rerun every relevant parent
   reviewer concern as one complete wave. Close T-0038 only when no
   `FRAMEWORK_DEFECT` remains and the corrected matrix is independently clean.

## Shared Exclusions

- No production process supervisor, health/readiness protocol, broker cluster,
  topology discovery/policy, remote or multi-host transport, retry delay/
  backoff/jitter, or new public monitor/action/dead-letter API.
- No query, subscription, system, catch-up, import, or speculative outbound
  integration routing.
- No new Protobuf messages, generated output in VCS, public internals, raw
  delivery callbacks, handler materialization in application code, framework
  envelopes in ordinary handlers, manual transactions, schema-bearing
  decorators, aggregate `@Apply`, or example edits.
- No duplicate `Server`, `ServerEnvironment`, `RunningServer`, runtime binding,
  or delivery lifecycle abstraction.
