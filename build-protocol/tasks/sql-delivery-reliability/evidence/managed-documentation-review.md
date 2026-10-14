# Managed shutdown documentation review

Existing documentation_reviewer, explicitly dispatched gpt-6-luna / medium.
Read-only; no edits, tests or builds. Runtime introspection unavailable.
Parent persists returned review.

- P2: packages/server/REFERENCE.md:729 and docs/api/README.md:87 describe the
  managed deadline without connecting it to each context's separate configured
  shutdown deadline (default5seconds), which starts when context close begins.
  The earlier applicable deadline may end graceful work first. Link/explain the
  separate timer semantics in the managed section.
- P2: reference says termination/reaping may add3seconds after managed expiry.
  Successful graceful child close may add up to3seconds; after managed expiry
  the initial graceful-exit wait is skipped and TERM/KILL/reaping add at most
 2seconds. Describe the two phases separately.

No affected example or link correction identified in this narrow concern.
