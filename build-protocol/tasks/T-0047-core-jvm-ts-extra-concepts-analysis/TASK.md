# T-0047: Core JVM versus Spine TS extra-concepts analysis

Status: Complete; committed, pushed, and represented on canonical `main`

## Objective

Perform a source-grounded comparison of the fresh `SpineEventEngine/core-jvm`
repository and Spine TS, listing every TS concept/definition without a direct
JVM analogue and classifying it as invention, platform adaptation, or scope
choice. Produce a separate Markdown analysis with evidence paths and explicit
confidence.

## Human-Imposed Requirements Ledger

- Reread and follow `build-protocol/BUILD_PROTOCOL.md`.
- Perform P1 now; do not begin P3/Firestore work.
- Prefer the smallest JVM-familiar concept and identify over-engineered TS
  abstractions for possible simplification.
- Inspect relevant `core-jvm/server` source before shaping conclusions.
- Do not modify the protected `human-review-1-jul.md`.
- Do not change production code in this task.

## Skill applicability

- Applicable session skills: `planning-with-files`, `domain-modeling`,
  `architecture-patterns`, `verification-before-completion`.
- Task-provided skill paths: repository build protocol and this ledger.
- `build-protocol/skills/EXPECTED_SKILLS.md` and reachable installed skill
  entrypoints/lock are to be recorded by the orchestrator before acceptance.
- `architecture-decision-records` is not selected: this task records analysis,
  not an accepted architecture decision.

## Acceptance

- The analysis distinguishes confirmed source mappings from hypotheses.
- It includes package/type/file evidence for TS and JVM sides where available.
- It names candidates for deletion/consolidation without performing them.
- The exact JVM revision or source-access limitation is recorded.
