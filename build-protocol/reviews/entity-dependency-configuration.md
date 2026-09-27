# Entity dependency configuration review

Status: awaiting implementation preflight; no implementation approval yet.
Branch: `entity-dependency-configuration`.
Base: `794bd524b8875f10a75777a41bbebe1dbece600b`.

## Requirements and scope

Review against the accepted requirements in the
[plan](../planning/entity-dependency-configuration.md) and current evidence in
the [work log](../work-logs/entity-dependency-configuration.md).
The new callback supplies constructor dependencies to fresh and restored
Entities, without changing stored messages, framework context bindings, or
existing constructor/schema restrictions. Existing one-options constructors
remain valid. The Projects example and public documentation teach the same API.

The publication tag choice is pending human clarification. Do not treat the
unimplemented publication amendment as a completed behavior.

## Independent assignments

Each reviewer receives fresh context, no conversation history or memory, the
requirement paths, the base commit, and a distinct scope. Reviews are read-only;
reviewers do not run builds or tests, change files, or dispatch children.
All model and reasoning fields will be explicit. The surface does not expose
separate runtime self-inspection; the immutable dispatch configuration is the
profile evidence absent a visible mismatch.

| Existing role                    | Model      | Reasoning | Scope                                                                                                                     | Disposition |
| -------------------------------- | ---------- | --------- | ------------------------------------------------------------------------------------------------------------------------- | ----------- |
| style_maintainability_reviewer   | gpt-6-sol  | medium    | Changed construction helpers, callback storage, registration types, example code, maintainability                         | Pending     |
| typescript_api_docs_reviewer     | gpt-6-sol  | medium    | Required/optional factories, ID/schema/result inference, generated registration, declaration output, TSDoc                | Pending     |
| performance_reliability_reviewer | gpt-6-sol  | medium    | Creation/restoration/rebuild, error ordering, framework bindings, independent contexts, persistence and resource lifetime | Pending     |
| documentation_reviewer           | gpt-6-luna | medium    | Changed public guides, example instructions and claims, explanatory clarity, current contract                             | Pending     |

Security review is not a separate task-level requirement: this feature changes
neither authorization nor credential handling. Reassess if the publication
choice introduces either; no such change is approved or planned.

## Findings and corrections

Pending. Collect the full wave before assigning one correction batch to the
existing implementer. Re-review only substantively affected concerns. The
final release checks remain required after convergence.
