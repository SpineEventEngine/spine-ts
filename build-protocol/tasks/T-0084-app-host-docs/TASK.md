# T-0084: Application hosting and beginner documentation

Status: Synchronizing with current main
Start: `2026-07-31`
Baseline commit: `9d8c2c76d3c1d44abd727d9b53e54ee39a31356f`
Branch: `task/T-0084-app-host-docs`
Worktree: `.worktrees/T-0084-app-host-docs`

Task classification: High-risk

The task introduces a public application-hosting contract, moves lifecycle and
authentication-boundary plumbing out of an example, and changes the learning
surface of every production and example package.

## Objective

Provides a small framework-owned way to start a Spine application as either a
native gRPC server or a browser-facing gRPC-over-HTTP server. Reworks package
and example documentation into friendly human entry points with separate
agent references. Uses the new host in Chat, removes example-owned generic
hosting machinery, verifies every documented startup, and leaves the Chat UI
and its server running for human inspection.

## Human-Imposed Requirements Ledger

1. Every module, including private example modules, must have documentation.
2. Each module must have a human-oriented `README.md` that explains its purpose
   to beginners, teaches normal use in simple language, and includes current
   code or command examples.
3. Detailed agent-oriented architecture, extension, limitation, test, and
   internal-mechanics material belongs in `REFERENCE.md`.
4. Every human README must link explicitly to its agent-oriented reference and
   identify that audience.
5. Human READMEs must adopt the friendly look and content patterns demonstrated
   by the root validation-ts README: an immediate purpose statement, visible
   benefits/features, approachable navigation, quick starts, compact examples,
   useful repository/package maps, development commands where relevant, and
   related links. The project must apply these patterns thoughtfully rather
   than copy text or decorative elements blindly.
6. No public documentation may expose internal project-management wording,
   task IDs, wave names, remediation history, reviewer terminology, or cryptic
   implementation jargon as current user guidance.
7. Multi-module examples must have a foundational family README that explains
   the complete application and its modules to beginners and to agents learning
   the example.
8. Documentation, links, commands, and inline snippets must be accurate against
   the final code and copy-paste usable from their documented location.
9. The framework must provide an easy, no-boilerplate way to start any Spine
   application, including native gRPC-only applications and applications that
   expose gRPC over HTTP to browsers.
10. End users must not recreate generic listener, routing, CORS, readiness,
    signal, shutdown, rollback, timeout, credential-extraction, or test-seam
    machinery in each application.
11. Application code should supply its bounded context, storage choice,
    application-specific authorization/authentication adapter, and concise host
    configuration; framework modules own generic hosting behavior.
12. Chat must use the new framework facility. Generic example-only hosting
    machinery, including the responsibilities currently placed in
    `local-server-seams.ts` and `local-lifecycle.ts`, must be removed or reduced
    to genuinely Chat-specific policy.
13. The standalone Chat server and the standalone web UI must each start with
    one npm or pnpm command.
14. The final Chat server and web UI must be launched again and left available
    for human inspection, with the exact commands and clickable URL reported.
15. Use test-first development for new runtime behavior and preserve resource,
    authentication, tenant, actor, and shutdown semantics.
16. Do not build Spine JVM during this task.
17. Do not read, edit, stage, move, delete, or otherwise use
    `human-review-1-jul.md` or `human-review-22-jul.md`.
18. Commit and push the task branch immediately after every commit. Merge only
    after review and verification, post-merge verify, and push `main`.

## Acceptance Criteria

1. A documented public hosting API starts a supplied Spine application using
   native gRPC with one concise call and deterministic readiness/shutdown.
2. The same hosting surface, or one clearly related option on it, exposes the
   application over the supported browser HTTP transport without requiring
   application-owned listener/routing/lifecycle boilerplate.
3. Focused tests demonstrate RED then GREEN for native hosting, browser hosting,
   startup rollback, signal-safe shutdown, concurrent/retry close, CORS, and
   authentication-context propagation as applicable to the chosen design.
4. Chat contains only domain/application policy around the framework host and
   its complete local server entrypoint is short enough to teach directly.
5. Every workspace package and example entry README conforms to the human
   documentation rules, has an accurate agent-reference link, and contains no
   misplaced internal material.
6. Every companion `REFERENCE.md` contains the detailed material removed from
   its README without losing important behavior, limitations, extension points,
   or agent guidance.
7. Documentation links, package snippets, exports, TSDoc, generated typechecks,
   focused tests, full verification, and global coverage gates pass.
8. Every documented example startup succeeds in the isolated worktree.
9. Chat's real browser acceptance proves a visible server-backed operation with
   no unexpected browser or server error.
10. All four canonical review concerns converge, the task branch and `main` are
    pushed, remote equality is proven, and the live Chat URL responds afterward.

## High-Risk Assumptions And Boundaries

- Prefer a shallow JVM-familiar hosting facade over a configurable hosting
  framework. Do not expose internal lifecycle seams merely to make tests easy.
- Reuse and deepen existing `server`, `client-node`, `client-web`, and `auth`
  responsibilities. Add a new package only if the splitter proves existing
  ownership cannot remain coherent.
- Browser transport and native gRPC may share lifecycle ownership while keeping
  their protocol adapters explicit and type-safe.
- A development authentication convenience must be visibly local-only and must
  not weaken the production gateway trust model.
- No Spine JVM build, npm publication, storage redesign, identity-provider
  implementation, or deployment topology expansion is in scope.
- Generated Protobuf and handler-registry output remains ignored and untracked.

## Requirements Splitter Dispatch

- Existing role: `requirements_splitter`.
- Scope: inspect current server/auth/client and Chat hosting code; design the
  smallest public hosting contract and dependency-ordered implementation/docs
  slices satisfying the ledger.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: high.
- Both fields must be explicit in dispatch.
- The child is read-only, must not spawn subagents, build Spine JVM, or inspect
  the protected human-review files.
- Runtime metadata or the immutable configured role/profile and its
  self-introspection limitation must be recorded before acceptance.

## Requirements Splitter Acceptance

- Result: accepted on 2026-07-31.
- Plan: `build-protocol/planning/T-0084_APP_HOST_DOCS_PLAN.md`.
- Configured role: `requirements_splitter`.
- Configured model: `gpt-5.6-sol`.
- Configured reasoning: high.
- Dispatch confirmation: model and reasoning were explicit.
- Runtime self-metadata was unavailable. The immutable configured role/profile
  is accepted evidence under the protocol.
- Design outcome: deepen `Server` with explicit process-owned and authenticated
  browser modes; add no package or parallel application abstraction; keep
  auth policy application-owned and generic transport/lifecycle framework-owned.
- Documentation outcome: enforce 23 human README/agent reference pairs and
  audit all 32 repository README surfaces.

## Implementation Dispatch

- Existing role: `implementer`.
- Scope: execute the accepted plan serially as the only writer for production,
  examples, tests, documentation, manifests, and task records.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: medium.
- Both fields must be explicit in dispatch.
- Selected skills: `implement`, `test-driven-development`,
  `verification-before-completion`, and `requesting-code-review`; the owner
  must read them fully before governed work.
- The owner must use observed RED tests before runtime changes and must not
  spawn subagents, commit, push, build Spine JVM, or inspect either protected
  human-review file.
- Runtime metadata or the immutable configured role/profile and its
  self-introspection limitation must be recorded before acceptance.

## Implementation Acceptance

- Result: accepted for specialist review on 2026-07-31.
- Configured role: `implementer`.
- Configured model: `gpt-5.6-terra`.
- Configured reasoning: medium.
- Dispatch confirmation: model and reasoning were explicit.
- Runtime self-metadata was unavailable. The immutable configured role/profile
  is accepted evidence under the protocol.
- Runtime outcome: `Server.run()` owns process signals; optional authenticated
  browser hosting owns private-native/public-browser topology, CORS, strict
  credential extraction, routing, rollback, and shutdown.
- Example outcome: Chat uses the framework host and deletes its generic local
  CORS, listener, lifecycle, and test-seam modules.
- Documentation outcome: the root, every production package, every example,
  and specialized README surfaces were rewritten or audited for beginner
  readability; dense maintainer material moved to `REFERENCE.md`.

## Review Plan

- Style/maintainability: required for framework ownership and example removal.
- Documentation: required for every README/reference and public claim.
- TypeScript/API docs: required for the new public startup contract and snippets.
- Performance/reliability: required for listener lifecycle, rollback, shutdown,
  transport behavior, and authentication context.
- Security: no separate task lane under the protocol; authentication boundary
  findings remain blocking in the relevant API/reliability concerns.

## Pre-Integration Evidence

- All four canonical review concerns converged cleanly after the accepted
  correction batch.
- The full repository gate passed 3,246 tests with 90.01% branch coverage;
  build, typecheck, lint, TSDoc, formatting, TypeDoc/API, Proto,
  generated-output, and release-readiness checks were clean.
- The branch must now integrate the newer verified `main`, rerun the
  change-sensitive release profile, and complete merge, remote equality, and
  live Chat acceptance.
