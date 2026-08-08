# T-0144 Invention Audit Review

Status: Specialist review wave in progress at `e1d9b6f8` plus the recorded
preflight formatting correction.

## Required Concerns

- TypeScript/API: every public/serialized boundary and removed alias is
  classified accurately.
- Performance/reliability: transactions, fencing, retry, quota, cleanup,
  bounded resources, and provider-layout claims match runtime behavior.
- Style/maintainability: deterministic audit data and scripts are cohesive,
  specific, and maintainable.
- Documentation: the inventory is complete, navigable, and distinguishes
  current guidance from preserved historical evidence.
- Security: N/A unless a correction changes an active trust boundary.

## Review Dispatch

- TypeScript/API documentation: existing `typescript_api_docs_reviewer`,
  explicitly `gpt-5.6-terra` / `high`.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicitly `gpt-5.6-terra` / `high`.
- Style/maintainability: existing `style_maintainability_reviewer`, explicitly
  `gpt-5.6-terra` / `high`.
- Documentation: existing `documentation_reviewer`, immutable configured
  `gpt-5.6-luna` / `medium`.
- Runtime metadata will be recorded if exposed; otherwise the immutable or
  explicitly configured profiles and the metadata limitation satisfy the gate.
- Security remains N/A because the audit changes no authentication,
  authorization, network exposure, serialized secret, or other trust boundary.

## Aggregated Findings

- P1 checker scope: scan tracked current-tree files instead of recursively
  traversing ignored worktrees/generated output; include active `.tsx` example
  source and retain deterministic ordering/bounded runtime.
- P1 negative exemption: never exempt executable source; in public Markdown,
  bind a truthful negative to the exact matched artifact so mixed positive and
  negative text cannot bypass the gate. Add adversarial code and mixed-line
  regressions.
- P1 discovery coverage: reject any versioned `ApplicationNodeLease:vN` key,
  not only `:v1`, with fixtures.
- P1 inventory completeness/evidence: expand every limits/retry/quota/cleanup
  mechanism with exact values, scope, persistence/retry/cleanup outcome, and
  navigable source/reference paths. Cover delivery/inbox/lease, remote service,
  subscriptions, browser/auth, query, MySQL, Datastore, and other current Wave
  8 bounded surfaces.
- P2 public API completeness: enumerate the actual affected public contracts,
  including separately exported `RecordSpecOptions`, instead of hiding exports
  in broad grouped rows. Validate the manifest against current root exports,
  schemas, and provider configuration surfaces.
- P2 drift prevention: use one machine-readable forbidden-artifact manifest or
  mechanically assert exact parity between the audit document and checker.
  Exercise every forbidden artifact rule with a positive fixture.
- P1 evidence navigation: every persisted-record, API/layout/limit, and
  delivery/subscription/auth/deployment/example/documentation row needs exact
  traceable file/source/reference evidence rather than generic prose.

All four reviewers reported the configured profiles recorded above; runtime
metadata was unavailable and no mismatch or fallback was visible.

## Implementation Correction

The manifest-backed checker, tracked-file scope, `.tsx` coverage, artifact-
specific Markdown-negative logic, arbitrary versioned discovery-key coverage,
and adversarial fixtures are corrected. TypeScript/API, reliability, style, and
documentation lanes are substantively affected and require targeted re-review.
