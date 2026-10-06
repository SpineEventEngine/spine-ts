# Spine Time review

Baseline: `52fb932f25ab1dc1b8617169d9502bccebcef21e`.
Scope: Task 1 shared Time, framework adoption, receipt precision and required documentation/cleanup.

## Dispatch and concerns

The implementation preflight is recorded in `spine-time-worklog.md`. Start the review wave after the remaining Time cross-reference correction and checkpoint. Reviewers receive concern-specific prompts and paths, the human requirements ledger, and current evidence. They must not edit files, run broad suites or delegate. Use fresh ephemeral CLI 0.160.1 contexts because Desktop cannot allocate additional independent child contexts. Standard speed; `fast_mode=false`. Load each existing role's instructions from its unchanged `.codex/agents` file and pass both model and reasoning explicitly.

| Existing role                    | Explicit model | Explicit reasoning | Assigned concern                                                                                                  | Status   |
| -------------------------------- | -------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------- | -------- |
| typescript_api_docs_reviewer     | gpt-6-sol      | medium             | Time exports/provider contract, clock compatibility, Inbox/cursor/codec types and precision, package declarations | Complete |
| performance_reliability_reviewer | gpt-6-sol      | medium             | Occurrence ordering, provider scope, elapsed waits, runtime extractions and precision evidence                    | Complete |
| style_maintainability_reviewer   | gpt-6-sol      | medium             | Changed structure, clock substitutions, AST bypass gate, domain-correct tests and meaningful comments             | Complete |
| documentation_reviewer           | gpt-6-luna     | medium             | Current README/REFERENCE/TSDoc claims, examples, units, limitations and migration guidance                        | Complete |

Runtime headers must confirm the requested model/reasoning; record any metadata limitation instead of inferring model identity. No implementation result or documentation assistance substitutes for specialist review. Collect the complete review wave before returning one accepted correction batch to the original implementer.

Security disposition: no separate task security review. BUILD_PROTOCOL.md makes the dedicated security role a final coordinated project release-readiness gate. Changed auth clock/extraction behavior is included in the Sol/medium reliability review; no auth feature or policy is added.

## Results

Review checkpoint: `fb616bc60`. Mandatory preflight is complete, including the corrected Time cross-reference and warning-free API documentation rerun. Fresh API and reliability reviews are dispatched first; the remaining lanes follow as active capacity becomes available. Final release verification has not run.

The first three CLI runtime headers confirm `gpt-6-sol`, `medium`, and read-only sandboxing, matching the explicit existing role dispatches. CLI session IDs: API `01a11158-e278-7af3-8de9-36a6b46fb61a`; reliability `01a11158-e5ab-7ae2-a5da-9de93fe2fc1e`; style `01a11159-41bd-71e1-8d2a-cc312f9fcd5c`. Independent runtime headers are available for these CLI runs; no fallback is reported.

## Accepted correction batch

The complete first wave is collected. Documentation's first CLI attempt ended before review because the requested model was at capacity; retry with the same existing gpt-6-luna/medium profile succeeded. Its runtime header confirms that profile and read-only mode (session `01a1115d-0820-76a0-b2c9-b1a3e361de89`; the exact runtime header is available in the temporary review log). No model substitution occurred. Raw findings are in `spine-time-evidence/review-*.md`.

1. API P1: move delivery-client's newly used core runtime dependency from devDependencies to dependencies and update the lockfile. Accepted.
2. API P2: make normalized Inbox read-result `whenReceived` a Timestamp while retaining legacy Date inputs in the existing input contracts. Accepted; consistent with the approved architecture, without a new clock or storage design.
3. Style P2: detect bound clock callbacks (and corresponding call/apply forms) in the time-read gate; add focused regression cases. Accepted.
4. Style P2 plus documentation low-severity duplicates: replace placeholder postEvent/postExternalEvent/iterator summaries and describe RequiredSubscriptionRuntimeOptions and NormalizedBlackBoxOptions as settings shapes. Accepted and deduplicated.
5. Documentation low severity: document Date versus Timestamp precision at delivery-client sinceWhen input. Accepted.
6. Reliability P2 proposes capturing a separate monotonic source across provider replacement. The proposed runtime change is rejected: provider replacement is internal test support, and the existing contract forbids competing replacement of the shared provider. Reading one duration across different provider origins is outside that contract. Accept an explicit documentation clarification instead: await dependent work before replacing/restoring the provider; readings from different monotonic providers are not comparable. No new clock mechanism is added.

Correction dispatch returns to the original existing implementer context, explicitly configured gpt-6-sol/medium at its initial dispatch. Only this implementer changes production/tests/manifests; parent retains core README/REFERENCE and records. Re-review API and style changes after mechanical checks; documentation changes receive a focused factual recheck. Reopen reliability review only if the correction changes runtime ordering or persistence behavior. Final release verification remains pending.

## Focused re-review dispatch

The accepted corrections and their mechanical preflight are complete; evidence is in the work log. Dispatch three fresh independent existing-role contexts with explicit model and reasoning: typescript_api_docs_reviewer gpt-6-sol/medium, style_maintainability_reviewer gpt-6-sol/medium, documentation_reviewer gpt-6-luna/medium. The API lane checks direct dependency declaration and precise read versus compatible single/batch write types; style checks clock-gate regressions and comment meaning; docs checks corrected summaries, cursor precision and provider lifetime. Each receives only the correction diff from fb616bc60 and its relevant findings. No broad review repetition, edits or child delegation. Verify runtime headers before acceptance.

Reliability re-review is not reopened: the corrected persistence boundary continues the established Date-to-Timestamp normalization, and focused tests verify compatibility and precision. No ordering algorithm, lifetime machinery or provider runtime behavior changes. The rejected capture-source proposal is addressed by the explicit supported provider-lifetime documentation. Final release verification remains pending.

## Focused re-review results

Checkpoint f2d10ab73: all three fresh CLI runtime headers match their explicitly dispatched existing roles and reasoning, with read-only sandboxing and no reported fallback. API Sol/medium session 01a11170-5fd0-7283-add4-6730e1944f92; style Sol/medium session 01a11170-5fd0-7222-a160-8b86a0597bff; documentation Luna/medium session 01a11170-5fd0-7103-a154-c8909bc39961. Reports are in spine-time-evidence/review-*-r2.md.

Style and documentation findings are resolved. API found one remaining P2 compatibility issue: precise InboxMessage read outputs also narrowed legacy Date snapshot inputs to DeliveryClient removal and Inbox delivery/removal operations. Accept the finding. Return a single bounded correction batch to the same existing implementer context (explicit original gpt-6-sol/medium dispatch): restore compatible input contracts, retain Timestamp read outputs, test direct Date inputs, and run the mandatory cheap preflight. Re-review only this API boundary after correction. Other concerns remain accepted because no clock, persistence algorithm, or documentation policy changes are required.

## Final API re-review dispatch

After the compatible snapshot-input correction and clean preflight, dispatch the existing typescript_api_docs_reviewer through a fresh ephemeral CLI context, explicitly gpt-6-sol/medium with Standard speed and read-only access. Review only changes from f2d10ab73 that restore legacy Date mutation inputs and retain Timestamp reads, including directly related tests and declarations. No delegation or edits. Confirm runtime metadata before accepting the result. All other review dispositions remain current.

Final API re-review passes with no remaining actionable finding. Runtime header confirms explicit gpt-6-sol/medium, read-only mode, session 01a1117b-1e2d-7f70-9b67-3734bf9dc55f, with no reported fallback. Report: spine-time-evidence/review-api-r3.md. The compatibility fix is committed and pushed as 7521a0a4c. All scoped review concerns now have accepted dispositions. All collaboration children are completed and all fresh CLI review/helper processes have exited. Full release verification is next.
