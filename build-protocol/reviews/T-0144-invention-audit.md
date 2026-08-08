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

## Coverage-correction review dispatch

- Performance/reliability: existing `performance_reliability_reviewer`,
  explicitly `gpt-5.6-terra` / `high`, reviews only whether the test-only
  correction exercises truthful behavior without timing, database, lifecycle,
  or order-dependent fragility.
- Style/maintainability: existing `style_maintainability_reviewer`, explicitly
  `gpt-5.6-terra` / `high`, reviews only the changed test fixtures for focused,
  maintainable behavior coverage and avoidance of implementation-coupled hacks.
- TypeScript/API and documentation: N/A because the correction changes no
  production source, declaration, public export, TSDoc, README, reference, or
  generated API artifact.
- Security: N/A because the correction changes no trust boundary or runtime
  behavior.
- Runtime metadata will be recorded if exposed; otherwise the immutable
  configured role/profile and metadata limitation satisfy the acceptance gate.

## Coverage-correction findings and resolution

- P1 reliability: the mocked nontransactional MySQL commit case asserted only
  presence, not the retry-safety invariant that family and event immutability
  preflights precede every append/write. Corrected to assert the exact ordered
  transactional and nontransactional call sequences.
- P2 reliability/style: new shard-observation and service subscription tests
  used elapsed-time sleeps that did not prove attachment or pre-buffering.
  Corrected with a decode-completion barrier and registry/consumer attachment
  probe; the tenant mismatch assertions now check non-settlement before posting
  the matching event.
- P2 style: removed an inert conditional in the MySQL assertion.
- Mechanical preflight findings: corrected complete `DeliveryLoopRun` fixtures,
  exact-optional commit input construction, and the bounded counter-error test.
- The correction changes tests only. Reliability and style require narrow
  re-review; API, documentation, and security dispositions remain N/A.
- Targeted reliability re-review is CLEAN: exact MySQL mode ordering, the
  decode-to-buffer latch, and registry-activation/reconciliation attachment
  barrier are deterministic; its focused run passed 3 files / 136 tests.
- Targeted style re-review is CLEAN: the prior timer and inert conditional are
  gone, fixtures remain contained, and no production workaround was added.
- Both reviewers reported the explicitly configured `gpt-5.6-terra` / `high`
  profile; runtime metadata was unavailable and no fallback was visible.
