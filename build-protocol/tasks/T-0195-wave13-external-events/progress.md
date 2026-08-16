# T-0195 Progress

## 2026-08-15 — Startup

- Classified Wave 13 as high-risk.
- Verified fetched `origin/main` at the required Spine TS baseline and verified
  the remote exposes exactly `main` with no tags.
- Inspected the protected primary checkout read-only and recorded its dirty
  state without mutation.
- Created isolated branch/worktree `wave-13-external-events` from
  `origin/main`.
- Reserved T-0195 for the planning gate. Product implementation has not begun.
- Next: complete required reading and dispatch the single requirements splitter.

## 2026-08-15 — Planning evidence

- Completed the mandatory pinned JVM production, contract, test, and fixture
  reading at `0779b5fa42ca5cebd0d2935fc3a3489ab47846dc`.
- Inspected current TypeScript context, bus, generated-handler,
  ServerEnvironment, ContextTransport, SignalTransport, ZeroMQ, tenant, and
  frozen-Proto flows and recorded the execution trace/dispositions.
- Verified all canonical expected skills are present; installed the workspace
  from the frozen lockfile in the isolated worktree.
- Focused baseline test attempt failed before collection because fresh
  workspace package build outputs were absent (`@spine-event-engine/core` and
  `@spine-event-engine/proto` entry resolution). This is a setup-order failure,
  not a behavior result. Corrective action: run the repository generated build,
  then repeat the identical focused tests.
- The requirements splitter identified a possible multi-publisher ZeroMQ
  topology divergence. The orchestrator returned a narrower adapter-private
  PUSH/PULL endpoint-directory substitution for invariant analysis before any
  blocker is accepted. No product code has begun.
- The direct `typecheck:build:generated` correction also failed before compile
  because it assumes Protobuf-ES outputs already exist. Canonical correction is
  `proto:generate` followed by the generated build, then the identical tests.
- The splitter confirmed the adapter-private PUSH/PULL endpoint directory is
  viable with the existing ZeroMQ settings: per-channel secure manifests,
  dedicated subscriber endpoints, publisher fan-out, per-link FIFO,
  backpressure, stale cleanup, and status-based late-start recovery. It adds no
  public configuration, wire field, broker policy, or durability claim, so the
  possible divergence is resolved and is not a human blocker.
- Canonical setup then passed: `proto:generate` verified 47 source checksums and
  52 frozen descriptor files; `typecheck:build:generated` passed; the repeated
  focused baseline passed 4 files / 208 tests for EventBus, handler analysis,
  BoundedContext, and ZeroMQ SignalTransport.
- The sole requirements splitter completed with all required deliverables and
  no blocker. Deterministic planning verification passed after formatting six
  new Markdown records; the package contains 28 human requirements, 45 exact
  substitution rows, and 22 RED designs.
- The complete four-concern planning review wave returned ten accepted
  findings. One consolidated correction batch now freezes exact ownership,
  public signatures, the correct `bounded_context_name` field, adapter cache
  and fan-out failure semantics, atomic wanted-set replacement, expanded RED
  proofs, and truthful review-pending status. Focused re-review is next.
- Focused re-review passed all four canonical planning concerns. Style's two
  residual conditional phrases were made deterministic and confirmed. T-0195
  is accepted for the T-0196 RED gate; executable behavior is still unchanged.

## 2026-08-16 — Execution through T-0200 review

- T-0196 retained all 22 failing-before acceptance designs. T-0197a/b/c,
  T-0198, and T-0199 delivered the exact wire contracts, typed transport seam,
  domestic/external generated metadata and EventBus filtering, cross-process
  harness, in-memory/ZeroMQ adapters, and three-exchange IntegrationBroker.
- T-0200 integrated context ownership, ServerEnvironment transport ownership,
  tenant-aware import, and the public ThirdPartyContext candidate. Its retained
  canonical task profile passed 10 files / 153 tests, and exact changed-range
  LCOV is 97.92% executable lines / 90.16% branches.
- The T-0200 specialist wave found an unavoidable Node public-contract decision:
  Protobuf-ES `Message` does not retain its generated `MessageSchema`, while
  arbitrary third-party event encoding and canonical type-URL derivation require
  that schema. No application registry is owned by ThirdPartyContext or its
  hidden BoundedContext. The present StringValue-only implementation is not JVM
  parity.
- Per the binding substitution gate, execution is paused before product
  correction, integration, T-0201, and T-0202 until the human selects an
  approved schema-provisioning public substitution. The remaining lifecycle,
  timestamp, wanted-interest, and readiness corrections are fully identified
  and queued behind that decision.

## 2026-08-16 — Schema decision resolved

- The human confirmed the application schema-universe rule: the server
  application knows the domain Proto models of every assembled Bounded Context.
  The generated application TypeRegistry is therefore the approved process-wide
  read-only schema catalog supplied by ServerEnvironment to all contexts,
  including ThirdPartyContext.
- A local unknown ThirdParty message rejects publication. A received unknown or
  undecodable external event is logged at ERROR and dropped without failing the
  broker or application. Schemas remain out of the wire contract.
- The P0 substitution gate is resolved. T-0200 resumes with the single
  consolidated specialist correction batch before focused re-review and
  integration.
