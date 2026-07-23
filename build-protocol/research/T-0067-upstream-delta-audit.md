# T-0067 Upstream Delta Audit

Date: 2026-07-23

## Sources compared

| Repository                         | Frozen Wave 1 commit                       | Current audited head                       | Delta      |
| ---------------------------------- | ------------------------------------------ | ------------------------------------------ | ---------- |
| `SpineEventEngine/core-java`       | `a408b0d70dafd603efc55b89c8b4b6f3e8c19d3b` | `026266f15d866464a99386fa891d5c8ec39f854e` | 41 commits |
| `SpineEventEngine/delivery-server` | `21f2901f393e552208b97166f4eaeb942f9f5172` | `21f2901f393e552208b97166f4eaeb942f9f5172` | 0 commits  |

## Classification

The `core-java` delta is confined to shared signal-dispatching entity work,
Process Manager event-journal/recent-event-history work, Aggregate recent
history, and their tests, documentation, and dependencies. These are relevant
to the already approved Wave 2 recent state/event history and high-level
Aggregate/Process Manager query work. Classification: **defer to Wave 2**.
No delta changes the accepted Wave 1 public/runtime semantics.

`delivery-server` has no delta, including in the only Wave 1 in-scope upstream
module, `simple-server`. Classification: **no action**.

No runtime/API/Proto/dependency correction is adopted by T-0067. Wave 3 retains
live TypeScript/JVM operation and compatibility testing; Wave 4 retains human
administration.
