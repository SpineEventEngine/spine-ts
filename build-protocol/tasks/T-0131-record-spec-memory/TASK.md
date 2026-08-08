# T-0131: JVM-Style RecordSpec And In-Memory Storage

Status: Reviewed; integration-train checkpoint ready

## Objective

Replaces storage-key and fingerprint identity with the source type, ID type,
record type, ID extraction, and columns that define a JVM-style record
specification. Migrates the generic in-memory provider without changing its
isolation, query, compare-and-set, or batch semantics.

## Classification

High-risk because this task changes a public generic storage contract and the
physical identity used by the in-memory provider.

## Baseline And Ownership

- Baseline: `origin/main@242a98c3`.
- Branch: `task/T-0131-record-spec-memory`.
- Worktree: `.worktrees/T-0131-record-spec-memory`.
- Production ownership: `packages/storage/src/{record,storage,memory,query}/**`
  plus the direct `packages/storage/src/event/event-store.ts` consumer.
- Test ownership: mirrored storage tests plus public compile-contract tests and
  the storage README/REFERENCE only when their public claims change.

## Acceptance

1. `RecordSpec<I, R>` takes exactly one object with `recordType`, `extractId`,
   exactly one of message `idSchema` or non-blank primitive `idKind`, optional
   `columns`, and optional `sourceType` defaulting to `recordType`.
2. Read-only `sourceType`, `idType`, `recordType`, and `columns` accessors expose
   the specification. Old `schema`, `storageKey`, and
   `compatibilityFingerprint` inputs/accessors disappear without aliases.
3. Two Entity source types using the same `EntityRecord` schema remain
   physically distinct. Ordinary records default source type to record type.
4. Column materialization, context and tenant isolation, queries,
   compare-and-set, and batch behavior remain correct.
5. Compatibility fingerprints, spec metadata, and compatibility-oriented
   canonical layout machinery are removed without a replacement hash or
   persisted descriptor.
6. Public compile-time tests, concise TSDoc, and storage REFERENCE prose freeze
   the intended surface.

## Implementation Assignment

- Owner: existing implementer role.
- Expected profile: `gpt-5.6-terra` / `medium`, explicitly selected in the
  dispatch through the immutable implementer role configuration supported by
  the desktop surface.
- Required method: RED-first focused behavior and public-contract tests,
  followed by the minimum implementation and relevant regression tests.
- The owner must not spawn subagents, commit, push, merge, alter unrelated
  providers/consumers, build JVM code, or access the migration remote.

## Review And Verification

- Style/maintainability: required.
- TypeScript/API documentation: required.
- Performance/reliability: required for isolation and atomic behavior.
- Documentation: narrow review only if package prose changes; otherwise N/A
  with the concrete unchanged-claim reason.
- Run deterministic preflight, one complete review wave, one correction batch,
  and focused package coverage before commit.

## Integration Sequencing

The shared task profile reaches TypeScript build and then fails on the direct
legacy consumers assigned to T-0132 through T-0142. T-0131 must not add aliases
or merge a broken public change to `main`. After focused verification and
review, its pushed commit becomes the immutable base of the Wave 8 integration
train. Each dependent task removes its owned failures. T-0142 must restore the
green repository task profile before the train merges to `main`.

## Acceptance Evidence

- Seven focused suites pass 114 tests with 96.73% statements and 93.83%
  branches over the changed storage paths.
- Storage package typecheck, declaration compile contract, changed-file ESLint,
  Prettier, and diff whitespace checks pass.
- Style/maintainability, TypeScript/API, performance/reliability, and
  documentation reviews are clean after one combined correction batch.
- The shared build failure inventory contains only direct legacy consumers
  assigned to later tasks in the integration train; no compatibility alias is
  present and `main` remains green.
