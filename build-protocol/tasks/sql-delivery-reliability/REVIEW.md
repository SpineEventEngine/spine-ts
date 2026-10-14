# Review log

Architecture: accepted (record below). Storage review converged at bcad25082;
delivery/publication/recovery/shutdown review converged at 2b74bf1ee. Subscription
lifecycle review has converged after its targeted corrections.
The Process Manager/System publication follow-up review has converged.
Live grouping and diagnostic probes pass.
Live workload/restart acceptance and final release review remain pending. No
whole-task acceptance claimed. Model dispatch validation is required before
accepting each child result.

Storage review wave: frozen runtime checkpoint b6574791a, pushed to official origin. Review baseline 658da1cdddcb8fd40f9205b1c200abc3a58dd62e includes diagnostics, status lists, independent SQL primitives/CAS, Entity/history/EventStore changes and direct cleanup. Current deterministic preflight and 48 SQL traces are recorded; final whole-task release verification remains pending. All four concerns apply. Dispatches use existing roles and explicit model/reasoning fields: performance_reliability_reviewer gpt-6-sol/medium; typescript_api_docs_reviewer gpt-6-sol/medium; style_maintainability_reviewer gpt-6-sol/medium; documentation_reviewer gpt-6-luna/medium. Run the first three concurrently, then documentation when capacity permits. Actual runtime introspection is unavailable unless exposed by a result; configured profiles and explicit dispatch fields must be checked before acceptance. Collect the complete wave before returning one finding batch to the existing implementer.

Reliability result received: /root/storage_reliability_review, existing role and explicit gpt-6-sol/medium confirmed; runtime metadata unavailable. One P2 finding at Datastore entity-history immutable insertion: a concurrent deletion between false absent-slot CAS and readback produces an immediate failure instead of bounded reinsertion. Parent source inspection confirms the race; accept a finite retry with disappearance/success and exhaustion tests. No other confirmed P0-P2 finding. Documentation lane dispatched when this slot became available. No fixes assigned before the full wave.

Complete storage wave collected. API and style reviewers confirm existing configured roles with explicit gpt-6-sol/medium dispatch; documentation confirms explicit gpt-6-luna/medium. Actual runtime metadata unavailable for all. Parent inspected the reported lines and accepts one combined correction batch:

- P2 reliability: bounded Datastore immutable collision/disappearance retry, preserving conflicts and original errors; test success after disappearance and exhaustion.
- P2 style/correctness: MySQL Entity input validation must reject blank/repeated delivery IDs and missing/mismatched current Entity IDs before any writes, matching the other built-in providers. Valid inputs still retain partial prefixes on infrastructure failure.
- P2 fixture: derive a Command Inbox signal ID from its actual Command ID in delivery-client shared fixtures.
- P2 API prose: remove the PostgreSQL README's ambiguous removed cleanup-capability recommendation and describe direct Inbox ID deletion.
- P2 API prose: EventStore's general callback may run concurrently before insertion; only persistence has one winner. EventBus dispatches after successful return. Narrow the storage reference accordingly.
- P2 status: update ACCEPTANCE.md's SQL-boundary row to the completed 48-case traced subset, preserving outstanding task requirements. Parent handles this record.
- P3 clarity, accepted as a small correction: distinguish automatic one-retry behavior in SQL/Datastore from same-input caller retry in memory; narrow "every provider" to the built-in implementations/contract.

No P0/P1 finding. Return the implementation/prose batch to the same explicit Sol/medium implementation context. Re-review reliability and style only after runtime/test corrections; API/docs wording and status corrections can be checked directly against the accepted text and do not reopen unaffected lanes. No whole-wave repeat planned absent a new substantive issue.

Architecture pass accepted 2026-10-13: /root/architecture, explicit gpt-6-astra/high, configured requirements_splitter profile confirmed; runtime self-introspection unavailable. No new persistence contract or human blocker proposed. See ARCHITECTURE.md. Four specialist reviews still pending implementation/preflight.

Bounded architecture follow-up accepted in the same requirements_splitter context with its original explicit gpt-6-astra/high configuration, restated in assignment and confirmed by result. Runtime introspection remains unavailable. Trigger: material EventStore contract ambiguity exposed by DEL-05's same-operation retry requirement. Decision: append/appendAll provide idempotent immutable storage; accept/acceptThenAppend retain strict new admission and a strict atomic insert after the callback. Production callers already separate these paths. Require complete-envelope comparison, bounded collision/disappearance handling, retained-prefix before/after-write retry tests, and a forced two-admission race proving only one EventBus dispatch. No human decision, new persistence contract or whole architecture repeat needed. Returned to the existing Sol/medium implementation context; independent PostgreSQL history/docs work continues.

Correction freeze accepted: existing implementer with explicit gpt-6-sol/medium retained, runtime metadata unavailable. Evidence: 174/174 tests, 22/22 changed runtime branch records, MySQL and MariaDB 15/15 live integration tests each; static checks pass. Parent directly confirms the accepted API/documentation wording. Targeted follow-ups dispatch the existing performance_reliability_reviewer and style_maintainability_reviewer with their immutable explicit gpt-6-sol/medium profiles, restated in each assignment. Scope is the corrections since b6574791a; no whole-wave repeat.

Targeted correction re-reviews accepted: reliability and style each confirm their existing configured role with explicit gpt-6-sol/medium retained; runtime introspection unavailable. Both prior runtime/fixture findings are resolved, with no new actionable findings. Reliability confirms three-attempt Datastore disappearance handling preserves conflict rejection and driver errors, and MySQL validation precedes storage I/O. Style confirms domain-correct fixtures and bounded helper structure. No further correction batch needed. Storage concern wave converged; delivery/lifecycle changes will receive their relevant reviews after implementation and mechanical preflight.

Targeted shutdown architecture result accepted: existing requirements_splitter explicitly configured gpt-6-astra/high, runtime introspection unavailable, read-only. The source-grounded stuck-recipient drain blocker requires one finite context deadline plus cancellation-aware stored dispatch and terminal execution guards preserving raw FIFO order. ARCHITECTURE.md records API/default/outcomes/tests and practical limits. Returned to the same Sol/medium implementer; later API and reliability review must include this lifecycle boundary. No whole architecture repeat or human approval needed.

## Delivery, publication, recovery, and shutdown review wave

Frozen diff base: bcad25082. Existing implementer /root/implementation retained its explicit gpt-6-sol/medium profile; reported final focused V8 763/763 plus build, tooling typecheck, touched ESLint/Prettier, cleanup, TSDoc, copyright, time-read, and diff checks passing. The 233/239 executable-line and 96/104 branch-arm intersection is diagnostic evidence, not the full release gate; eight remaining arms require review of the concrete dispositions in IMPLEMENTATION.md. Actual runtime profile metadata is unavailable.

Reuse the existing performance_reliability_reviewer, typescript_api_docs_reviewer, style_maintainability_reviewer, and documentation_reviewer. Their original dispatches explicitly set respectively gpt-6-sol/medium, gpt-6-sol/medium, gpt-6-sol/medium, and gpt-6-luna/medium; follow-up assignments restate those immutable profiles. No agent may spawn children. Read-only review only; collect the complete four-concern wave before one correction batch to the existing implementer. Security remains reserved for final release readiness per protocol.

Delivery wave API result: existing typescript_api_docs_reviewer confirms explicit gpt-6-sol/medium; runtime metadata unavailable. No actionable findings in repair exports/outcomes, tenant/order/cancellation contracts, stored publication signatures, shutdown configuration, declarations, or narrow TSDoc/API claims. Read-only; no mechanical checks duplicated. Other concern results pending.

Delivery reliability preliminary finding P1: retained failed row plus remote release NOT_PICKED/messages>0 observation can self-notify indefinitely through DeliverySupervisor queue/startNext. Existing manual-notification test does not model release-generated observations. Await complete concern wave before correction.

Complete delivery review wave accepted: reliability confirms one P1 release-driven retry loop, style has no actionable findings, API has no actionable findings, documentation has one P2 missing finite committed-Event retry explanation. Each reviewer confirmed its existing explicit configured model/reasoning; actual runtime metadata unavailable. Parent source check confirms remote release invokes onTransition, supervisor watch immediately notifies pending shards, and a queued repeat is started immediately; parent text search confirms narrow API/reference explains acknowledgement retry and exact-ID repair but not normal committed-Event three-attempt dispatch. No conflicting author requirement.

One correction batch dispatched to the same implementer, explicit immutable gpt-6-sol/medium retained: reproduce remote release-feedback loop with bounded test; suppress/defer failure-only re-admission without dropping genuinely new work or stopping recovery, including late observation ordering; update narrow retry documentation. Keep current production queue/cancellation/independent storage decisions. Re-review affected reliability concern after mechanical evidence; deterministic prose check by parent unless scope changes. Subscription map is ready for the next slice, not concurrent overlapping implementation.

Correction mechanical evidence: release-generated observation RED produced seven calls for one persistently failing row. Corrected supervisor defers observation-only retries for failed shards until periodic recovery; explicit notifications remain admissible, and source-only new work may wait for recovery. Other workers may each attempt once before local deferral; no global exactly-once claim. Private onDrainResult conveys existing failed count, with no public result-shape change. Final scoped V8 802/802 across twelve suites, supervisor changed lines 24/24 and branch arms 22/22; final static checks passed. Parent deterministic documentation check confirms normal saved-Event three-attempt retry versus typed rejection posting distinction. Existing reliability reviewer will reassess the substantive correction using its explicit retained Sol/medium profile; other concern lanes do not reopen for deterministic prose/private seam correction.

Targeted reliability re-review accepted: original P1 release-feedback loop resolved, no metadata mismatch (explicit Sol/medium retained; runtime metadata unavailable). A second P1 is confirmed in the touched pending-promotion path: with concurrency two, A/B active, queued repeat A, and B finishing first, startNext removes A, admit requeues the still-active A, and the while loop repeats synchronously while capacity remains. Reviewer checked bcad25082: this predates the correction, but directly affects required multiprocess/concurrent delivery scope. Parent source inspection confirms the cycle. Return one bounded correction to the existing implementer: skip active pending keys through a finite snapshot, retain their queued repeat, prove unrelated queued shard progress, and externally bound the RED reproduction so a blocked event loop cannot hang verification. Re-review reliability only after focused evidence.

Second correction frozen: finite pending snapshot skips active shard keys without removing their queued repeat; two concurrency regressions cover unrelated shard progress and no same-shard overlap. External 12-second watchdog retained the RED without blocking the main runner; GREEN child exits zero. Supervisor 52/52 pass; new skip-scan branch arms all hit, full-file diagnostic coverage 213/220 lines and 154/167 arms. Build/tooling/ESLint/format/cleanup/TSDoc/diff pass. Reuse existing reliability reviewer with explicit immutable gpt-6-sol/medium restated; review limited to this correction and related pending-queue invariants.

Second targeted reliability result accepted: active-key requeue P1 resolved, no new findings. Finite pending snapshot retains active repeats and admits unrelated work, preserving completed repeat priority, explicit promotion, failed-observation suppression and pending/overflow behavior. Existing reviewer confirms explicit Sol/medium retained; actual runtime metadata unavailable. All four relevant review concerns have converged for this delivery/publication/recovery/shutdown checkpoint. Final release security remains reserved; real process/transport matrix and subscription lifecycle remain open.

## Subscription readiness and cancellation review preparation

Review baseline: 2b74bf1ee. The existing implementer retains the explicit gpt-6-sol/medium profile. Freeze awaits its final scoped coverage map, branch dispositions, and deterministic preflight. The parent lightweight pre-review check inspected changed narrow references and runtime exports/policy literals: no added public export or independent timeout constant; prose distinguishes attachment ACK from future delivery and allows retry after failed Cancel. Task/acceptance records identify the remaining process, restart, example, and release gates. The user requires no legacy support or migration; strict ACK readiness is intentional.

All four canonical concerns apply. Planned dispatches: existing performance_reliability_reviewer gpt-6-sol/medium (reuse current context); typescript_api_docs_reviewer gpt-6-sol/medium; style_maintainability_reviewer gpt-6-sol/medium; documentation_reviewer gpt-6-luna/medium. Both model and reasoning must be explicit in each new spawn, or confirmed immutable and restated in a reused context. Actual runtime metadata is unavailable unless exposed. Review the bounded subscription diff only; collect the complete wave before returning one correction batch. Final security remains reserved for release readiness.

Subscription implementation freeze received and configured-profile gate accepted: existing implementer, explicit Sol/medium retained, runtime metadata unavailable. Final scoped V8 run passes 632/632 across eleven suites; added-line intersection 269/280 lines and 171/196 arms, with concrete dispositions in evidence/subscription-coverage-disposition.md. Build/tooling/ESLint/format/cleanup/TSDoc/copyright/time-read/diff checks pass. These are focused diagnostics, not the final global coverage gate. The diff is frozen against 2b74bf1ee, and the stable dist/database window is reserved for the parent external-Event evidence probe during read-only review. Dispatch the four concerns specified above; no overlapping source edits or builds.

Subscription runtime review results received: reliability, API and style each confirm existing role and explicit Sol/medium dispatch, actual runtime metadata unavailable. Parent source inspection confirms the reported paths. Reliability P1: removing a required child can shrink the pre-ACK expected set and emit readiness before the replacement child is created. API P1: DynamicUnaryClient extension adapter checks only OK/response-only and masks wrong child ID/Topic with the logical subscription, unlike native validation. API P2: public Subscription.activate/cancel TSDoc still describes old completion/one-attempt semantics. Style P2: client steady-state update loop exposes a duplicate response-only ACK as a business update. Documentation lane now dispatched with explicit Luna/medium. No correction assigned before the complete wave.

Complete subscription review wave collected. Documentation reviewer was explicitly dispatched with existing documentation_reviewer profile Luna/medium; actual runtime metadata unavailable. Accepted P2 adds cancellation-during-activation rejection to the client reference. Parent questioned the custom-ACK finding because BackendSubscriptionEnvelope is expressly opaque: API reviewer confirms no existing serialized-Subscription guarantee, server-assigned IDs may differ from requested IDs, and narrows its P1 to P2 missing extension-point responsibility. Do not decode arbitrary private envelopes or compare a server-generated child ID with the requested derived ID. Built-in NativeSubscriptionCreator validates the accepted actual Subscription. The trusted custom SubscriptionCreator.activate contract must state matching ID/Topic validation before forwarding updates. This is a documentation correction, not a new typed identity contract.

One accepted batch to the existing explicit Sol/medium implementer: (1) P1 preserve all required replacement children in pre-readiness barrier and reproduce same-key endpoint replacement plus removed-key/new-key snapshot as appropriate; (2) P2 reject duplicate response-only ACK in client steady-state updates with meaningful regression; (3) P2 public Subscription activate/cancel TSDoc reflects ACK completion and retryable failed remote cancellation; (4) P2 document trusted creator validation duties and correct matching fixture claims without imposing a format on opaque envelopes; (5) P2 explain cancel-during-activation rejection. Rereview reliability for replacement semantics and style for duplicate control-response handling; parent verifies deterministic prose directly. No repeated full review wave without substantive new scope.

Subscription correction frozen by the same explicit Sol/medium implementer; runtime metadata unavailable. Four affected V8 suites pass 227/227, with required replacement success/failure and duplicate ACK branches exercised. Build/tooling/ESLint/format/cleanup/TSDoc/copyright/time/diff pass. Parent directly verifies the accepted public-interface, opaque-envelope extension duty, and cancellation-race prose. Reuse existing performance_reliability_reviewer and style_maintainability_reviewer with their original explicit Sol/medium profiles restated; limit re-review to pending-readiness replacement and duplicate ACK corrections. No full-wave repeat.

Subscription correction re-reviews accepted: existing reliability and style roles both confirm their explicit immutable Sol/medium profiles; runtime metadata unavailable. Both findings resolved, no new actionable findings. The final desired membership snapshot holds readiness until replacement children attach and acknowledge, rejecting failed replacement; duplicate control ACK is rejected before public business delivery. Parent prose checks resolve API/documentation findings. All four canonical concerns converge for this checkpoint. Full SQL transport/process/restart acceptance, remaining publication-route failures, examples, and final security/release remain open.

Architecture follow-up dispatch: existing requirements_splitter role, explicit gpt-6-astra/high, new context because earlier role is no longer active. Trigger is the demonstrated canonical Event family/System routing ambiguity, not repeated broad planning. Review StorageContext diagnostics-only contract, SystemContext/EventStore/bus selection and known-ID repair; classify existing semantics and recommend the smallest task-compliant route/repair behavior without a new persistence contract. Actual runtime metadata unavailable unless exposed. No source changes or checks by architecture agent; independent PM/retry work continues in the existing implementer.

System architecture follow-up accepted: explicit requirements_splitter Astra/high matches configured role, runtime metadata unavailable; read-only. Existing D-0109 separation and diagnostic-only context names are jointly implemented through StorageGroup. Bounded exact-ID repair checks both families, rejects collisions, and selects domain/System bus; internally produced System Events receive idempotent optional append before finite delayed original-envelope dispatch. No new persistence records/coordinator/outbox/history scan, legacy migration or user decision. ARCHITECTURE.md records exact requirements and acceptance; implementer receives this bounded correction, including real provider grouping under explicit table-name overrides.

Parent lightweight pre-review pass for publication follow-up: no new barrel exports, one System group constant and one finite retry delay/budget source. Task acceptance remains partial. Prose corrections sent before freeze: repair option TSDoc includes saved System IDs; forgetting mode does not prevent repair of previously stored IDs; retry interruption names terminal closure rather than promising all retries stop at begin-close; forgetting-mode live retries are distinct from restart recovery. Final focused coverage/static evidence is still pending, so no reviewer dispatched yet.

Publication implementation freeze accepted from existing implementer with original explicit gpt-6-sol/medium profile; runtime metadata unavailable. Baseline df92f906d, current unstaged runtime/test/prose diff. Six focused suites420/420, added executable-line intersection89/90 and branch arms47/54 with specific defensive/timing dispositions; final build/static gates pass. Root lightweight diff/status/docs/constants/export preflight passes after narrow wording corrections. All four canonical concerns apply. Dispatch existing performance_reliability_reviewer, typescript_api_docs_reviewer and style_maintainability_reviewer explicitly gpt-6-sol/medium; documentation_reviewer explicitly gpt-6-luna/medium when capacity permits. New contexts are needed because prior review agents are absent from current live tree. No child delegation or source/build/test mutation. Concern-specific bounded review only; collect complete wave before one correction batch. Root may run existing four-provider external Event repair probe against frozen dist. Full matrix/release acceptance remains open.

Publication API and style results received; both confirm existing roles and explicit Sol/medium configuration, actual runtime metadata unavailable. Style clean. API reports P2 stale MySQL grouped-name fallback claim and P3 internal StoredEventPublication falsely calling unsaved IDs committed. Reliability reports a pending P2 already-aborted signal gap between first and second exact-family reads; final reliability result and documentation lane remain pending. Dispatch existing documentation_reviewer explicitly Luna/medium now that capacity is free, limited to affected claims and known concrete stale prose. No corrections assigned before the full wave.

Complete publication review wave collected. Reliability/API/style confirm explicit Sol/medium configured roles; documentation confirms explicit Luna/medium, runtime metadata unavailable for all. Parent inspected exact read listener setup, MySQL resolver/prose, shared retry loop and internal publication type. Accepted one combined correction batch:

- P2 reliability: cancellation after domain read settles but before System read starts can attach to an already-aborted signal and hang on the second read. Check abort state before starting each read and cover the between-read gap, including no subsequent read/dispatch and prompt CANCELLED outcome; observe any entered query rejection.
- P2 API: MySQL reference must distinguish grouped override/default from ungrouped record override/default; ungrouped fallback was removed to keep families separate.
- P3 API: internal StoredEventPublication describes a captured/original ID, not necessarily a committed ID when optional System append exhausts.
- P3 documentation: explicitly state the existing finite three-attempt/100ms policy also applies to each known-ID repair dispatch and that returned attempts are actual bus dispatch attempts, not recipient completion or successful persistence.

Style clean. Return this batch to the same existing implementer, immutable explicit Sol/medium retained and both restated. Re-review reliability only after the cancellation correction; parent checks deterministic prose against accepted text. No broad repeated wave or new architecture pass. Full task process/restart/examples/release acceptance remains open.

Publication correction freeze: existing implementer retains its explicit gpt-6-sol/medium configuration; runtime metadata unavailable. The valid between-read RED timed out, GREEN returns CANCELLED with zero System reads and dispatches; 35 affected tests and final static/build checks pass. Dispatch a targeted existing performance_reliability_reviewer with explicit gpt-6-sol/medium because the previous context is absent from the active surface. Review only cancellation correction and regression, read-only. Parent verifies the three prose corrections directly; no repeated whole wave.

Publication targeted reliability re-review accepted: existing performance_reliability_reviewer explicitly dispatched gpt-6-sol/medium, configured profile confirmed, runtime metadata unavailable. Clean disposition: pre-read guard closes the between-family abort gap, setup guard and finally preserve listener lifecycle. Parent directly verified MySQL grouped naming, captured-ID TSDoc, and finite repair retry prose. All four concerns have converged for this checkpoint. Full process/restart, examples and release acceptance remain pending.

## Process acceptance harness review

The first harness is frozen against ad8491fad and under mechanical baseline matrix execution with exclusive dist/harness reservation. Only changed files under packages/server-blackbox-tests, test-inventory, root TS references, package/lock integration, and port0 test-fixture changes belong to this wave; exclude concurrently edited managed-close runtime/source-local tests from this review. Existing implementer explicit Sol/medium reports focused fixture/adapter and build/static preflight clean. All four canonical concerns receive bounded review: reliability (process lifecycle, isolation, per-ID/handler/Event-byte accounting, failure evidence), style (fixture/helper cohesion), API (private package/build/generated imports and signatures), docs (reproducible command/setup and truthful claim boundaries). Use existing configured roles with explicit gpt-6-sol/medium for first three and gpt-6-luna/medium for documentation; actual runtime metadata unavailable. Capacity allows one reviewer beside parent/implementer/mechanical run; collect full wave before one harness correction batch. Do not edit frozen harness or dist during matrix. A confirmed unsafe cleanup issue may require stopping the current run before continuing, rather than waiting for review completion. Final managed lifecycle/runtime review will follow its correction separately.

First process harness review wave complete. Reliability, API and style confirm their existing explicitly dispatched gpt-6-sol/medium profiles; documentation confirms gpt-6-luna/medium. Actual runtime metadata is unavailable. API is clean. Accepted one batch to the same explicit Sol/medium implementer: bounded TERM-to-KILL/reap even when the driver ignores TERM; request-level IPC send/error/disconnect rejection with listener cleanup; full method/correlation/recipient/Event-byte validation for new Commands after graceful worker recreation; actual domain-correct recipient identifiers at every handler entry. Documentation corrections add exact selector values/build/endpoint setup, distinguish graceful recreation from crash, and separate the first passing workload from its failed outer evidence collector. Parent handles MATRIX_PLAN and status records. Reliability and style receive targeted correction review; deterministic prose is checked directly. Managed-close runtime remains a separate substantive lifecycle correction and needs its own bounded review.

Collector follow-up accepted from the orchestrator mechanical function with its original explicit gpt-6-luna/low configuration, restated in dispatch and confirmed by result. Actual runtime metadata unavailable. Node syntax, targeted format/ESLint/diff and explicit audit pass. Each future matrix execution uses a fresh UUID output directory; the failed original collection remains intact. No additional matrix workloads ran. The first workload must be rerun after recipient-identity corrections and does not count as a final complete-matrix case.

Managed-close review scope must include strict-ACK fixture corrections in remote-readiness and external-events integration tests. Parent source check identified first response-only ACK incorrectly satisfying `done:false` business assertions; expected generated state identity must be decoded after validated readiness. Check bounded teardown of only recorded test child processes and the distinction between expected close cancellation and genuine cleanup failures. These mechanically identified corrections do not reopen the completed subscription wave; the newly changed managed lifecycle gets its relevant concern review after preflight.

Managed pre-review source note sent before freeze: the new child wait for parent
`finish-close` must remain finite even when the parent stays connected but never
sends that message; disconnect alone is not the full bound. Parent post-ack
outcome waiting also needs a finite failure path. Keep existing lifecycle limits
and report genuine cleanup failure rather than add a public option without a
contract need. Verify actual server-side error before changing network timers;
the observed internal trailer came from concurrent kernel disposal, not proof
that the network grace period was too short.

A bounded requirements_splitter follow-up is required for the demonstrated managed-close deadline ambiguity. Dispatch explicit gpt-6-astra/high, read-only source analysis plus task architecture evidence only; no subagents. The one-second acknowledgement timer cannot become an overall drain timer. Preserve the earlier finite context deadline scope and successful admitted updates, define the smallest bounded stalled-drain/relay/final-phase behavior, and retain explicit failure/at-least-once crash limits. This is one targeted architecture pass, not a repeated full-wave plan.

Managed deadline architecture follow-up accepted: existing requirements_splitter
explicitly gpt-6-astra/high, configured profile confirmed; runtime metadata
unavailable. Source and JVM guardrails support one minimal managed budget,
independent context/IPC timers, truthful force failure, retryable pre-deadline
relay cleanup, and closed subscription admission. D-0131 and ARCHITECTURE.md
record the decision; return to existing explicit Sol/medium implementer. Public
option means all four canonical concern lanes apply to the final managed slice.
No persistence contract or human blocker is introduced.

Project harness correction preflight received from same explicit Sol/medium
implementer: watchdog and selected PG16 two-process graceful recreation2/2,
composite build/tooling/touched ESLint pass; exact typed recipients and both
recreated-worker snapshots are persisted. Freeze corrected harness only and
re-review reliability/style substantive corrections. API was clean and unchanged;
parent verifies deterministic setup/restart prose. Managed lifecycle remains
unfrozen and excluded. Reuse existing concern roles with explicit Sol/medium
profiles; new contexts if prior reviewers are not live. Runtime metadata
unavailable. No full matrix until targeted results converge.

Targeted harness correction reviews accepted: existing reliability and style
roles explicitly dispatched gpt-6-sol/medium, configured profiles confirmed;
actual runtime metadata unavailable. Style clean; actual generated recipient
identifiers resolve its prior finding. Reliability confirms bounded watchdog,
IPC request settlement, and complete restarted worker Event/entry checks. One
accepted P2 remains: SIGKILL after CREATE DATABASE bypasses driver finally, but
resource identity is only emitted after successful cleanup; timeout errors cannot
identify the leftover UUID database. Persist/report run ID, exact database and
evidence path before resource creation, retain that identity in parent failure
diagnostics, and explicitly mark forced cleanup unknown/incomplete. Return this
one combined final harness correction to the same implementer. No API/style lane
reopens for deterministic resource-evidence changes; parent checks focused
failure evidence and cleanup directly, asking reliability only if the fix adds
substantive lifecycle behavior. Full baseline matrix is still stopped.

Parent audit of corrected smoke609c05db7b59431dae48483df673a870 passes via the
collector's audit-only mode: typed entry fields/counts, both recreated-worker
snapshots, original/new Event bytes/hash, exact fresh PIDs, and database/child
cleanup. Evidence/corrected-harness-audit-609c05db.json is fresh and earlier
FAIL_FAST records remain intact. This audit launches no runtime or database.
Collector follow-up profile explicit Luna/low confirmed; runtime unavailable.

Final harness P2 correction accepted by deterministic parent inspection and
focused evidence: resource.json plus MATRIX_RESOURCE are written before CREATE
DATABASE, so forced-stop error output retains exact run/database/evidence path.
Adapter explicitly labels cleanup unknown after forced termination; the resistant
child test preserves identity and verifies no false cleanup record, then removes
only its exact temporary fixture directory. Watchdog1/1 and selected adapter2/2
pass; targeted lint/format/diff pass. This is resource-evidence handling without
a new lifecycle algorithm, so no specialist lane reopens. All four concerns
converge for the harness; complete SQL matrix acceptance remains pending.

## Managed shutdown review wave

The managed shutdown slice is frozen after the ordinary network-close correction.
Reported preflight: normal incremental build, four focused suites113/113, scoped
V8 run113/113, touched ESLint/Prettier, cleanup/TSDoc, tooling typecheck and
whitespace check pass. Evidence: managed-deadline-freeze-focused2.log and
managed-deadline-coverage1.log plus final static logs. Prior kernel cancellation
coalescing regression60/60 remains relevant; no intervening kernel change.

Dispatch existing performance_reliability_reviewer and typescript_api_docs_reviewer
explicitly gpt-6-sol with medium reasoning, fork none, read-only concern-specific
review. Then use existing style_maintainability_reviewer (Sol/medium) and
documentation_reviewer (Luna/medium) as slots permit. No subagents, builds,
processes or edits beyond assigned evidence records. Actual runtime model
metadata unavailable; explicit configured profiles satisfy the acceptance gate.
Collect all four lanes into one correction batch before reopening frozen files.
Paging implementation may proceed in independent paths. Final security remains
a release-readiness gate.

Frozen runtime paths: server/managed-server-application.ts, server/node-coordinator.ts
and deployment/internal/backend-membership-kernel.ts; corresponding unit and
managed real-process tests plus narrow server API documentation. Compare each
assigned path to33e9c9c82, which includes only preceding committed work. Review
the full relevant diff, not unrelated pending harness or paging edits.

Managed reliability and API lanes completed. Explicit configured Sol/medium
profiles match dispatch; runtime introspection unavailable. Reliability records
P1 forced child exit can become success on repeated close and P2 stuck membership
reconciliation prevents kernel cleanup from starting at the deadline. API records
parent timeout above the child's default being ignored/tightened, plus missing
numeric range in option TSDoc. Parent persisted the API chat result. No runtime
checks by reviewers. Style Sol/medium and documentation Luna/medium lanes now
dispatched explicitly, read-only, concern-specific. Findings remain collected
until both finish; managed files remain frozen, paging continues independently.

Complete managed review wave accepted: all four explicit profiles match their
dispatches; actual runtime introspection unavailable. Style is clean. Documentation
adds context deadline interaction and phase-specific3second/2second cleanup
allowances. Parent accepts one aggregate correction batch: preserve terminal
force failure across close retries; initiate independent kernel cleanup despite
stuck reconciliation; carry validated parent budget into managed child without
local-default clamping; numeric option range and timer clarifications. No legacy
fallback. Return to existing Sol/medium implementer, add focused behavior
regressions and affected checks. Re-review reliability/API only after fixes;
documentation corrections are deterministic unless the resulting contract changes.
Style does not reopen for straightforward bounded fixes.

Parent correction inspection found one additional deadline defect in the same
concern: child #beginDeadline and default parent clock use Time.currentTimeMillis,
although Time.monotonicTime exists. A backward wall-clock adjustment can make a
new child timer appear earlier while extending its actual remaining duration.
Use monotonic duration readings for both deadline calculations, preserving the
injected clock seam, and cover nonextension under wall-clock adjustment. Sent
to the same implementer within the bounded correction; include in targeted
reliability re-review, no architecture or full review wave reopened.

Managed correction freeze:109/109 managed and Coordinator unit tests plus7/7
real managed integrations pass. Evidence managed-review-final-unit2.log and
managed-review-integration5.log. Covers forced-failure retry, both kernel cleanup
starts under stalled reconciliation, public60second parent/default child and
monotonic duplicate-frame nonextension under wall-clock rollback. Normal server
build, affected ESLint/Prettier and whitespace checks pass. Global cleanup/TSDoc
fail only in independently active paging paths; managed paths are clear.

Targeted follow-ups sent to the same existing reliability/API review contexts,
retaining their original explicit gpt-6-sol/medium profiles and restating both
fields. No new role, tests, builds or code edits. Recheck accepted findings and
monotonic correction only; unaffected style lane stays closed. Parent verifies
deterministic prose corrections. Actual runtime introspection unavailable.

Targeted API re-review resolved with no residual findings. Same explicit
Sol/medium configuration confirmed; runtime metadata unavailable. Parent also
checked corrected option range, separate context timer, and3second graceful
versus2second force-grace wording in source/reference/API README. Deterministic
documentation corrections accepted without reopening its lane. Reliability
re-review remains active.

Targeted reliability re-review resolves TERM/KILL and explicit close-failed
retention, independent kernel cleanup under stalled reconciliation and monotonic
deadlines. One residual P1 remains in the same terminal-result contract: child
exit before delivery-drained rejects the first drain wait but is not retained
when closeFailure is unset; awaitChildClose accepts the pre-ACK exit, and a second
close can resolve from empty slots. Accepted narrow correction returned to the
same implementer: retain premature-exit failure and assert two close rejections
while other cleanup completes. Only reliability reopens afterward; API/style/
documentation stay closed. Profile remains explicit Sol/medium, actual runtime
metadata unavailable.

Managed integration fixtures now reference authored paging RPC declarations.
Avoid committing those fixtures without their corresponding contract/runtime
changes; retain a coherent working tree and choose an appropriately complete
checkpoint rather than publish a broken partial commit.

Managed residual correction frozen. managed-review-residual-final.log reports
70/70 unit tests; residual cleanup/ESLint/format and tsdoc-final logs pass.
Earlier TSDoc failure retained, corrected in final log. Only managed application
and its unit test changed since the preceding targeted review. Dispatch the
same reliability context again, original explicit Sol/medium retained and both
fields restated, to check premature-exit retention only. Other concerns remain
closed and paging continues in separate files.

Final residual-only reliability re-review is clean. Premature exit now records
exitFailure and terminalChildFailure; awaitChildClose rejects, repeated close
still attempts other cleanup but includes the retained terminal result. Two-child
regression checks both failures and the other child's close attempt. Same explicit
Sol/medium profile confirmed; runtime metadata unavailable. No reviewer tests
or code edits. All managed review concerns are now closed: reliability/API
resolved, style clean, deterministic documentation corrections accepted.

Managed review convergence does not establish full SQL transport/fault/process
acceptance or final release verification. Keep its runtime/tests frozen while
paging is completed, then commit a coherent dependency-complete checkpoint.

## Exact remote paging review dispatch preparation

After the implementer freezes the clean deterministic preflight, review the
uncommitted paging slice against accepted D-0132. Existing API and reliability
review contexts use their original explicit gpt-6-sol / medium profiles; style
uses gpt-6-sol / medium and documentation uses gpt-6-luna / medium. Every fresh
dispatch must state both fields explicitly. Runtime metadata is not exposed;
the immutable configured profile and explicit dispatch fields are the acceptance
evidence. Reviewers must not spawn children, change runtime/tests, run broad
verification, or reopen the converged managed shutdown slice.

API scope: authored Proto boundary, validation, client declarations, continuation
semantics, unsupported endpoints, no legacy fallback. Reliability scope: exact
ordering/seek, tied/deleted cursors, local filters, bounded reads, one deadline,
cancellation and malformed peer responses. Style scope: affected callable
complexity, existing abstractions and narrow test harness additions. Docs scope:
manual assembly/health, required endpoint and live-read limitations, current API
expectations and claim/evidence agreement. Collect all four before one correction
batch. Security remains deferred to final release readiness.

Paging API review completed with two accepted findings: missing per-page message-ID
uniqueness and stale DeliveryPagingError TSDoc. Parent persisted the read-only chat
result in evidence/paging-api-review.md. Explicit original Sol/medium dispatch
confirmed, no visible profile mismatch and no runtime introspection. No tests ran.
Existing style reviewer context now continues with its original explicit Sol/medium
profile over paging and bounded harness diagnostics only. Reliability is running;
documentation follows when capacity permits. No partial correction batch yet.

Paging style review is clean; parent persisted its read-only chat result. Reliability
returned two P2 findings: duplicate IDs (same issue as API; deduplicate) and malformed
peer timestamp escaping as TypeError rather than DeliveryProtocolError. No further
confirmed traversal/deadline/cancellation or harness diagnostic issue. Both existing
Sol/medium profiles retained explicit dispatch configuration, no runtime metadata
exposed. Documentation review dispatched to existing explicit Luna/medium context,
with narrow changed paging claims and no reopening of managed shutdown.

The four-concern paging review wave is complete. Accepted combined batch: reject
repeated message IDs despite increasing tuple; classify invalid peer timestamp
as DeliveryProtocolError while preserving local input validation; describe current
DeliveryPagingError role; document sinceWhen/after mutual exclusion and whole-read
AbortSignal cancellation. Style clean. Documentation added two bounded claim gaps
and otherwise accepted endpoint/manual assembly/ordering/live-read limitations.
Same implementer receives the entire batch; independent live fault work pauses
at a safe boundary. Only API/reliability need targeted re-review after behavioral
corrections; parent verifies deterministic prose. No managed or harness edits.
Expected bounded correction/preflight/re-review: 0.3–0.6 hours, then failed workload
repeat. Profile gates all accepted with explicit original fields, no mismatch and
unavailable runtime self-introspection.

Paging correction re-review converged. API and reliability both report resolved,
no directly affected residual findings. Explicit existing Sol/medium profiles
retained, no tests/builds performed by reviewers. RED reproduces duplicate ID and
malformed timestamp classification; affected GREEN is 50/50 and build/tooling/
ESLint/format/cleanup/TSDoc/diff checks pass. Parent directly checked reference
mutual exclusion/initial-filter text and whole-read AbortSignal scope, accepting
both deterministic documentation corrections. Style lane stays clean.

A dependency-complete managed shutdown, paging and diagnostics checkpoint is ready
for commit/push. The new independent SQL fault integration file and its inventory
entries remain uncommitted while acceptance expands; they are not part of this
checkpoint. The failed process workload must still be repeated, then the full
baseline and historical labels; no causal attribution from the separate paging
reproduction alone.

## Live SQL Delivery fault acceptance review

Frozen six-case/provider test-only slice uses real SQL Inbox/registry and public
DeliveryBuilder behavior. PG16/18 and MySQL/Maria each6/6; deterministic inventory
4/4, typecheck/ESLint/format/diff pass. Existing reliability and style reviewers
are dispatched with their original explicit gpt-6-sol / medium profiles. Read-only
concerns: meaningful failed/pending vs successful/ack distinctions, exact counts,
real trigger/cause boundaries and cleanup; fixtures/type semantics, maintainability
and opt-in inventory conventions. Runtime metadata unavailable. No builds/database
work while matrix reserves output/services.

Public API review N/A: no production or exported contract change; tests exercise
existing ports and provider opt-in scripts. Documentation reviewer N/A: no user
claims changed; implementation ledger explicitly limits this to one OS process,
controlled deadlock-class errors and no crash/admission proof. Parent checks those
limits against evidence. Security remains final-release gate. Collect both relevant
concerns before one accepted correction batch.

Live-fault review wave complete. Two accepted P2 corrections, one shared by both
reviewers: monitor callback assertions must become observations asserted outside
Delivery's exception containment; fixture cleanup must attempt each independent
factory/SQL/database/admin cleanup even when an earlier close fails, then report
failures. FailedReception exposes no phase field; the rejected redispatch action
is the supported acknowledgement-path proof once asserted outside the callback.
The existing Sol/medium implementer receives one batch, source-only until current
matrix reservation permits verification. Style/reliability profiles accepted with
original explicit fields and unavailable runtime metadata.

Live fault correction freeze: controlled cleanup RED then GREEN, all four providers
7/7 in live-fault-review-four-engines-green1.log. Typecheck/ESLint/format/diff final
logs clean. Same reliability reviewer targeted again under existing explicit
Sol/medium profile to inspect both resolved findings only. Parent deterministic
style check confirms callback only captures code/repeat outcome; all cause/message/
length assertions now execute after run outside containment. Style issue resolved
without reopening the full lane. No production code changed.

Targeted live-fault reliability re-review is clean: callback facts are asserted
after run; resource release attempts factory close, SQL end, exact UUID DROP and
admin end independently and reports all failures. New regression injects both
early failures and proves DROP. All4 providers7/7 and static checks pass. Original
explicit Sol/medium review profile accepted; no reviewer runs. Test-only slice
converged and ready for its separate commit/push.

## Planned process-crash fixture review

After the corrected PostgreSQL smoke and deterministic preflight freeze, dispatch
two existing specialist concerns with explicit gpt-6-sol / medium profiles:
performance/reliability and style/maintainability. Scope is the new process-fault
driver, its opt-in test and inventory registration, and bounded project-worker
fixture additions. No production runtime change is currently part of this slice.
Read-only reviewers must not build, run services, or edit implementation files.

Reliability must check proof of received Command acknowledgements, exact typed
recipient identity, controlled OS death, committed acknowledgement versus attempted
SQL, cleanup versus pending failure, all resulting states, execution counts,
original saved Event identity, concurrent repair, volatile Inbox loss, bounded
cleanup and false-positive test paths. Style checks fixture structure, repository
conventions, domain-correct generated types, error propagation and evidence clarity.
Collect the full wave before returning one correction batch to the implementer.

Public API concern is N/A for this test-only slice because no exported runtime
contract changes. Documentation concern is N/A for user-facing documentation at
this stage; the implementation ledger must accurately distinguish preliminary
runs and accepted evidence, replay-safe duplicate execution after a crash, and
volatile-server loss. Parent checks those concrete limitations. Broad user guide
and example changes receive separate review. Final security remains pending.

The combined process-fault and bounded cleanup-tool slice is now frozen. The
checker previously requested every evidence patch and untracked file; it now
limits patch reads to audited sources while preserving global rename classification.
A new regression first failed, then passed while still rejecting a newly added
oversized production callable. Full checker suite 156/156 and actual branch
lint:cleanup pass. The four corrected PG16 two-process crash scenarios, inventory
4/4, tooling typecheck, syntax, ESLint, formatting, TSDoc and diff check pass.

Dispatch performance_reliability_reviewer and style_maintainability_reviewer with
both explicit model gpt-6-sol and reasoning medium, forked without prior history.
The scope now also includes scripts/check-cleanup-rules.mjs and its regression
tests: source selection must not weaken changed-line or rename enforcement.
Reviewer output files are disjoint under task evidence; implementation remains
frozen. Actual runtime introspection is unavailable; accept the immutable explicit
configured role/profile unless the surface reports a mismatch.

Both process-fault reviewers completed with the explicitly configured Sol/medium
profiles and no exposed runtime introspection. The full wave has three accepted
P2 corrections, aggregated into one batch for the existing implementer:

- Confirm successful SIGKILL and observed exit for every targeted old PID before
  replacement; retain cleanup tracking until confirmation. In the before-effect
  case, also prove the effect remains absent after the selected process exits.
- Require complete, successful expected-shard Inbox observations before absence
  claims; reject error/truncated/missing rows rather than treating them as empty.
  Add a focused negative regression for the rejected observation.
- Bound process reaping after the wrapper escalates to SIGKILL and report durable
  resource/cleanup diagnostics on timeout, as the existing matrix wrapper does.

The Inbox-read finding is shared by both reviewers. The source-scoped cleanup
checker correction is otherwise clean; no additional source-policy weakening was
identified. After focused negative tests/static checks and affected live smoke,
re-review only death/observation/reaping concerns. Broad SQL matrix starts after
those converge. No new production behavior or architecture is required.

Before the matrix freeze, complete the already-required post-cleanup replay
boundary in the partial-publication scenario. After the retained-window eight-call
repair proves one entry per recipient, observe actual runtime cleanup of delivered
recipient rows using complete successful shard reads. Then explicitly repair the
same saved Event again, recording the second entry for each recipient, unchanged
Event bytes and no additional Command execution. No direct deletion, sleep-only
assumption or retention disabling is permitted. This test-only phase will be part
of the affected reliability/style re-review; it does not strengthen the runtime
contract beyond the documented duplicate possibility after retention.

Correction to the proposed post-cleanup assertion: requiring every recipient to
execute exactly twice is not a user requirement. The binding requirement says
replay may repeat a previously successful recipient after cleanup, and requires
accurate counts and outcomes. The first extended run observed Planning/Staffing
twice but both projections once. Determine whether those projections were validly
suppressed, pending or failed before changing assertions; do not alter correct
version/idempotency handling merely to force repeated execution. Capture entries
immediately before and after the final repair to distinguish work triggered during
the retention/lease wait from work triggered by that repair. Likewise, classify
whether duplicate checks occur at admission or dispatch before making claims
about requests admitted while a prior delivery record was retained.

## Process-fault correction review dispatch

The corrected fixture is frozen after the final PostgreSQL 16 cold-process replay and static preflight. The existing performance/reliability concern is dispatched to `gpt-6-sol` with explicit `medium` reasoning; the previous style reviewer is resumed with its immutable explicit `gpt-6-sol` / `medium` profile. Both review only the three accepted harness corrections and the added cleanup/restart replay evidence. No production behavior changed. Desktop supports these explicit profiles; actual runtime self-introspection is unavailable. Collect the complete wave before returning fixes. Public API and broad documentation concerns remain N/A for these test-only corrections; their final task reviews remain pending.

## Process-fault correction acceptance

Both targeted review reports are clean. The three accepted harness findings are resolved, including strict complete Inbox observations, confirmed process death, and bounded watchdog cleanup. The added cleanup/fresh-process replay test is accepted for the measured PostgreSQL 16/two-process scope. Explicit dispatch fields and immutable configured profiles match both assignments; runtime introspection is unavailable. Full provider/process matrix and final release checks remain pending. The independent cleanup-checker correction passed 156 tests and both first-wave reviewers found no weakened enforcement.

## Crash-boundary assertion correction review plan

After the implementer freezes the focused correction, resume the existing performance/reliability and style/maintainability reviewers, each with the original explicit immutable `gpt-6-sol` / `medium` profile. Review only persisted pre/post-kill observations, exact pending-row/typed-recipient/PID classification of an optional repeat, focused positive/negative tests, and test inventory/provenance changes. Original failure `15ef62...` must remain unclassified because it lacks row snapshots. Measured SQL lease timing must not be confused with the separate supervisor stale-session timer. No production code changed; public API/documentation concerns are N/A for this assertion correction with final broad task reviews still pending. Collect both reports before accepted fixes. Actual runtime metadata remains unavailable.

## Crash-boundary correction review wave disposition

Style is clean. Accept the reliability P2: the helper and independent matrix audit must first select all exact original-Event/typed-recipient rows, require one unique matching row in both snapshots, and only then require that same row pending. A delivered-plus-pending pair cannot establish which row caused the prior handler entry. Add a deterministic negative case. This is a narrower evidence classification, not a new exactly-once guarantee after cleanup. Correct the final p8 evidence: `a20549c73cec475fb23aecee312d192c` observed a supported ProjectProjection repeat on old PID 88709 and fresh PID 88984 with exact pending row `11a12591-d022-4ffc-adb2-11bc63d50f31`; p2 `b63f7be322f84bb486466937c046c799` had no optional extra. Original failed `15ef62...` remains unclassified. Return the complete one-finding batch to existing Sol/medium implementer and matrix-only rule to existing Luna/low function. Re-review reliability only after focused checks; style does not reopen for this deterministic assertion correction.

## Crash-boundary assertion correction accepted

Reliability-only re-review is clean: the delivered-plus-pending ambiguity is rejected by both helper and matrix audit; all 16 focused tests pass and the saved p8 positive replay passes the stricter classifier. Prior style review remains clean. Both reviewer profiles match their explicit immutable Sol/medium dispatches; actual runtime introspection is unavailable. No production runtime changed. Commit/push the frozen assertion correction and relaunch the 32-case matrix; do not repeat the accepted 80-run baseline.

## Gateway lifecycle architecture acceptance

Accept the bounded decision in D-0133 and `evidence/gateway-child-stream-recovery-decision.md`. Existing requirements-splitter profile was explicitly `gpt-6-astra` / `high`; actual runtime metadata unavailable and no mismatch. The real child-fault trace plus static fixed-backend lifecycle establishes the block. No human decision is required. Existing Sol/medium implementer applies the minimal private lifetime-failure mechanism after completing the current test-gate correction; no server retry loop or new API. Required scoped kernel, managed relay, and real browser regressions precede relevant specialist review.

## Nonblocking crash gate review dispatch

The test-only gate correction is frozen after focused PostgreSQL 16 controls and deterministic preflight. Dispatch existing reliability and style concerns with explicit `gpt-6-sol` / `medium` profiles. Review only the three changed process fixture files, phase observations, and accepted outcomes; transport work remains in progress and excluded. No production behavior or public API changed, so API and broad documentation concerns are N/A for this bounded correction. Human ledger remains binding: count actual handlers, distinguish processing from acknowledgement, and preserve expected volatile Inbox loss. Desktop supports the explicit profiles; runtime introspection is unavailable. Collect both reports before corrections.

## Nonblocking crash gate accepted

Both scoped reviewer reports are clean. Explicit model/reasoning fields and immutable configured Sol/medium roles match the assignments; actual runtime introspection unavailable. All five generated domain handlers await the selected gate, including Create in the expected volatile-loss case. Final PostgreSQL 16/eight-process acknowledgement evidence places the trigger 99 ms after entry and proves one old/one fresh Planning entry. Previous invalid placement remains failed evidence. Accept the test-only correction; full matrix remains pending and no 80-run business baseline repetition is required for this fixture-only change.
