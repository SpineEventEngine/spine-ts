# Prose inventory review

Reviewer assignment: senior documentation completeness review, explicitly configured `gpt-6-luna` / `medium`; runtime introspection unavailable. Scope limited to the twelve specified changed documentation files, the accepted correction inventory / example plan, and source facts needed to validate changed claims. No files were edited except this review record; no build, test, or service was run.

## Confirmed finding

- **Recovery timer configurability is only partially documented.** In `packages/delivery-server/REFERENCE.md` under “Recovery timers” (lines 52–56), the prose identifies `recoveryMs` as an override for the 10-second scan and identifies the server processing-timeout options, but describes the stale-session threshold and SQL shard registry lease only as defaults. Both have explicit configurable options in source: `DeliverySupervisorOptions.staleMs` (default 60,000 ms) and `ShardedWorkRegistryOptions.leaseMs` (default 30,000 ms). Since this section is the canonical explanation linked by the changed guides, readers may mistake those two values for fixed thresholds. Name the corresponding options alongside the defaults. Sources: `packages/server/src/delivery/delivery-supervisor.ts` constructor and options; `packages/server/src/delivery/sharded-work-registry.ts` constructor and options.

## Checked claims and links

- The docs distinguish the 10-second supervisor scan, 60-second stale-session threshold, 30-second SQL lease, and in-memory server processing timeout; the server processing timeout is configurable and defaults to zero/disabled. Source defaults and option names match the docs.
- The deduplication text correctly describes the process-local bounded cache, the temporary delivered-row/cache suppression window, and the fact that SQL cleanup alone need not permit replay. It does not claim exactly-once execution.
- The Delivery restart text correctly distinguishes volatile accepted Inbox work from separately persisted business state. This reflects the expected tested failure boundary; no stronger provider-wide claim is added here.
- The multi-process recommendation preserves local/single-process exceptions and acknowledges database-only local notifications. The changed distributed example accurately describes its two managed nodes, two replicas per node, two Delivery shards per node, one fixed Gateway, and process-local browser bindings, matching its Compose configuration.
- Gateway reconnect/query recovery is distinguished from lost Delivery Inbox work. Changed relative links to the Delivery server reference and example topology resolve from their documented locations.
- `git diff --check` reported no whitespace errors in the scoped documentation diff.

No other concrete omission or contradiction was confirmed in this scoped pass. This is not final whole-task documentation acceptance; launcher and transport verification remain pending as directed.
