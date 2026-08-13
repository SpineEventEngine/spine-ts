# T-0181: Generate Interfaces And Immutable Runtime Tokens

Status: In implementation

## Classification And Isolation

- Classification: high-risk public/generated contract. This task introduces a
  public runtime token and changes shared staged Proto generation/public exports.
- Baseline: `origin/main@85c8ae00`.
- Branch: `task/T-0181-message-interfaces`.
- Worktree: `.worktrees/T-0181-message-interfaces`.
- Selected expensive profile: one converged `pnpm verify:release` after cheap
  preflight because core, Proto tooling, generation, and packed consumers change.

## Human-Imposed Requirements Ledger

1. Export `MessageInterface<TInterface, Schemas>` and
   `MessageInterfaces.define()` with the approved non-empty
   `InterfaceSchemas = readonly [MessageSchema, ...MessageSchema[]]` shape.
   Members derive from `MessageShape<Schemas[number]>`; `define` conditionally
   requires every member to satisfy the declared interface.
2. The supported factory validates dynamic inputs, copies/deduplicates/freezes
   membership, and uses private `WeakSet` factory-instance identity. `is()` must
   reject spread, `Object.assign`, prototype-cloned, serialized, and structural
   lookalike tokens. The factory is not a source-provenance security boundary.
3. After Buf and before one atomic staged publication, generate an interface
   and same-named immutable token under `generated/interfaces/` for each
   `(every_is).generate = true`, including eligible nested messages. Accumulate
   file and message declarations and ignore JVM-only options.
4. Reject empty/invalid names, duplicate outputs, JVM-only conflicts, and
   irreconcilable declarations before publication. Preserve previous output on
   failure and deterministic output on repeat generation.
5. T-0181 alone owns the post-Buf orchestration, staged writer, source-view
   redirect, generated imports/exports, and publication transaction. All output
   follows T-0179 generated provenance/no-copyright policy.
6. A packed external consumer imports one generated identifier in both type and
   value positions. Runtime, compile-fail, determinism, rollback, nested, and
   generated declaration tests are required; changed production branches target
   at least 90% coverage.
7. Do not implement authored interface discovery/conformance (T-0182), routing
   overloads (T-0183), To-Do domain changes (T-0184), broad reader docs
   (T-0185), semantic tags, `routeSemantic()`, `@Route`, or Wave 12 behavior.
8. Use behavior-focused TDD; push each coherent checkpoint only to `origin`.

## Implementation Assignment

- Existing role: `implementer`.
- Explicit expected profile: `gpt-5.6-terra` / medium.
- Dispatch and scope: explicit profile, sole writer for assigned files, no
  subagents, preserve unrelated work, TDD, immediate origin pushes.
- Runtime metadata: this surface exposes no independently queryable model or
  reasoning telemetry; immutable configured role/profile and explicit dispatch
  are the available evidence unless a visible mismatch occurs.

## Review Dispositions

- Documentation completeness, TypeScript/API docs, style/maintainability, and
  performance/reliability are relevant to generated public tokens, TSDoc,
  deterministic staged publication, and the source-view seam.
- Security: N/A unless implementation changes a trust boundary; final Wave 11
  security review remains T-0186.

## Checkpoints

- Core token RED/GREEN: focused test first failed for the absent public export,
  then passed after implementation. The test proves copied/deduplicated/frozen
  membership and rejects spread, `Object.assign`, prototype, serialized, and
  hand-built lookalikes through factory-instance identity.
- Post-Buf checkpoint: file-level generated-interface plugin is wired into the
  single existing staged Buf output transaction. It validates generated names,
  includes nested messages, and is normalized under the shared provenance policy.
  Fixture coverage for options/rollback and source-view behavior remains pending.
- Staged publication: T-0181 uses the existing sole staged-generation and atomic
  manifest/tree publication transaction. Focused fault-injection evidence now
  covers every generation-to-publication boundary and prior-output preservation.
- Lint/preflight correction: preserved the compile-fail generic assertions while
  replacing lint-invalid test-only forms, documented the public provider seam,
  and recorded required exact standalone-function necessity dispositions.
  Focused suites (4 files, 162 tests), ESLint, cleanup, TSDoc, formatting, and
  diff integrity pass. Release verification remains intentionally unrun at this
  checkpoint.
- Clean-bootstrap correction: isolated real model generation now proves the
  compiled bootstrap contains and runs the interface plugin without a normal
  Proto Tools `dist` cache. The plugin obtains custom option descriptors from
  the Buf schema request; 64 workflow tests, 74 focused tests, real generation,
  and generated-current verification pass. Release remains intentionally
  unrun at this checkpoint.
- Packed external correction: a reduced consumer schema can omit option
  descriptors, so the plugin uses its installed public Proto package only as a
  fallback after schema-first lookup. The packaged external regression passes;
  release remains unrun.
- Release-preflight correction: repository-wide ESLint exposed and removed one
  unused workflow-test fixture parameter; focused workflow and static cheap
  gates pass. Release remains unrun after this mechanical correction.

## Skills

- Selected and fully read: `implement`, `test-driven-development`,
  `typescript-advanced-types`, and `verification-before-completion`.
- `using-git-worktrees` is not selected because the orchestrator already
  supplied this assigned isolated worktree. No agent-delegation skill applies.
