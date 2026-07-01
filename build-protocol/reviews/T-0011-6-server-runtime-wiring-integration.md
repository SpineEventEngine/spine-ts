# Review Log: T-0011.6 Server Runtime Wiring Integration

Status: Pending

## Required Review Lanes

- Code style/maintainability:
  `019f1b8a-31c5-7b21-b4dc-f34289c0ee8e` comments; closed.
- Documentation completeness:
  `019f1b8a-3245-7de0-a1b2-5fe37e75c387` comments; closed.
- TypeScript/API docs: `019f1b8a-32c0-70e0-a543-2e833cd85848` comments;
  closed.
- Security: `019f1b8a-3342-7a72-b1c6-b32040073bc2` comments; closed.
- Performance/reliability: `019f1b8a-33de-7bb0-829e-10d711f556c0` comments;
  closed.
- Round 2 code style/maintainability:
  `019f1b9f-83c9-7ae0-ab53-d61e191ada51` comments; closed.
- Round 2 documentation completeness:
  `019f1b9f-8469-75e1-8745-4e94a46f4dea` clean; closed.
- Round 2 TypeScript/API docs:
  `019f1b9f-84d0-76c3-ae45-be17e36aad26` comments; closed.
- Round 2 security: `019f1b9f-8567-7520-a4cd-0ad64db5cd9c` comments;
  closed.
- Round 2 performance/reliability:
  `019f1b9f-85da-7ef3-8a73-3d585d5be9ac` comments; closed.

## Agent Ledger

- Implementation sub-agent:
  `019f1b72-d92b-77c3-bea5-b734213b1035` (`Curie the 7th`) spawned on
  `2026-07-01 03:12 WEST`; returned `STATUS: DONE` with commit `67a217b`;
  closed by orchestrator after report was consumed.
- Round 1 code style/maintainability reviewer:
  `019f1b8a-31c5-7b21-b4dc-f34289c0ee8e` (`Aquinas the 7th`) spawned;
  returned comments; closed.
- Round 1 documentation reviewer:
  `019f1b8a-3245-7de0-a1b2-5fe37e75c387` (`Anscombe the 7th`) spawned;
  returned comments; closed.
- Round 1 TypeScript/API reviewer:
  `019f1b8a-32c0-70e0-a543-2e833cd85848` (`Nietzsche the 7th`) spawned;
  returned comments; closed.
- Round 1 security reviewer:
  `019f1b8a-3342-7a72-b1c6-b32040073bc2` (`Zeno the 7th`) spawned; returned
  comments; closed.
- Round 1 performance/reliability reviewer:
  `019f1b8a-33de-7bb0-829e-10d711f556c0` (`Peirce the 7th`) spawned;
  returned comments; closed.
- Round 1 fix sub-agent:
  `019f1b8e-bc7f-73e3-a79e-53b93615b055` (`Mill the 7th`) spawned to address
  all round-one findings; returned `STATUS: DONE` with commit `2375ee5`;
  closed by orchestrator after report was consumed.

The root thread does not expose `list_agents`; the orchestrator must track every
spawned T-0011.6 sub-agent ID here and close each agent immediately after its
result is consumed.

## Round 2 Reviewer Agents

- Round 2 code style/maintainability reviewer:
  `019f1b9f-83c9-7ae0-ab53-d61e191ada51` (`Arendt the 7th`) spawned;
  returned comments; closed.
- Round 2 documentation reviewer:
  `019f1b9f-8469-75e1-8745-4e94a46f4dea` (`Planck the 7th`) spawned;
  returned `STATUS: CLEAN`; closed.
- Round 2 TypeScript/API reviewer:
  `019f1b9f-84d0-76c3-ae45-be17e36aad26` (`Descartes the 8th`) spawned;
  returned comments; closed.
- Round 2 security reviewer:
  `019f1b9f-8567-7520-a4cd-0ad64db5cd9c` (`Franklin the 8th`) spawned;
  returned comments; closed.
- Round 2 performance/reliability reviewer:
  `019f1b9f-85da-7ef3-8a73-3d585d5be9ac` (`Jason the 8th`) spawned;
  returned comments; closed.

## Round 1 Findings

### Code Style/Maintainability

- High: event worker/subscriber identifiers derive from handler method names,
  making handler renames externally visible and leaking handler internals.
- Medium: server-local logical-name normalization duplicates transport-owned
  logical ID validation/canonicalization policy.
- Medium: the root `@spine-ts/server` API exports every intermediate route
  flavor and planner detail, broadening the public surface for a minimal seam.

### Security

- High: planner dereferences nested readiness metadata directly from
  caller-supplied lookup objects, so accessor/proxy metadata can execute during
  planning or surface raw JS exceptions instead of deterministic validation
  failures.
- Medium: public route entries embed full readiness metadata (`assignee` and
  `receiver`), including handler/entity/registered-handler details across the
  routing seam.
- Medium: event subscriber/worker identifiers are derived from entity full type
  names and handler method names, leaking handler details through transport
  identifiers.

### Performance/Reliability

- High: planner trusts nested handler schema/kind values after validating only
  top-level message names, allowing malformed readiness metadata to emit
  misrouted plans instead of explicit failures.
- Medium: event worker identifiers use lossy normalized names, allowing
  distinct receivers to collapse to the same worker ID and merge registrations.

### Documentation

- Medium: `packages/server/README.md` says `createServerRuntimeRoutingPlan()`
  returns only immutable transport-owned contracts, which is inaccurate for the
  current plan shape with context/deferred data and readiness metadata.
- Low: `docs/api/README.md` top-level current-status summary does not mention
  the new runtime-routing seam.

### TypeScript/API

- Public `ServerRuntimeRoutingPlanInput` accepts interface-based custom
  lookups, but route entries store returned assignee/receiver objects by
  reference, so mutable custom lookups can mutate the supposedly immutable
  plan after creation.
- Custom readiness metadata is only partially validated, producing incidental
  low-level failures instead of deterministic routing-plan rejections.

## Round 1 Fix Evidence

- Fixed the public routing seam in `packages/server/src/runtime-routing.ts` so
  command/event routes expose only planner-local route IDs, planner-local
  worker IDs, receiver groups, and sanitized message full type names/type URLs.
  Raw readiness metadata objects (`assignee`, `receiver`, `entityHandlers`,
  `entityType`, `registeredHandler`, and handler objects) are no longer
  retained by public route entries.
- Replaced handler/entity-derived transport participant IDs with deterministic
  indexed planner-local IDs (`command-worker-1`,
  `event-<group>-worker-<n>`, `command-route-<n>`,
  `event-<group>-route-<n>`). This removes handler/entity leakage and removes
  the lossy server-local normalization path that previously collapsed distinct
  receivers.
- Narrowed `ServerRuntimeRoutingPlanInput` to concrete
  `CommandRegistrationReadiness` / `EventRegistrationReadiness` instances and
  added deterministic malformed-metadata validation for handler kind,
  message-full-type, and schema/type-name consistency before deriving topics.
  Malformed schemas now fail closed with stable `TypeError` messages instead of
  surfacing raw JS/proxy errors.
- Reduced the root `@spine-ts/server` public API by dropping the intermediate
  route-flavor type re-exports from `packages/server/src/index.ts` and updating
  `scripts/check-api-docs.mjs` to the smaller 130-export server surface.
- Added focused regression coverage in
  `packages/server/src/runtime-routing.test.ts` for sanitized route descriptors,
  rejection of non-readiness lookup objects, malformed metadata handling, and
  planner-local ID collision resistance. Focused GREEN:
  `corepack pnpm exec vitest run packages/server/src/runtime-routing.test.ts packages/server/src/index.test.ts`
  passed with 2 files / 18 tests on `2026-07-01 03:56 WEST`.
- Full verification GREEN on `2026-07-01 03:56 WEST`:
  `CI=true corepack pnpm verify` passed with 24 files / 288 tests and coverage
  95.85% statements / 90.01% branches / 99.38% functions / 95.79% lines.

## Round 2 Findings

### Code Style/Maintainability

- Low: `withDeterministicValidation()` preserves or rewrites errors by
  matching human-readable message prefixes, creating maintenance coupling
  between validation branches and the prefix list.

### Documentation

- Clean: no documentation findings remain.

### Security

- High: proxy-wrapped concrete readiness instances can still execute
  attacker-controlled proxy traps during planning before deterministic
  validation rejects the metadata. The raw route-shape leak,
  handler/entity-derived transport IDs, and ZeroMQ/socket/process/storage
  exposure remain closed.

### Performance/Reliability

- High: proxy-wrapped concrete readiness instances can still surface raw
  exceptions before deterministic validation runs. Worker-ID collision,
  deterministic ordering, and no-dispatch/storage/network/process/retry
  boundaries remain closed.

### TypeScript/API

- Medium: public command/event route types still expose full topic,
  subscription, and worker contracts on every route even though those are
  already available at the plan level, broadening the route shape beyond the
  documented minimal descriptor.
- Medium: `scripts/check-api-docs.mjs` only checks for missing expected server
  exports and does not reject unexpected new exports, so the smaller public API
  surface is not actually frozen by `docs:check`.

## Round 2 Fix Agent

- Round 2 fix sub-agent:
  `019f1ba4-1b69-79d0-ac8d-e90bdff91112` (`Curie the 8th`) spawned to address
  the remaining proxy/raw-exception, validation sentinel, minimal route shape,
  and unexpected-export guard findings; returned `STATUS: DONE`; closed by
  orchestrator after report was consumed.

## Round 2 Fix Evidence

- Updated `packages/server/src/runtime-routing.ts` to reject Proxy-wrapped
  `CommandRegistrationReadiness` / `EventRegistrationReadiness` instances
  before `instanceof` checks or readiness method calls, using the same
  `node:util` `types.isProxy()` pattern already used elsewhere in the repo.
  Planning now fails closed with deterministic `TypeError` messages instead of
  surfacing proxy trap exceptions.
- Replaced the message-prefix preserve list inside
  `withDeterministicValidation()` with a tagged internal
  `DeterministicValidationError`, so targeted validation failures survive
  wrapping without depending on human-readable prefixes.
- Shrunk public command/event route descriptors so each route now exposes only
  planner-local route/worker IDs, receiver group, sanitized message
  full-type/type-URL data, and correlation keys back to the plan-level
  topics/subscriptions/workers. Full transport topic/subscription/worker
  contracts remain available only through the plan-level arrays.
- Tightened `scripts/check-api-docs.mjs` so `docs:check` rejects unexpected
  `@spine-ts/server` root exports in addition to missing expected exports from
  the TypeDoc model.
- Added regression coverage in `packages/server/src/runtime-routing.test.ts`
  proving proxy-wrapped readiness inputs are rejected deterministically before
  any proxy trap runs, and that public routes expose correlation keys instead
  of embedded transport contracts.
- Round 2 fix RED/GREEN on `2026-07-01 04:13-04:15 WEST`:
  `corepack pnpm exec vitest run packages/server/src/runtime-routing.test.ts`
  first failed against embedded route contracts and late proxy rejection, then
  `corepack pnpm exec vitest run packages/server/src/runtime-routing.test.ts packages/server/src/index.test.ts`
  passed with 2 files / 20 tests after the planner emitted correlation-key
  route descriptors and rejected proxy readiness inputs up front.
- Round 2 verification passed on `2026-07-01 04:16 WEST`:
  `corepack pnpm typecheck`, `corepack pnpm docs:check`, and
  `git diff --check` all passed. Escalated `CI=true corepack pnpm verify`
  passed with native IPC access: 24 test files / 290 tests, coverage 95.88%
  statements / 90.05% branches / 99.38% functions / 95.82% lines, TypeDoc/API
  checks with 100 proto / 28 core / 130 server / 26 storage / 46 transport
  exports, copied Spine proto checksum verification, proto lint/generate, and
  generated-clean all passed. TypeDoc emitted the existing invalid-`origin`
  warning only.

## Round 3 Reviewer Agents

- Round 3 code style/maintainability reviewer:
  `019f1bb1-4199-7622-b336-7af5528a4a69` (`Erdos the 8th`) spawned;
  returned `STATUS: CLEAN`; closed.
- Round 3 documentation reviewer:
  `019f1bb1-4222-74e2-8370-b33d6f59614e` (`Averroes the 8th`) spawned;
  returned comments; closed.
- Round 3 TypeScript/API reviewer:
  `019f1bb1-42a9-79a3-a87d-d540039f84d0` (`Mendel the 8th`) spawned;
  returned `STATUS: CLEAN`; closed.
- Round 3 security reviewer:
  `019f1bb1-431e-77b0-8957-db45498ee065` (`Lagrange the 8th`) spawned;
  returned comments; closed.
- Round 3 performance/reliability reviewer:
  `019f1bb1-43a0-7240-a6e1-b866b82e959b` (`McClintock the 8th`) spawned;
  returned `STATUS: CLEAN`; closed.

## Round 3 Results

- Code style/maintainability: clean. The validation helper now uses the tagged
  `DeterministicValidationError` path instead of matching message prefixes.
- TypeScript/API: clean. Public route descriptors now carry planner-local IDs,
  sanitized message metadata, and correlation keys instead of repeated full
  topic/subscription/worker objects, and the API docs guard rejects unexpected
  `@spine-ts/server` root exports.
- Performance/reliability: clean. Proxy-wrapped readiness is rejected before
  readiness method calls, ordinal planner-local IDs avoid lossy worker
  collisions, deterministic ordering remains stable, and no
  dispatch/storage/network/process/retry behavior was introduced.
- Documentation: one medium wording issue remained. `packages/server/README.md`
  said `createServerRuntimeRoutingPlan()` required concrete readiness instances
  even though command/event readiness inputs are optional and omitted readiness
  produces empty command/event plans.

## Round 3 Documentation Fix

- Updated `packages/server/README.md` to state that
  `createServerRuntimeRoutingPlan()` requires a built `BoundedContext` and
  accepts optional concrete command/event readiness instances. The docs now
  state that omitted readiness produces an empty command or event plan.
- Verification after the documentation fix: `corepack pnpm docs:check` passed
  with the existing invalid-`origin` TypeDoc warning only, and
  `git diff --check` passed.

## Round 3 Security Finding

- High: `validateCommandReadiness()` / `validateEventReadiness()` still use
  `instanceof` as the concrete-readiness gate. A prototype-forged object can
  pass that gate and override readiness methods, allowing attacker-supplied
  methods to execute during planning before deterministic metadata validation.

## Round 3 Security Fix Agent

- Focused security fix sub-agent:
  `019f1bb5-32f2-7903-9cca-b7233af4889b` (`Ramanujan the 8th`) spawned to add
  an unforgeable readiness authenticity gate and update runtime-routing tests;
  returned `STATUS: DONE` with commit `450c16f`; closed by orchestrator after
  report was consumed.

## Round 3 Security Fix Evidence

- Added module-local authenticity tokens and `WeakSet` tracking to
  `CommandRegistrationReadiness` and `EventRegistrationReadiness`. Only package
  factory-created readiness instances are enrolled as authentic.
- Added package-internal authenticity guards and changed `runtime-routing` to
  reject unauthentic readiness values before readiness method calls. This
  rejects both Proxy-wrapped real readiness instances and prototype-forged
  readiness-like objects without running traps or overrides.
- Updated `packages/server/src/runtime-routing.test.ts` to prove forged
  readiness overrides and proxy traps do not run.
- Focused RED/GREEN from the fix sub-agent: `corepack pnpm exec vitest run
packages/server/src/runtime-routing.test.ts` failed with 4 failing tests
  before implementation, then passed with 11/11 tests after the authenticity
  guard.
- Focused verification from the fix sub-agent passed:
  `corepack pnpm exec vitest run packages/server/src/runtime-routing.test.ts packages/server/src/index.test.ts`
  passed with 21/21 tests, `corepack pnpm typecheck` passed,
  `corepack pnpm docs:check` passed, and `git diff --check` passed.

## Final Targeted Reviewer Agents

- Final targeted documentation reviewer:
  `019f1bba-c139-7f71-85f3-951ca0897191` (`Kepler the 8th`) spawned;
  returned `STATUS: CLEAN`; closed.
- Final targeted security reviewer:
  `019f1bba-c1d0-7961-8d3d-42c528ab0184` (`Gauss the 8th`) spawned;
  returned `STATUS: CLEAN`; closed.

## Final Targeted Results

- Documentation: clean. `packages/server/README.md` now matches the optional
  readiness behavior and does not imply services, dispatch, or storage.
- Security: clean. Runtime routing rejects unauthentic readiness objects before
  readiness methods or proxy traps can run, public route shape remains narrowed,
  root server exports remain constrained, and no raw route/handler/entity
  leakage remains.

All required review lanes are clean after round three and final targeted
re-review. All T-0011.6 implementation, fix, and reviewer sub-agents spawned by
this root session were closed after their results were consumed.
