# T-0142 Example Migration Review

Status: Deterministic preflight complete; specialist review wave in progress.

Required lanes:

- Documentation: example instructions and claims changed by deleted facilities
  or provider setup.
- TypeScript/API documentation: current public option/factory usage and absence
  of compatibility aliases.
- Style/maintainability: deletion quality, example clarity, and no hidden
  replacement state.
- Performance/reliability: only if runtime topology/lifecycle behavior changes.
- Security: N/A unless the implementation changes an authentication trust
  boundary.

## Review Dispatch

- Documentation: existing `documentation_reviewer`; immutable configured
  profile `gpt-5.6-luna` / `medium`. Review changed example/reference claims,
  provider setup, and truthful deletion of quarantine/revocation facilities.
- TypeScript/API documentation: existing `typescript_api_docs_reviewer`;
  immutable configured profile `gpt-5.6-terra` / `high`. Review current public
  API use, repository producer-ID behavior, declarations, and absence of
  compatibility aliases.
- Performance/reliability: existing `performance_reliability_reviewer`;
  immutable configured profile `gpt-5.6-terra` / `high`. Applies because the
  bounded repository producer/routing correction changes runtime event
  persistence and routing behavior.
- Style/maintainability: existing `style_maintainability_reviewer`; immutable
  configured profile `gpt-5.6-terra` / `high`. Review deletion quality,
  composition clarity, fixture convergence, and no hidden replacement state.
- Security: N/A. T-0142 deletes an unsupported example session-revocation
  facility and browser fingerprint option without adding a trust boundary,
  credential path, authorization decision, or replacement security state.
- Runtime self-introspection is recorded if exposed; otherwise each role's
  immutable configured profile and the metadata limitation satisfy the
  acceptance gate. Every reviewer is read-only and must not spawn subagents.

## Review Results

- Documentation (`gpt-5.6-luna` / `medium`): NEEDS CORRECTION. Accepted:
  Message Board family READMEs still claim deleted session-revocation records
  exist; Orders and Message Board docs omit the caller-owned Datastore client
  composition boundary.
- TypeScript/API documentation (`gpt-5.6-terra` / `high`): NEEDS CORRECTION.
  Accepted: public repository event routing lacks documentation for the packed
  message producer-ID wire/matching contract. No retired alias or declaration
  compatibility finding.
- Performance/reliability (`gpt-5.6-terra` / `high`): NEEDS CORRECTION.
  Accepted P1: the migrated no-op durable-subscription cleanup can delete the
  durable row while retaining backend subscription work. Accepted P2: add the
  complementary successful message-producer-to-scalar-target route test.
- Style/maintainability (`gpt-5.6-terra` / `high`): NEEDS CORRECTION. Accepted:
  startup tests do not prove exact caller-owned Datastore client handoff/project
  options, and the removal scan omits application/combined entries.
- All reviewers reported that runtime self-introspection is unavailable; their
  immutable configured role/profile is recorded above. No visible mismatch or
  fallback occurred.

## Aggregated Correction Batch

1. Delete/reword every remaining Message Board session-revocation claim and
   document caller-owned Datastore client construction/handoff in Orders and
   Message Board deployment guidance.
2. Document the packed message producer-ID schema/matching contract on the
   public repository event-routing surface.
3. Replace the deployment no-op durable cleanup with real backend subscription
   cancellation and prove expiry cancels backend work before row removal.
4. Prove exact Datastore client/project handoff across all three Message Board
   entrypoints and extend the static removal scan to application/combined
   sources.
5. Add the successful message-producer-to-scalar-target routing regression.

Re-review only documentation/API, reliability, and style concerns
substantively affected by this batch. Security remains N/A for the reason above.

## Targeted Re-review

- Documentation: CLEAN. Revocation claims, caller-owned Datastore guidance,
  links, and snippets are corrected.
- TypeScript/API documentation: original producer-ID contract is corrected.
  Residual P2 accepted: `attachCleanup()` is emitted accidentally on the
  root-exported class and replaces the caller-configured cleanup contract.
- Performance/reliability: original expiry ordering and scalar-route findings
  are corrected. Residual P1 accepted: cleanup attachment occurs before the
  BrowserServer rollback region, so duplicate/pre-attached bindings can leak
  the new dynamic forwarder, watcher, and native server.
- Style/maintainability: original client construction/storage assertions and
  removal scan are corrected. Residual P2 accepted: tests do not observe the
  production `configureServer(config, client, environment)` tuple, and do not
  prove BrowserServer wiring/single-attachment rollback.

### Residual Correction Batch

1. Move cleanup attachment behind a package-internal seam so the root-exported
   `DurableSubscriptionBindings` declaration/TypeDoc gains no accidental
   method. Compose the backend cancellation with the documented caller cleanup;
   do not replace it.
2. Put attachment inside BrowserServer's rollback-protected startup region.
   Prove duplicate attachment closes discovery, dynamic forwarding, and native
   server exactly once, while normal recovery attaches before expiry work.
3. Spy on `configureServer` and assert the exact configuration, caller-owned
   Datastore client, and environment tuple for application, combined, and
   gateway entrypoints.

Re-review API, reliability, and style only after this substantive correction.

## Final Re-review And Disposition

- Documentation: CLEAN; no re-open after unrelated runtime corrections.
- TypeScript/API documentation: CLEAN. The class/root declaration has no
  attachment method, the WeakMap seam is package-internal, caller cleanup is
  preserved, and repository producer-ID documentation remains accurate.
- Performance/reliability: CLEAN. Attachment is rollback-protected; duplicate
  attachment closes discovery, dynamic forwarding, and a supplied native
  server exactly once; backend and caller cleanup failures retain the row.
- Style/maintainability: functional and test concerns CLEAN. The sole residual
  one-line internal TSDoc format finding was corrected deterministically in
  `791ec041`; TSDoc, Prettier, server typecheck, and diff evidence confirm it,
  so the lane is not substantively reopened.
- Security: N/A remains valid.

Status: Specialist review converged; final task verification pending.

## Tooling-Convergence Re-review Dispatch

The final deterministic convergence renamed internal storage helpers, corrected
the `RecordSpec` constructor TypeDoc graph, reconciled cleanup necessity
ledgers, and changed reader-facing Datastore wording. Only the substantively
affected lanes reopen:

- TypeScript/API documentation: existing `typescript_api_docs_reviewer`,
  explicitly dispatched as `gpt-5.6-terra` / `high`.
- Style/maintainability: existing `style_maintainability_reviewer`, explicitly
  dispatched as `gpt-5.6-terra` / `high`.
- Documentation: existing `documentation_reviewer`; immutable configured
  profile `gpt-5.6-luna` / `medium` because this role does not accept an
  override.
- Reliability and security remain closed: the convergence changes names,
  documentation, test fixtures, SQL source layout without changing SQL text,
  and governing ledgers; no lifecycle, persistence, concurrency, or trust
  boundary behavior changed.

An initial documentation dispatch supplied an incompatible override and was
interrupted before acceptance. The corrected dispatch above uses the role's
immutable profile. Reviewers are read-only and may not spawn subagents.

## Tooling-Convergence Re-review Results

- Documentation (`documentation_reviewer`, immutable `gpt-5.6-luna` /
  `medium`): CLEAN. Datastore reconciliation wording, MySQL/history TSDoc,
  durable cleanup documentation, and the `RecordSpec` constructor contract are
  truthful. Runtime metadata was unavailable.
- TypeScript/API documentation (`typescript_api_docs_reviewer`,
  `gpt-5.6-terra` / `high`): accepted P2 that a renamed private constructor
  alias remained inaccessible through the public declaration graph.
- Style/maintainability (`style_maintainability_reviewer`, `gpt-5.6-terra` /
  `high`): accepted P1 that 79 mechanically generated necessity reasons were
  blanket allowances rather than exact human dispositions. Runtime metadata
  was unavailable for both roles.

### Convergence Correction Batch

1. Export and document `RecordSpecOptions` from the storage root, including its
   record fields and message-versus-primitive identity contract; add it to API
   documentation expectations and the storage reference.
2. Replace every blanket standalone-function reason with a concrete provider
   SPI, query, transaction, codec, error, test-observation, Entity metadata,
   durable integration, or SubscriptionRecord/runtime ownership reason.
3. Correct the two private MySQL test-observation rationales and two duplicated
   `port` words found by the first style re-review.

### Final Targeted Disposition

- TypeScript/API documentation: CLEAN. `RecordSpecOptions` is root-exported,
  emitted, linked from `RecordSpec`, compatibility-safe, and no retired
  `RecordSpecInput` name remains.
- Style/maintainability: CLEAN. All 79 necessity records are specific and
  truthful; internal renames, SQL wrapping, and fixture changes have no other
  finding.
- Documentation: CLEAN without further correction.
- Reliability and security remain N/A for this convergence because no runtime,
  persistence, concurrency, lifecycle, authorization, or trust-boundary
  behavior changed.

Status: Specialist re-review converged; final task verification pending.
