# Entity and handler declarations: reviews

Status: implementation complete; pre-review checks and consumer corrections in
progress. No review result yet.

Each of three rounds must use fresh reviewers with no inherited history and no
saved memory. Review the full branch changeset against the human requirements
in [the plan](../planning/entity-and-handler-declarations.md). Finish corrections
and their focused checks before starting the next round.

## Required concerns

- Code style and maintainability: pending.
- Documentation completeness: pending.
- TypeScript and public API: pending.
- Performance and reliability: pending.

All four concerns apply: runtime behavior and persistence, public declarations
and generated metadata, substantial source structure, and public documentation
are changed. Final security review is not a separate task review: the protocol
reserves that role for project release-readiness or an explicit security request.
This task changes no authentication, authorization, credential or network boundary.

## Review execution

The desktop refused another child because its thread limit was reached. The
app's installed CLI supports the required explicit profiles, so each specialist
review may run in a new ephemeral CLI session. Memory use and generation are
disabled, as is child spawning. Reviewers receive current requirements and the
fixed diff, not implementation history or previous review conclusions.

Expected profiles: existing style/maintainability, TypeScript/API, and
performance/reliability roles use explicit `gpt-6-sol` / `medium`; the existing
documentation role uses explicit `gpt-6-luna` / `medium`. Read-only reviews run
at standard speed. Up to three independent concerns run in parallel; any fourth
waits for capacity. Each round collects all results before corrections begin.

## Rounds

1. Pending.
2. Pending; starts only after round 1 corrections.
3. Pending; starts only after round 2 corrections.

Record reviewer identity, explicit model/reasoning, checked commit, findings,
decisions, correction evidence, and completion here at each round boundary.

## Pre-review checks

Fresh Proto generation and the production build passed. The tooling and
documentation typechecks exposed missed three-parameter Entity declarations
in black-box tests and an API example; these are being migrated before review.
Generator source fixtures are included in that scan. The complete ESLint scan
also identified eleven local callback/import/test typing corrections.
These are deterministic findings, not an independent review round.

The API documentation, audience, cleanup, TSDoc, Proto lint, generated-output,
copyright, logging and production-dependency checks passed. The earlier cleanup
failure was a check running during generation; rerunning after generation passed.
