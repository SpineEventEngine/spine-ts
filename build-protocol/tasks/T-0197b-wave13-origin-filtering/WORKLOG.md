# T-0197b — Generated external-origin metadata and filtering

## Assignment

- Existing role: implementer.
- Configured profile: `gpt-5.6-terra` / `medium` (explicit dispatch).
- Runtime telemetry: unavailable on the selected execution surface; no visible
  fallback was exposed.
- Child spawning: prohibited.
- Baseline: `origin/main` `aaff3b4c`.

## Implementation record

The generated handler registry advances atomically from v2 to v3. Every
generated handler record has required `origin: "domestic" | "external"`; the
ingestor validates it and rejects external command assignees. Canonical handler
metadata carries immutable origin, with the legacy explicit-builder boundary
defaulting to domestic.

`External<T>` is a transparent type-only server export. The build-time analyzer
accepts it only as a direct first parameter marker imported from the canonical
server package, unwraps it for schema discovery, and emits deterministic origin
metadata. Nested, later-parameter, malformed, or untrusted uses receive
`INVALID_EXTERNAL_ORIGIN`; `@Assign External<Command>` receives
`EXTERNAL_COMMAND_RECEIVER`.

The EventBus registry selects external schemas for imported events, while
repository routing makes the final mixed-origin selection per handler so two
handlers for the same event type do not leak across origins.

## Verification status

Formatting and `git diff --check` are clean. The isolated worktree had no
installed workspace links. A temporary node_modules link permitted static
diagnosis, which found no errors attributable to these edits; workspace package
resolution remains stale and prevents a representative Vitest run from loading
`@spine-event-engine/validation-ts`. This is an environment-link limitation,
not a green test result. The orchestrator must run the focused suite after the
integrated worktree's dependency links are refreshed.

## Compatibility handoff

The frozen v3 decision deliberately rejects v2 generated registries. Existing
test fixtures still declaring `version: 2` must be migrated atomically with
their handler records gaining explicit domestic origin; accepting v2 would
create the forbidden dual-version compatibility policy.
