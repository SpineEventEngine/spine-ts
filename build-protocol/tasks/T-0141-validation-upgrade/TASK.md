# T-0141: Validation Package Upgrade

Status: Implementation checkpoint ready for required review on the stacked integration train.

## Objective

Move the existing core validation facade from
`@spine-event-engine/validation-ts@2.0.0-snapshot.4` to the published renamed
`@spine-event-engine/validation@2.0.0-snapshot.7` package without widening or
redesigning framework APIs.

## Classification

Standard. The dependency and import boundary changes, while the framework
facade and validation semantics remain fixed.

## Acceptance

- The exact renamed snapshot is installed from npm; no vendoring or Git
  dependency is introduced.
- Core constraint validation, packed violations, server validation, and focused
  example consumers remain behaviorally compatible.
- Old package imports and dependency entries are absent from runtime/test
  consumers owned by this task.
- Relevant typechecks, focused tests, static checks, specialist review, and one
  focused `verify:task` are recorded.

## Implementation Assignment

- Existing role: project `implementer`.
- Explicit dispatch profile: `gpt-5.6-terra` / `medium`.
- Ownership: dependency manifests/lockfile, validation package imports, focused
  validation compatibility tests, and T-0141 protocol records only.
- The implementer must not migrate examples assigned to T-0142, redesign the
  public validation facade, or spawn subagents.

## Review

- TypeScript/API documentation and performance/reliability are required.
- Documentation applies only if installation prose changes in this task.
- Style is N/A for a manifest/import-only migration unless implementation adds
  substantive code structure. Security is N/A because no trust boundary
  changes.

## Implementation Evidence

- RED-first core boundary mocks proved the old import bypassed the renamed
  package seam; the minimal package/import migration made them pass.
- The packed external-consumer fixture exposed and now stages the published
  validator's declared temporal runtime dependency graph.
- Focused core, server transition-validation, and proto-tools packaging tests
  pass. The separate To-Do black-box suite has inherited projection/subscription
  timeouts and is recorded in the work log without example changes.
