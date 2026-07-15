# T-0043: ZeroMQ Multipart Upstream Research

Status: Research and review complete - integration pending

Started: `2026-07-15`

Baseline commit: `c9a55871`

Branch: `task/T-0043-zeromq-multipart-upstream-research`

Worktree: `.worktrees/T-0043-zeromq-multipart-upstream-research`

Dependency: The accepted initial release and T-0042 are complete, verified,
remotely synchronized, and cleaned up.

## Objective

Complete the post-release D-0093 obligation by researching public ZeroMQ,
libzmq, ZMTP, and zeromq.js sources for the accepted SF-013 multipart
allocation residual. Preserve the human's comments, decisions, and the
reasoning behind the implemented wire boundary in a durable report.

## Human Requirements And Decisions

- Record the complete reasoning, including the human's objections and final
  decisions, in Git-tracked project sources.
- Protobuf command and event signals use generated Buf binary serialization,
  not Node V8 serialization.
- Keep 8 MiB as a hard upper limit for each inbound ZeroMQ frame. It is a
  rejection ceiling, not a fixed allocation or ordinary signal size.
- Consume only the first two request/publish frames and ignore later trailers.
  Replies consume their first meaningful frame and ignore later trailers.
- The human accepts, for this release stage, the remaining local availability
  risk from a peer that can reach the private ZeroMQ endpoint and append junk.
- Determine whether the behavior is already known, what workarounds exist, and
  whether Spine TS appears to have found a previously undocumented limitation.
- Do not change production code, public contracts, dependencies, or release
  acceptance. This task records post-completion research only.
- Never read, edit, stage, move, delete, or use root
  `human-review-1-jul.md`.

## Acceptance Criteria

1. A durable report distinguishes sourced facts from project inference and
   records the human's comments and decisions explicitly.
2. Primary upstream sources establish ZeroMQ multipart atomicity and memory
   behavior, `ZMQ_MAXMSGSIZE` scope, zeromq.js whole-message receive behavior,
   and relevant queue/security controls.
3. The report evaluates real and non-working mitigations without claiming that
   post-receive checks prevent already-incurred native allocation.
4. The novelty conclusion is calibrated to the bounded public search and does
   not claim proof that Spine TS was first.
5. The completion plan and D-0093 link the completed research without reopening
   the accepted initial release.
6. Focused formatting, docs/status, relative-link/release-readiness, and diff
   checks pass; relevant canonical review concerns are recorded.
7. The task branch and updated `main` are pushed to `origin`, and the clean
   merged worktree/local branch are removed.

## Execution And Review Scope

- Deep architecture planning: N/A. This task changes no runtime, domain,
  serialization, public API, transaction, concurrency, or persistence contract.
- Implementation owner: the orchestrator authors the bounded research record;
  no production-code implementer is needed.
- Documentation review: relevant, existing `documentation_reviewer`, explicit
  `gpt-5.6-luna` / medium.
- Style/maintainability: N/A because no code or maintainable runtime/tooling is
  changed; the focused formatter and diff checks cover document mechanics.
- TypeScript/API docs: N/A because no package export, declaration, TypeDoc,
  API contract, or public package documentation changes.
- Performance/reliability: N/A as a code-review lane because no executable
  behavior changes; the research report itself must accurately characterize
  the accepted resource risk and mitigations.
- Security: N/A under the per-task protocol. The final security gate already
  accepted SF-013, and this task changes no trust boundary or mitigation.

Historical and superseded text is non-actionable unless the current task,
completion plan, D-0093, or changed research report claims it as active state.
