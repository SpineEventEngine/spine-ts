# T-0067 Review Record

Status: accepted; all required concerns and post-merge verification clean.

Baseline: `893d8756`

## Required Concern Dispositions

| Concern                 | Initial disposition | Reason                                                                               |
| ----------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| Documentation           | Clean               | Claims and snippets match the implemented public workflows and limits.               |
| TypeScript/API          | Clean               | No contract changed; documentation matches declarations and runtime APIs.            |
| Final security          | P1 findings         | Retained/enumerated state is unbounded and persisted inbox validation is incomplete. |
| Style/maintainability   | Reopened            | Security correction will change production delivery-server structure.                |
| Performance/reliability | Reopened            | Security correction changes capacity, admission, and response-work bounds.           |

## Assignment Metadata

- Documentation: existing immutable `documentation_reviewer` role,
  `gpt-5.6-luna` / `medium`.
- TypeScript/API: existing `typescript_api_docs_reviewer`, expected and
  explicitly dispatched `gpt-5.6-terra` / `high`.
- Final security: existing `security_reviewer`, expected and explicitly
  dispatched `gpt-5.6-terra` / `high`.
- Correction style/maintainability: existing `style_maintainability_reviewer`,
  expected and explicitly dispatched `gpt-5.6-terra` / `high`.
- Correction performance/reliability: existing
  `performance_reliability_reviewer`, expected and explicitly dispatched
  `gpt-5.6-terra` / `high`.
- Correction documentation: existing immutable `documentation_reviewer` role,
  `gpt-5.6-luna` / `medium`.
- Correction TypeScript/API: existing `typescript_api_docs_reviewer`, expected
  and explicitly dispatched `gpt-5.6-terra` / `high`.
- Security re-review: existing `security_reviewer`, expected and explicitly
  dispatched `gpt-5.6-terra` / `high`.

Actual runtime metadata or the immutable-profile/self-introspection limitation
must be recorded before accepting each result.

## Mechanical Verification

- Locked installation and the repository supply-chain policy passed.
- TypeScript snippet syntax and named `@spine-ts/*` public exports passed.
- Generated documentation/API checks passed.
- Delivery-server public API tests passed: 1 file, 2 tests.
- Composite TypeScript build, formatting, and `git diff --check` passed.

## Review Wave

### Documentation

Result: clean; no P0-P3 findings.

The reviewer checked the root README, user guide, affected package READMEs,
snippet checker, upstream audit, completion-plan/security claims, workflows,
close ordering, trusted-network and in-memory limits, and Wave 2/3/4 handoffs.
The immutable role profile was `gpt-5.6-luna` / `medium`, as assigned. Runtime
self-introspection was unavailable; no mismatch or fallback was visible.

### Security correction batch

The original implementation owner applied both accepted P1 corrections: finite
validated retained message/byte/tracked-shard configuration with atomic
admission, bounded batch/snapshot/expiration work, and complete canonical
inbox-record validation before persistence. Focused adversarial tests cover
direct service admission, poison record rejection, atomic mixed-batch failure,
and retained/session capacity. Style/maintainability, performance/reliability,
TypeScript/API, and security re-review remain pending because this changes
production capacity and public options.

### TypeScript/API

Result: clean; no P0-P3 findings.

No public TypeScript or Protobuf contract changed. Guide claims match current
exports and runtime contracts for the client, query/subscription DSL,
environment, BlackBox, delivery client/server/supervisor, and entity update
APIs. The reviewer independently passed the snippet checker, delivery-server
public API tests, and diff check. The immutable role profile was
`gpt-5.6-terra` / `high`, as explicitly dispatched. Runtime
self-introspection was unavailable; no mismatch or fallback was visible.

### Final Security

Result: not clean; two P1 findings accepted as blocking.

1. The standalone in-memory delivery server has no finite total retained
   message/byte or tracked-shard bounds. Batch writes, full-state sorting,
   Admin snapshots, and expired-session responses can also create unbounded
   work or output. Existing RPC, pending-mutation, page, and subscriber limits
   do not cap total server state. Correction must add finite safe defaults,
   reject admission at capacity, bound server-side batches/payloads, and keep
   snapshot/expiration response work within the RPC ceiling, with adversarial
   capacity tests and corrected documentation.
2. Inbox admission validates shard, UUID, and timestamp but not the canonical
   Command/Event payload and the remaining fields/enums required by the client
   decoder. A direct peer can persist a poison record that makes later page
   reads fail before dispatch. Correction must apply canonical validation and
   byte limits to single and batch mutations before admission, with direct-RPC
   rejection regressions.

TM-013 is an explicitly documented trusted-network residual matching the
frozen simple-server behavior. TM-015 through TM-018 are clean within their
declared boundaries; TM-014 remains blocked by the first finding. The immutable
role profile was `gpt-5.6-terra` / `high`, as explicitly dispatched. Runtime
self-introspection was unavailable; no mismatch or fallback was visible.

## Correction Re-review Wave

The correction changes production capacity, admission, public options, and
security documentation. Style/maintainability, performance/reliability,
documentation, TypeScript/API, and final security are therefore all reopened
as one complete affected-concern wave. Findings will be aggregated before any
further correction.

Result: not clean; one consolidated final correction batch is required.

- Security (`gpt-5.6-terra` / `high`): original poison-record and atomic
  retained-state findings are fixed. TM-015 is clean. TM-014 remains blocked
  because a count-bounded Inbox page can exceed the 4 MiB response ceiling;
  `removeMany` also lacks the declared 100-record cap.
- Performance/reliability (`gpt-5.6-terra` / `high`): additionally found that
  released message-free shard records accumulate until normal churn
  permanently exhausts shard capacity, and that the server's 10,000-entry
  Admin bound conflicts with the client's 1,000-entry decoder bound. Batch
  length must be checked before per-record serialization/copying.
- Style/maintainability (`gpt-5.6-terra` / `high`): the public listener-free
  core bypasses the tracked-shard response ceiling, and default policy values
  are duplicated across construction paths.
- TypeScript/API (`gpt-5.6-terra` / `high`): confirmed the response, Admin,
  batch, and public-core gaps; also found server/client drift for the 128-byte
  worker identity rule and undocumented inherited public core limit options.
- Documentation (immutable `gpt-5.6-luna` / `medium`): batch claims overstate
  `removeMany`, and new option docs omit accepted ranges and synchronous
  construction failure.

Runtime self-introspection was unavailable for every re-reviewer; no visible
role/profile mismatch or inherited fallback occurred. Unrestricted focused
verification passed 15 delivery-server files / 59 tests; reviewer sandbox
loopback `EPERM` failures were independently reproduced as environment-only.

### Accepted final correction batch

1. Enforce a serialized full-record ceiling and fail an over-ceiling requested
   page explicitly before response serialization; never silently shorten a
   page. Document/configure smaller page sizes for large records and prove
   `findOne`, newest, and page responses remain within the 4 MiB boundary.
2. Prune released shard records when no message retains the shard, including
   after the last message removal; prove normal shard churn does not exhaust
   capacity.
3. Use one shared 1,000-shard Admin/expiration/client-compatible bound and
   enforce it in every public construction path.
4. Validate non-empty, at-most-100 write/remove batch lengths before any
   per-record work.
5. Centralize limit defaults and declare/document public core options directly
   instead of inheriting an unexported internal type.
6. Mirror the 128-byte combined worker/node identity rule in the delivery
   client before RPC.
7. Correct README, guide, TSDoc, threat model, and closure claims/ranges/failure
   behavior, with focused adversarial and public-contract regressions.

## Targeted Finding Rechecks

- Final security: clean. TM-014 is closed; exact requested pages are never
  truncated, over-ceiling pages fail explicitly, single responses/records are
  bounded, and remove batches are checked before record work. Unrestricted
  focused verification passed 2 files / 15 tests.
- Performance/reliability: clean. All five prior findings are resolved; 7
  focused files / 52 tests passed.
- Style/maintainability: clean. Shared ceilings/defaults and public option
  declarations resolve both prior findings; diff check passed.
- TypeScript/API: five prior findings are clean. One P2 remains because the
  public client converts the server's actionable `RESOURCE_EXHAUSTED`
  oversized-page response into generic `DeliveryProtocolError`, contradicting
  its smaller-page retry guidance. Preserve the status for safe reads (or an
  equally specific public error) and add a regression.
- Documentation: substantive findings are clean and the snippet checker
  passes. One P2 wording correction must distinguish the symmetric 1..100
  batch bound from write-only retained-state capacity rejection.

All targeted reviewers used their recorded explicit profiles. Runtime
self-introspection remained unavailable with no visible mismatch or fallback.
The two remaining P2 corrections are accepted and deterministic; they do not
reopen a broad review wave.

## Deterministic P2 Corrections

- Safe client reads now preserve the server's exact `ConnectError` with
  `Code.ResourceExhausted` before retry classification. The focused regression
  configures retries, proves the page read makes only one RPC, and confirms
  another nonretryable status still maps to `DeliveryProtocolError`.
- The end-user guide now separates the symmetric 1..100 write/remove batch
  bound from write-only atomic retained-state capacity admission.
- The existing `implementer` role performed these corrections with the
  explicitly dispatched `gpt-5.6-terra` / `medium` profile. Runtime
  self-introspection was unavailable; the immutable configured profile was
  visible with no mismatch or inherited fallback.
- Focused lifecycle verification passed 1 file / 26 tests after the regression
  first failed for the expected status-conversion defect. Delivery-client
  TypeScript build/declarations, focused ESLint, generated API documentation,
  guide snippet validation, repository formatting, and diff integrity all
  passed.

### Final correction implementation

All seven accepted items are implemented. The exact requested Inbox page is
encoded and rejected with `RESOURCE_EXHAUSTED` above 4 MiB; it is never silently
shortened. Full records and single-record responses are bounded, released shard
churn is pruned, every construction path shares the 1,000-shard ceiling,
write/remove batch lengths are checked before record work, defaults and public
options are coherent, and client worker validation matches the server. All
affected finding rechecks are clean; the deterministic P2 follow-ups passed
their focused gates and require no further specialist wave.

## Final Verification

The full `pnpm --config.verify-deps-before-run=false verify` gate passed after
two deterministic tooling corrections: materializing handler response
initializers before test-only binary-size assertions, and repinning two
line-specific inherited cleanup-name exceptions shifted by documented public
options. The documentation checker also imports its Node globals explicitly.

- 127 test files passed, 3 skipped; 2,325 tests passed, 21 skipped.
- Statements 94.17%; branches 90.07%; functions 95.05%; lines 94.69%.
- Node/protobuf provenance, 39 copied checksums, 48 frozen descriptors,
  composite/tooling typechecks, ESLint/cleanup, formatting, generated
  cleanliness, TypeDoc/API exports, 18 package imports, and 121 Markdown links
  all passed.
