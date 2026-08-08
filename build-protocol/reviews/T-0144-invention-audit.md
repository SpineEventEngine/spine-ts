# T-0144 Invention Audit Review

Status: All four concerns converged CLEAN at `0ef233da` plus the deterministic
test-maintenance correction; final release verification pending.

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

## Targeted Re-review Residuals

- P1: delivery-server ledger must distinguish the 1 MiB payload limit from the
  `4 MiB - 64 bytes` serialized-record ceiling.
- P2: the document must name required retired `ApplicationNodeLease:v1` while
  the rule continues to reject every numeric version.
- P2: name concrete affected exports including `DeliverySupervisor` and its
  options, `DatastoreStorageFactory`/builder contracts, and
  `MysqlStorageFactory`/builder contracts.
- P1: enumerate exact browser/auth route byte, timeout, request, active-capacity,
  and opaque-session bounds.
- P1: Markdown negative matching must use the actual matched spelling, including
  alternations and numeric discovery versions, not one manifest fixture.
- P1: build a real temporary Git index fixture proving tracked `.tsx` scanning
  and ignored/untracked/generated/worktree exclusion.
- P1: restore semantic forbidden spellings narrowed by manifest migration:
  removal-fingerprint variants, revoked-session variants, versioned discovery
  key prose, and schema-fingerprint prose; cover positive and exact negative
  cases.
- P2: production Git enumeration must fail closed; unit tests may inject an
  enumerator or construct a Git repository, but production must not silently
  fall back to recursive traversal.
- P2: delivery acknowledgement prose must state that the row remains pending
  only when the selected action and fallback durable acknowledgement both fail.
- Final P1: Markdown exemption must iterate every regex occurrence and require
  clause-local negation for each occurrence. An unrelated earlier “no,” or a
  first negated artifact followed by a positive occurrence after punctuation,
  must not suppress the finding. Add both regression forms.

## Final Resolution

- Replaced natural-language negation heuristics with exactly two
  manifest-owned, path-and-full-line Markdown allowances. Every unlisted or
  altered occurrence fails closed.
- Documentation, TypeScript/API, performance/reliability, and
  style/maintainability final targeted re-reviews are CLEAN.
- Removed one vacuous non-matching test and one duplicate regression after the
  style P2; the narrow style confirmation is CLEAN and no behavior lane
  reopened.
- Security remains N/A because no trust boundary changed.
- Reviewer runtime metadata was unavailable; immutable/explicit configured
  profiles were reported and no mismatch or fallback was visible.
