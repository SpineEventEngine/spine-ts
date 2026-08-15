# T-0187 Review Log

Status: Pre-review mechanics clean; specialist wave prepared

## Mechanical Pre-Review

- First `pnpm format:check` found formatting drift in four task-record files.
  Repository Prettier corrected only those files.
- Repeated `pnpm format:check`: pass.
- `git diff --check`: pass.
- `node scripts/check-doc-audience.mjs`: pass.

## Specialist Assignments

All assignments are read-only and explicitly prohibit child subagents.
Desktop accepts explicit role profiles but exposes no runtime model/token/
latency telemetry; configured role/profile is therefore the acceptance evidence
unless a visible mismatch or inherited fallback occurs.

| Concern                    | Existing role / bounded function                                                                                                                                        | Explicit profile       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Documentation completeness | `documentation_reviewer`; verify Wave 12 claims, exclusions, current documentation ownership, task evidence, and P-04 truthfulness                                      | `gpt-5.6-luna`, medium |
| TypeScript/API docs        | `typescript_api_docs_reviewer`; verify public/config/serialized/persistence compatibility, offset exclusion, DeliveryInbox change, and exact task ownership             | `gpt-5.6-terra`, high  |
| Performance/reliability    | `performance_reliability_reviewer`; verify lifecycle isolation, SQL cost/capabilities, provider limits, shard fencing, cleanup capacity, live evidence, and convergence | `gpt-5.6-terra`, high  |

## Canonical Concern Dispositions

- Code style/maintainability: N/A. T-0187 changes Markdown planning and
  canonical records only; no executable structure, module boundary, or
  production maintainability concern exists to review. Mechanical formatting
  is clean.
- Documentation completeness: relevant; pending review.
- TypeScript/API docs: relevant to frozen public/configuration boundaries;
  pending review.
- Performance/reliability: relevant to all three runtime findings; pending
  review.
- Security: not a per-task lane; task boundaries record security dispositions
  and Wave convergence owns the final security review.

## Specialist Wave 1

All three configured profiles were explicit at dispatch. Runtime model/token/
latency telemetry remained unavailable; no reviewer made a self-claimed model
assertion and no visible mismatch/fallback occurred.

### Documentation completeness — changes requested

Reviewer: `/root/wave12_docs_review`, existing `documentation_reviewer`,
configured `gpt-5.6-luna`/medium.

- Critical: specification/architecture target behavior read as current behavior.
- Important: task/work status mirrors lagged the accepted split/review phase.
- Important: Datastore RED wording conflated a currently admitted illegal shape
  with passing rejection behavior.

Disposition: all accepted. Target text now says explicitly that it is not
implemented at the T-0187 baseline; statuses agree; RED and passing acceptance
are separate.

### TypeScript/API documentation — changes requested

Reviewer: `/root/wave12_ts_api_review`, existing
`typescript_api_docs_reviewer`, configured `gpt-5.6-terra`/high.

- Important: delivery-server Remove RPC was key-only, not exact snapshot
  removal.
- Important: optional plan bounds permitted unbounded provider materialization.
- Important: a required exported `DeliveryInbox` member would break structural
  implementers and lacked a frozen signature.
- Important: target behavior read as current behavior (same accepted
  documentation finding).

Disposition: accepted with a narrower correction. `candidateLimit` retains its
optional public shape but receives a shared 10,000 default. The exact cleanup
method is optional and source-compatible, receives a frozen signature and
consumer type test, and includes the shard session. RemoteInbox is excluded
because it already removes pending rows on acknowledgement. No inaccurate
claim about the key-only Remove RPC remains.

### Performance/reliability — changes requested

Reviewer: `/root/wave12_reliability_review`, existing
`performance_reliability_reviewer`, configured `gpt-5.6-terra`/high.

- Important: sequential ownership validation then Inbox deletion leaves a
  failover race.
- Important: existing remote removal was not exact (same accepted API finding).
- Important: both normalized bounds could be absent (same accepted API finding).

Disposition: accepted. Direct cleanup now requires one provider-atomic
ownership-plus-exact-delete capability, including a transfer-at-the-old-gap
interleaving test. Memory, Datastore, transactional MySQL, and supported
nontransactional MySQL mechanisms receive explicit dispositions. RemoteInbox
omits cleanup. The shared 10,000 default closes the missing-bound case.

## Correction Batch And Re-Review

The one aggregated correction batch also records the human-approved accelerated
three-stream execution model. Documentation, TypeScript/API, and reliability
re-review are required because all three concerns changed substantively. Style
remains N/A; no executable planning structure was introduced. Re-review is
recorded below.

### Re-review results

- Performance/reliability: clean at `5a05ff4b`. Atomic cleanup, RemoteInbox
  exclusion, finite plan bounds, former-gap interleaving proof, and stream
  ownership/serialization resolve all prior findings.
- TypeScript/API documentation: clean at `5a05ff4b`. The optional exact method,
  consumer compatibility, provider atomicity, and target/current wording resolve
  all prior findings.
- Documentation completeness: target/current wording, status mirrors, and
  acceleration model are clean. One Important wording finding remained because
  the plan asserted an unproven Datastore unfiltered-read baseline. Accepted:
  T-0190 now treats current Datastore behavior as a production-path diagnostic
  whose observed rejection/translation/read outcome must be recorded, without
  prejudging it. Final narrow documentation re-review at `e39f4c33` is clean.

Status: all applicable specialist concerns clean; final verification pending.

## Verification

- First `pnpm verify:task -- --no-tests` attempt: failed in
  `typecheck:build:generated` because the clean isolated worktree lacked ignored
  generated Proto outputs. The Markdown-only diff intentionally classifies
  Proto generation as unnecessary, while the build still consumes those
  ignored modules. This is the same clean-worktree precondition documented by
  T-0129, not a T-0187 changed-source failure.
- Root-cause evidence: `scripts/verify-task.mjs` omits `proto:generate` for an
  all-Markdown diff, `packages/proto/generated` contained only its generation
  marker after the failed cleanup/build, and errors consistently named missing
  generated modules.
- Resolution sequence: run the canonical `pnpm proto:generate` prerequisite,
  then repeat the unchanged selected task profile.
- `pnpm proto:generate`: passed all 47 source checks, authored/example quality,
  rejection naming, and 52 frozen descriptors.
- Second task-profile attempt: cleared generation, full build, tooling,
  cleanup, TSDoc, copyright, and logging, then stopped because the newly added
  progress-log failure row had not yet been formatted. Repository Prettier is
  the deterministic correction; no contract/product file changes.
- Next: format the record and repeat the unchanged profile. Result pending.
- Third unchanged `pnpm verify:task -- --no-tests` attempt: pass. It completed
  Proto generation/source/style/descriptor checks, the full TypeScript build,
  tooling typecheck, ESLint, cleanup/TSDoc/copyright/logging checks, formatting,
  documentation audience/API, Buf lint, generated cleanliness, and release
  readiness. The final readiness inventory was 82 package imports, 51 package
  assets, and 377 relative Markdown links.

Verification status: clean; integration pending.
