# Round 24 Fix Report

Status: implemented and verified.

Commit: see final handoff for the commit SHA.

## Summary

- Rejected malformed and non-canonical stored signal `valueBase64` payloads in
  stored inbox rows and pending dedup guards.
- Rejected oversized serialized inbox, dedup, and shard-session `Any.value`
  records before UTF-8 conversion and JSON parsing.
- Preserved pending dedup guards after the inbox row is durable so recovery can
  finalize the canonical row after dedup finalization errors.
- Prepared round-25 review package placeholder:
  `.superpowers/sdd/review-round-25-fce80b2-current.diff`.

## Tests Run

- `pnpm test packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`
  passed with 38 tests.
- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm format:check` passed.
- `git diff --check` passed.
- Touched-file 120-character line-length scan passed with no output.

## Concerns

- No product/code concerns known.
