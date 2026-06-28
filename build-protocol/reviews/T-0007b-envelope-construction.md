# Review Log: T-0007b Core Envelope Construction Helpers

Task log: `build-protocol/tasks/T-0007b-envelope-construction/TASK.md`
Work log: `build-protocol/work-logs/T-0007b.md`
Branch: `task/T-0007b-envelope-construction`
Setup baseline commit: `c313086`
Implementation baseline commit: `57fc257`
Round-1 reviewed commit/diff basis:
`7d80347...2fe6850be59a78e6331b0b8cd84fa8fb0641b281`
Implementation commit: `2fe6850be59a78e6331b0b8cd84fa8fb0641b281`
Current branch tip before focused fix: `dfdf21e`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0007b-envelope-construction`
Reviewer sub-agents: Maintainability/style `019f0fcc-6b78-71a3-a363-688a5be1d662`;
documentation `019f0fcc-a511-78b0-a79a-eb2f4740ab52`; TypeScript/API docs
`019f0fcc-d16b-7c31-8a02-81a07c880947`; security
`019f0fcc-fa19-7632-9b24-e2f678ad60c6`; performance/reliability
`019f0fcd-2d90-7481-963d-7571d880095d`.
Status: Round 1 findings under focused fix; re-review pending
Implementation sub-agent: `019f0fc3-b699-76c2-a02f-a174936c045d` (Bacon)

## Reviewer IDs

- Maintainability/style: `019f0fcc-6b78-71a3-a363-688a5be1d662`
- Documentation: `019f0fcc-a511-78b0-a79a-eb2f4740ab52`
- TypeScript/API docs: `019f0fcc-d16b-7c31-8a02-81a07c880947`
- Security: `019f0fcc-fa19-7632-9b24-e2f678ad60c6`
- Performance/reliability: `019f0fcd-2d90-7481-963d-7571d880095d`

## Round 1

Dispatched on `2026-06-28 20:55 WEST`.

Required reviewer roles:

- maintainability/style;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

Findings being addressed:

- Stale durable process logs must name implementation commit
  `2fe6850be59a78e6331b0b8cd84fa8fb0641b281`, the round-1 review basis, and
  this focused fix state without closing round 1.
- `docs/api/README.md` must mention new envelope helper functions and input
  option types.
- Tests should use the public `packAny()` helper instead of hand-building test
  `Any` values with duplicated type URL and binary policy.
- `packAny()` should avoid retaining unknown fields by default for stable
  framework packing; full map-order canonicalization remains unclaimed unless
  separately tested.
- `unpackAny()` should return `undefined` on malformed bytes with a matching
  type URL.
- `packCommand()` and `packEvent()` should snapshot caller-supplied generated
  IDs and contexts before embedding them in envelopes.

## Verification Evidence

Round-1 focused fix evidence:

- RED: `corepack pnpm test packages/core/src/index.test.ts` failed on
  `2026-06-28 21:01 WEST` with 4 expected failures: retained unknown fields,
  malformed matching `Any` bytes throwing `RangeError: premature EOF`, and
  command/event envelopes reflecting later caller mutations to IDs/contexts.
- Focused GREEN: `corepack pnpm test packages/core/src/index.test.ts` passed on
  `2026-06-28 21:02 WEST` with 26 tests.
- Focused typecheck: `corepack pnpm typecheck` passed on
  `2026-06-28 21:03 WEST`.
- API docs: `node scripts/check-api-docs.mjs` passed on
  `2026-06-28 21:03 WEST`, with the known TypeDoc invalid `origin` warning and
  85 proto / 28 core expected exports.
- Full verification: `CI=true corepack pnpm verify` passed on
  `2026-06-28 21:03 WEST`; 9 test files / 41 tests, coverage 99.44%
  statements, 91.83% branches, 100% functions, 99.44% lines, docs/API check,
  proto lint/generate, and generated-output cleanliness all passed.

Original implementation evidence:

- RED: `corepack pnpm test packages/core/src/index.test.ts` failed on
  `2026-06-28 20:48 WEST` with 4 expected failures because `packAny`,
  `unpackAny`, `packCommand`, and `packEvent` did not exist yet; 20 existing
  tests passed.
- Focused GREEN: `corepack pnpm test packages/core/src/index.test.ts` passed on
  `2026-06-28 20:49 WEST` with 24 tests.
- Focused typecheck: `corepack pnpm typecheck` passed on
  `2026-06-28 20:49 WEST`.
- API docs: `node scripts/check-api-docs.mjs` passed on
  `2026-06-28 20:50 WEST`, with the known TypeDoc invalid `origin` warning and
  85 proto / 28 core expected exports.
- Full verification: `CI=true corepack pnpm verify` passed on
  `2026-06-28 20:51 WEST`; 9 test files / 39 tests, coverage 99.44%
  statements, 91.83% branches, 100% functions, 99.44% lines, docs/API check,
  proto lint/generate, and generated-output cleanliness all passed.

## Closure

Round 1 is not closed. The focused fix will be committed and then the
orchestrator must re-run the required reviewer roles.
