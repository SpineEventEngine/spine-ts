# T-0074: Wave 4 Browser Client and Interoperability Plan

Status: Complete

Implementation status: the Wave 4 plan is documented, reviewed, and verified;
no Wave 4 production implementation has started

## Objective

Convert the completed Wave 4 Q&A into one canonical, executable,
agent-readable plan that freezes browser clients, React integration,
subscription limitations, standalone authentication, federated sign-in,
TS/JVM interoperability, Chat, documentation, review, and verification
boundaries without modifying production code.

## Classification

High-risk. Wave 4 introduces public packages, browser/runtime boundaries,
credential and session flows, serialized request rewriting, cross-runtime
interoperability, and security-sensitive deployment assumptions.

## Human Requirements Ledger

- Transform the current `client` package into `client-node`; add separate
  `client-web` and `client-react` packages.
- Keep `client-web` framework-neutral. React is the only Wave 4 framework
  adapter and lives in its own package.
- Use gRPC-Web as the universal browser protocol and Connect as an explicit
  optional optimization.
- Interoperate with unmodified Spine TS and Spine JVM Command, Query, and
  Subscription services.
- Create a standalone provider-neutral `auth` module/gateway. Bounded contexts
  configure no authentication routines and trust gateway-rewritten
  `ActorContext`.
- Model authorization input as typed `IncomingRequest`, not `SpineOperation`.
- Support opaque stored sessions, signed application-session tokens, cookies,
  and bearer credentials.
- Support generic OIDC plus first-class configurable Google and GitHub sign-in.
  Provider credentials/tokens remain server-side by default.
- Return informational actor, tenant, and expiry to the client, but revalidate
  the application session, authorize the request, and reconstruct context for
  every request.
- Keep the reference Envoy/private-backend topology configurable. Document its
  trust assumptions; do not claim the framework enforces a user's deployment.
- Treat subscriptions as best-effort notifications. No completeness,
  exactly-once, global-order, or intermediate-state guarantee exists.
- Reconnect automatically with visible lifecycle state; re-query Entity state;
  notify `gapPossible` and continue event subscriptions.
- The earlier Wave 6 cluster-complete guarantee is superseded by best-effort
  cluster-wide notification reachability.
- Keep explicitly exposed event subscriptions. Chat messages remain Projection
  entities, not events.
- Use React through `client-react`; `use...` is allowed only for React-specific
  hooks, while Spine operations retain `post`, `send`, `create`, `activate`,
  and `cancel`.
- Use standalone `ChatMessageView` Projections and the Wave 3 model packages.
- Test current Chromium, Firefox, and WebKit.
- Freeze a Spine JVM commit, do not modify JVM code, and test browser → Envoy →
  auth gateway → TS/JVM.
- Produce extensive human- and agent-oriented documentation with limitations,
  extension contracts, diagrams, and third-party sign-in examples.
- Defer npm publication until all waves are complete.
- Preserve unrelated files and never read or modify `human-review-1-jul.md`.
- Push `origin` immediately after every commit.

## Planning Assignment Gate

- Existing role: `requirements_splitter`.
- Function: bounded read-only validation of the frozen Wave 4 plan for missing
  human decisions, dependency errors, unacknowledged security contracts, or
  work that belongs to Waves 5/6.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: `high`.
- Both fields must be explicit in dispatch. The child may not edit, commit,
  push, merge, or spawn children.

## Reader-Test Gate

The completed plan must be tested from a fresh context for these reader tasks:

- explain the package boundaries;
- explain why the auth gateway works with both TS and JVM;
- trace Google and GitHub sign-in into an application session;
- distinguish provider credentials, application-session credentials, and
  `ActorContext`;
- state subscription and reconnection guarantees without overstating them;
- explain Chat's Projection model;
- identify Wave 4 versus Wave 5/6 ownership;
- implement a custom identity mapping, session manager, and authorization
  policy using only documented extension points.

## Acceptance Criteria

- `WAVE_4_BROWSER_CLIENT_INTEROPERABILITY_PLAN.md` records every approved Q&A
  decision, diagram, third-party flow, limitation, and extension requirement.
- `DECISION_LOG.md` and `PROJECT_COMPLETION_PLAN.md` agree with the frozen plan.
- No unresolved product question remains.
- The requirements splitter finds no blocking contradiction or missing human
  decision.
- Fresh-reader testing can answer the required tasks without conversation
  context and surfaces no material ambiguity.
- Markdown formatting, links, and repository documentation checks pass.
- The planning branch is committed, immediately pushed, reviewed as required
  for a documentation-only high-risk plan, merged to `main`, post-merge
  verified, and pushed only when the human subsequently authorizes that
  integration boundary or the protocol treats this planning record as the
  active task closure.

## Out of Scope

- Production implementation of any Wave 4 package.
- Spine JVM changes.
- Wave 5 deployment productionization.
- Wave 6 horizontal propagation.
- npm publication.
