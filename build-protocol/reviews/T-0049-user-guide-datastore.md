# T-0049 User Guide and Datastore Review Log

Status: All canonical review lanes CLEAN; full verification passed

## Human requirements

Reviewers must evaluate the complete ledger in
`build-protocol/tasks/T-0049-user-guide-datastore/TASK.md`, especially factual
parity with current public code, the presence and validity of practical inline
snippets, and comprehensive Datastore development/configuration guidance.

Historical or superseded task text outside the active guide and T-0049 records
is not a finding unless the changed guide presents it as current behavior.

## Required dispositions

- Style/maintainability: pending; expected existing reviewer profile
  `gpt-5.6-terra` / high.
- Documentation: pending; expected existing reviewer profile
  `gpt-5.6-luna` / medium.
- TypeScript/API docs: pending; expected existing reviewer profile
  `gpt-5.6-terra` / high.
- Performance/reliability: pending; expected existing reviewer profile
  `gpt-5.6-terra` / high because Datastore query bounds, batching, CAS retries,
  lifecycle, and production limitations are documented.
- Security: N/A for this documentation-only non-release-boundary task. No
  security behavior changes; reviewers must still flag inaccurate credential,
  redaction, tenant-isolation, or trust-boundary claims within their lanes.

## Rounds

- Pre-review author evidence pending focused validation. The author recorded
  the assigned existing implementer profile as expected `gpt-5.6-terra` /
  `medium`; this surface provides no actual runtime model/reasoning metadata,
  so the orchestrator must not treat this as acceptance metadata.
- Focused pre-review validation is clean: formatting, diff whitespace,
  TypeDoc/API documentation, release-readiness Markdown links (59 package
  imports; 119 relative links), cleanup enforcement, and targeted end-user
  API/internal-import scans. No runtime or public-API change is present.

## Round 1 assignments — endpoint `0cd8e9c9`

- Baseline: `f421b7e3c4f0cca9b72b0a5db7352ccc019e1d06`.
- Style/maintainability: existing role `style_maintainability_reviewer`;
  expected and explicitly dispatched as `gpt-5.6-terra` / high. Scope is guide
  organization, readability, duplication, snippet presentation, terminology,
  and maintainability against the human ledger.
- Documentation: existing role `documentation_reviewer`; expected and
  explicitly dispatched as `gpt-5.6-luna` / medium. Scope is sentence-level
  factual completeness, end-user journey, Datastore comprehensiveness, links,
  setup distinction, and limitations against source evidence and the ledger.
- TypeScript/API docs: existing role `typescript_api_docs_reviewer`; expected
  and explicitly dispatched as `gpt-5.6-terra` / high. Scope is every public
  import, type, method, option, handler signature, generated service path, and
  inline TypeScript snippet against the current declarations and ledger.
- Performance/reliability: existing role
  `performance_reliability_reviewer`; expected and explicitly dispatched as
  `gpt-5.6-terra` / high. Scope is Datastore query bounds/pushdown, batching,
  CAS/retry behavior, error/redaction behavior, namespace/client lifecycle,
  emulator/cloud claims, production limitations, and the ledger.
- Each reviewer must perform and report the canonical skill-applicability check
  before review action, must not edit or mutate Git state, and must not spawn
  subagents. Actual role/model/reasoning runtime metadata must match before a
  result is accepted.

### Documentation dispatch surface note

- The first documentation dispatch attempted an explicit free-model override
  of `gpt-5.6-luna` / medium and was rejected by the collaboration API because
  that API only accepts Sol and Terra as free overrides. No child was created
  by the rejected call.
- The redispatch explicitly selected the existing `documentation_reviewer`
  role, whose runtime configuration is immutably `gpt-5.6-luna` / medium, and
  explicitly passed medium reasoning. The prompt also named the required Luna
  model. Acceptance still requires actual role runtime metadata; this records
  the API limitation honestly rather than claiming a free override succeeded.

## Round 1 complete wave

### Runtime acceptance

- Style/maintainability ran as the existing
  `style_maintainability_reviewer`, whose immutable runtime profile is
  `gpt-5.6-terra` / high; the explicit model and reasoning fields matched.
- Documentation ran as the existing `documentation_reviewer`, whose immutable
  runtime profile is `gpt-5.6-luna` / medium. Medium reasoning and the role were
  explicit; the API limitation on a redundant free Luna override is recorded
  above. Actual runtime role metadata matches the expected profile.
- TypeScript/API ran as the existing `typescript_api_docs_reviewer`, whose
  immutable runtime profile is `gpt-5.6-terra` / high; the explicit model and
  reasoning fields matched.
- Performance/reliability ran as the existing
  `performance_reliability_reviewer`, whose immutable runtime profile is
  `gpt-5.6-terra` / high; the explicit model and reasoning fields matched.
- Reviewer contexts could not introspect their own runtime metadata. The
  orchestrator accepts the collaboration runtime's immutable role metadata,
  not the reviewers' expected-profile statements, as actual evidence.

### Accepted combined finding batch

1. Make the custom scan-budget snippet self-contained; it currently relies on
   an undeclared `client` and conflicts with the earlier `storageFactory` name
   if blocks are combined.
2. Correct the Datastore composition cross-reference: the consumer
   substitution is introduced at the start and entity classes are in section
   3, not sections 3 and 4.
3. Reflow the two new lines over the repository's 120-character maximum.
4. Correct the linked Datastore package README emulator command so the gcloud
   bind port matches `DATASTORE_EMULATOR_HOST=127.0.0.1:8081`.
5. State that continuation is applied only after the provider candidate set is
   fetched within the finite bound. It cannot page around sentinel overflow;
   filters must keep the complete provider candidate set within the bound.
6. State CAS as at most three total attempts: the initial attempt plus at most
   two retries.

### Reliability test-request disposition

- The request to add a repeated-code-10 exhaustion test is outside this
  documentation-only task. The accepted production loop directly bounds total
  attempts with `maxCasAttempts = 3`; T-0049 corrects the prose and changes no
  runtime behavior. A new adapter regression is neither needed to establish
  the current source fact nor authorized by the task's no-runtime scope.
- The request to add a whitespace-only tenant regression is likewise outside
  scope. The guide accurately reflects `requiredTenantId()`, which trims and
  rejects missing, empty, or whitespace-only IDs before key/query construction.
  T-0049 changes no tenant behavior. These test suggestions are not unresolved
  guide findings and are not accepted as scope expansions.

### Fix assignment

- Return the complete accepted documentation batch to original author
  `/root/t0049_guide_author`, existing `implementer`, expected and explicitly
  dispatched as `gpt-5.6-terra` / medium. Ownership expands only to the linked
  `packages/storage-datastore/README.md` plus the original T-0049 files. No
  runtime/test/API edit, Git mutation, or subagent action is authorized.

## Round 1 correction re-review assignments — endpoint `65d95306`

- Correction baseline: `aa840c13`; correction endpoint: `65d95306`.
- Re-run all four affected existing lanes against only the accepted corrections
  and their interaction with the complete human ledger.
- Style/maintainability: existing `style_maintainability_reviewer`, explicitly
  `gpt-5.6-terra` / high; verify snippet self-containment, cross-reference,
  line length, organization, and no regression.
- Documentation: existing `documentation_reviewer`, immutable
  `gpt-5.6-luna` / medium with medium reasoning explicit; verify linked README
  command consistency, guide/README coherence, completeness, and no regression.
  The previously recorded free-model override limitation still applies.
- TypeScript/API: existing `typescript_api_docs_reviewer`, explicitly
  `gpt-5.6-terra` / high; verify CAS wording, snippet declarations/imports,
  public APIs, and no regression.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicitly `gpt-5.6-terra` / high; verify continuation/finite-bound semantics,
  CAS attempt semantics, README/guide operational claims, and the recorded
  documentation-only test-request disposition.
- Every assignment remains read-only, childless, and subject to its own
  canonical skill-applicability check and actual runtime metadata gate.

## Round 1 correction disposition

- Accepted findings 1–6 were applied by the original implementer under the
  unchanged expected `gpt-5.6-terra` / `medium` profile.
- Findings 1–3: the bounded-factory snippet now declares its Google client and
  uses a distinct factory name; the cross-reference points to the introduction
  and section 3; reviewed overlong lines are reflowed.
- Findings 4–6: the linked package README explicitly binds emulator port 8081;
  guide and README state that sentinel overflow precedes local continuation;
  CAS is documented as three total attempts, including at most two retries.
- Focused correction verification passed: assigned-file Prettier, diff
  whitespace, release-readiness links/imports (59/119), TypeDoc/API expected
  exports, cleanup enforcement, 120-character line scanning, guide prohibition
  and internal-import scans, and targeted corrected-claim presence scans. The
  rejected runtime-test scope expansions remain rejected for the recorded
  reasons.

## Accepting re-review results

- Style/maintainability: CLEAN. Existing role
  `style_maintainability_reviewer`, immutable actual runtime profile
  `gpt-5.6-terra` / high matching explicit dispatch. Self-contained snippet,
  cross-reference, line length, correction prose, and full ledger passed.
- Documentation: CLEAN. Existing role `documentation_reviewer`, immutable
  actual runtime profile `gpt-5.6-luna` / medium. The role and medium reasoning
  were explicit; the API's redundant free-Luna override limitation is recorded
  above. Guide/README coherence, emulator port, full adapter journey, limits,
  links, and ledger passed.
- TypeScript/API docs: CLEAN. Existing role
  `typescript_api_docs_reviewer`, immutable actual runtime profile
  `gpt-5.6-terra` / high matching explicit dispatch. CAS count, bounded-scan
  snippet, query ordering, all public imports/options, handler and generated
  paths, and full ledger passed.
- Performance/reliability: CLEAN. Existing role
  `performance_reliability_reviewer`, immutable actual runtime profile
  `gpt-5.6-terra` / high matching explicit dispatch. Candidate-set bound,
  continuation ordering, CAS attempts, emulator endpoint, lifecycle, cloud
  limits, and the documentation-only test-request disposition passed.
- Reviewer contexts reported that self-introspection of runtime metadata was
  unavailable. Acceptance uses the collaboration runtime's immutable existing
  role configuration plus the explicit dispatch fields recorded for every
  lane. No reviewer edited files or Git state, and no reviewer spawned a child.
- All accepted findings are resolved. No canonical finding remains; final full
  task verification is authorized.
