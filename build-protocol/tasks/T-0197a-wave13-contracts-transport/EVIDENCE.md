# T-0197a evidence

- JVM core-jvm SHA: 0779b5fa42ca5cebd0d2935fc3a3489ab47846dc.
- broker.proto SHA-256: 76a3b965391d989d32a1a6dbc84a4465d2f8f2386be7ed266fd201483dc9865d.
- transport.proto SHA-256: 92df339007d7dda01a6df5b87c38d988bfedebabd6ac28eb7fbb874bcd5f73bd.
- event.proto SHA-256 retained: 0c385d3fd98d68d35ce1d7887bd564b590daba47b959b99d205c2be56a737d29.
- Proto generation verified 46 pinned sources and 50 generated Proto modules and descriptor digest 0844be5a0c588717932dc09da4d3fdc62c945a4f82be9bbb4e4d3d4814e42c3b.

## Correction evidence

- Focused Proto index/module plus memory tests: 14 assertions passed.
- Memory adapter suite: 4 tests passed.
- TypeScript generated build passed before the correction test additions; final full build is pending the parent integration cycle.

## Final correction review record

- TypeScript/API reviewer assignment: existing specialist reviewer, gpt-5.6-terra / high; no child spawning; runtime telemetry unavailable. Finding batch addressed: factory declaration surface, copy-safe IDs, and close/failure semantics.
- Performance/reliability reviewer assignment: existing specialist reviewer, gpt-5.6-terra / high; no child spawning; runtime telemetry unavailable. Finding batch addressed: serial publisher ordering, close races, drain, and aggregate errors.

- TypeScript/API re-review: PASS-with-P2-corrected. Public channel and factory close documentation now explicitly states idempotent, shared racing completion.
