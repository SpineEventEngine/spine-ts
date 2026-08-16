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

## Consolidated correction batch

The follow-up review found that the initial checkpoint had not advanced the
writer/discovery contract atomically and selected domestic dispatchers too
broadly. The correction advances writer and discovery to v3, migrates affected
fixtures to explicit domestic origin, snapshots dispatcher schema methods once,
and indexes domestic complements separately from external subsets. A private
dispatcher-origin companion keeps a generated repository's mixed same-type
handlers visible to both paths without exposing another registration API.

Repository event, command-reaction, and state-subscription candidates now filter
on `EventContext.external`. State has no external wire; the change only prevents
domestic `EntityStateChanged` updates from reaching an external state receptor.
External command validation now depends on the inferred input signal kind, so
both `@Assign External<Command>` and command-input `@Command` fail while event
and rejection command handlers remain valid.

## Specialist review dispositions

- Performance/reliability reviewer: existing reviewer role, configured
  `gpt-5.6-terra` / `high`, no child spawning, runtime telemetry unavailable.
  Accepted correction: schema snapshots are taken once; domestic/external
  indexes and state candidates filter at the existing routing boundary.
- TypeScript/API documentation reviewer: existing reviewer role, configured
  `gpt-5.6-terra` / `high`, no child spawning, runtime telemetry unavailable.
  Accepted correction: v3 origin is required, the marker remains type-only,
  and canonical identity uses the analyzer package's own declaration directory.
