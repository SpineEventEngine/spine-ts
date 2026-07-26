# T-0073 Review Record

Status: Not started

All four canonical specialist concerns and the final Wave 3 security gate are
required as recorded in the task brief. Assignments, explicit model/reasoning
metadata, findings, dispositions, correction batches, and re-review evidence
will be recorded before results are accepted.

## Slice A specialist assignments

The review scope is the complete uncommitted Slice A diff against `3d815aa0`
and the full human requirements ledger in the T-0073 task.

- Style/maintainability: existing `style_maintainability_reviewer`; expected
  `gpt-5.6-terra` / `high`, both explicit in dispatch. Review module/registry
  depth, schema inventory maintenance, conflict comparison, and simplicity.
- TypeScript/API docs: existing `typescript_api_docs_reviewer`; expected
  `gpt-5.6-terra` / `high`, both explicit in dispatch. Review public exports,
  structural types, declarations, return types, compatibility, and TSDoc.
- Performance/reliability: existing `performance_reliability_reviewer`;
  expected `gpt-5.6-terra` / `high`, both explicit in dispatch. Review
  deterministic traversal/deduplication, cycles/conflicts, retained memory,
  malformed decoding, and complete shipped-schema inventory.
- Documentation completeness: N/A for this slice because it changes no
  end-user prose, README, guide, or example. Public TSDoc and declaration
  accuracy are assigned to the TypeScript/API reviewer. The complete Wave will
  invoke documentation review after Slice D.

The Desktop surface exposes explicit dispatch and immutable configured
role/profile but no independent child self-introspection. This limitation is
recorded before results are accepted. All reviewers are read-only, may not
spawn children, and must return prioritized actionable findings or CLEAN.

## Slice A specialist results

All three invoked roles ran with expected and explicitly dispatched
`gpt-5.6-terra` / `high`. Immutable configured role/profile metadata matches;
independent child self-introspection is unavailable as recorded above.

- TypeScript/API docs: CLEAN.
- Style/maintainability:
  - P1 accepted: `spineProtoModule` and its mirrored test inventory omit
    `spine/time_options.proto`'s message schema.
  - P1 accepted: recursive equivalent-module comparison falsely rejects equal
    graphs when dependency object aliasing differs.
  - P2 accepted: transitive dynamic decoding and deterministic cycle behavior
    need focused tests.
- Performance/reliability:
  - P1 duplicate of missing `TimeOption`; deduplicated into the style finding.
  - P2 accepted: recursive traversal can overflow the JavaScript call stack on
    a deep valid acyclic dependency chain; use an explicit DFS stack.
  - P2 accepted: add dependency-owned dynamic decode, cycle, and nested
    same-name conflict regressions.

One complete correction batch returns to the original Slice A implementer
context. Re-review is required for style/maintainability and
performance/reliability; the clean API lane reopens only if public declarations
change substantively.

## Slice A correction evidence

- The correction owner reproduced all four failing behaviors before the fix.
- The implementation adds the missing `TimeOption` inventory, iterative
  dependency-first DFS, content comparison independent of dependency object
  aliasing, and cycle/transitive/nested/deep-chain regressions.
- Owner GREEN: 55/55 focused tests plus generated/tooling typechecks, focused
  lint, formatting, and whitespace checks.
- Style/maintainability and performance/reliability require bounded re-review.
  TypeScript/API remains closed because no public declaration changed during
  correction.
- Coordinator GREEN: 4 files / 58 tests, Proto generation, generated/tooling
  typechecks, focused ESLint, Prettier, and `git diff --check`.
- Re-review assignments reuse the existing
  `style_maintainability_reviewer` and
  `performance_reliability_reviewer`, each expected and explicitly dispatched
  as `gpt-5.6-terra` / `high`. Scope is limited to the accepted correction
  findings; both are read-only and may not spawn children.

## Slice A closure

- Style/maintainability re-review: CLEAN.
- Performance/reliability re-review: CLEAN; independent focused typecheck and
  53/53 tests passed.
- Re-review roles ran with expected and explicitly dispatched
  `gpt-5.6-terra` / `high`; immutable configured profiles match and separate
  self-introspection remains unavailable.
- TypeScript/API docs remains CLEAN from the original wave.
- Documentation completeness remains the concrete N/A recorded for this
  runtime-only slice.
- All accepted P1/P2 findings are resolved. The source-maintained complete
  Spine inventory is intentionally replaced by deterministic generation in
  Slice B; it is not accepted as the final maintenance model.
- Slice A is accepted for commit and immediate task-branch push.

## Slice B1a specialist assignments

Scope: new `@spine-event-engine/proto-tools` package/bin, version-one
configuration and manifest contracts, deterministic manifest construction,
package identity/dependency checks, relative path/symlink containment, root
project/lockfile integration, and five behavior tests.

- Style/maintainability: existing `style_maintainability_reviewer`, expected
  and explicitly dispatched `gpt-5.6-terra` / `high`; focus on small module
  depth, validation cohesion, names, and avoiding future-slice abstractions.
- TypeScript/API docs: existing `typescript_api_docs_reviewer`, expected and
  explicitly dispatched `gpt-5.6-terra` / `high`; focus on config/manifest
  public types, bin/package exports, declaration correctness, and future npm
  usability.
- Performance/reliability: existing `performance_reliability_reviewer`,
  expected and explicitly dispatched `gpt-5.6-terra` / `high`; focus on path
  containment, symlinks, deterministic discovery/manifest data, filesystem
  failures, and bounded traversal.
- Documentation completeness: N/A for B1a because end-user README/guide/CLI
  documentation is a Slice D deliverable. Public declaration/TSDoc claims are
  assigned to the API lane.

All reviewers are read-only, may not spawn children, and must return CLEAN or
prioritized findings. Explicit dispatch and immutable configured profiles are
available; independent child self-introspection is not.

## Slice B1a specialist results

All invoked roles ran with expected and explicitly dispatched
`gpt-5.6-terra` / `high`; immutable configured profiles match and independent
self-introspection remains unavailable.

- P1 accepted: model and application dependencies must be direct ordinary npm
  dependencies; reject `workspace:`, `file:`, absolute, and other local specs.
- P1 accepted: installed manifest Proto/export paths require symlink-ancestor
  checks, including dangling symlinks.
- P1 accepted: CLI manifest replacement must stage a unique sibling file,
  atomically rename, clean failed staging, and preserve an existing manifest.
- P2 accepted: use iterative Proto discovery with internal bounds and
  package-labelled missing/inaccessible/bound failures.
- P2 accepted: split duplicate ownership and unsafe generated-export tests so
  each validation executes.
- P2 accepted: document all public config/manifest fields and path/subpath
  semantics; include the package in TypeDoc and the API export inventory.

Duplicate dependency findings from all three lanes are one correction. One
complete batch returns to the existing B1a owner. Style, API, and reliability
re-review are required because all three concerns change substantively.

## Slice B1a correction and re-review

- Corrections implement ordinary direct dependency checks in both modes,
  installed-manifest real/dangling symlink containment, atomic staged manifest
  replacement, iterative bounded discovery, independent validation fixtures,
  semantic public TSDoc, TypeDoc entrypoint coverage, and exact API inventory.
- Coordinator GREEN: 10/10 tests, both typecheck layers, focused ESLint,
  Prettier, TypeDoc/API checks, and whitespace checks.
- Re-review assignments reuse the existing style/maintainability,
  TypeScript/API docs, and performance/reliability roles. Each is expected and
  explicitly dispatched `gpt-5.6-terra` / `high`, read-only, limited to the
  accepted finding batch, and may not spawn children.

## Slice B1a re-review findings

- P1 accepted unanimously: registry dependency validation still permits
  `link:`, `portal:`, git, tarball URL, and related non-registry specs.
- P2 accepted: atomic-write coverage must assert successful replacement,
  staging removal after write/rename failure, and prior-manifest preservation
  after rename failure.
- P2 accepted: add direct 10,001-file and inaccessible-root regressions.
- All installed-manifest containment, independent export validation,
  package/bin declarations, TSDoc, TypeDoc, and API inventory corrections are
  otherwise clean.
- One final targeted batch goes to a fresh existing `implementer`. Only
  style/maintainability and performance/reliability re-review after behavior
  corrections; API re-review is needed only if public declarations change.

## Slice B1a final correction

- Registry dependency specs now use a registry-only allowlist for ordinary
  versions/ranges/tags and npm aliases while rejecting all tested local,
  workspace, link, portal, git, URL/tarball, and shorthand sources in both
  modes.
- Atomic tests assert success staging/rename, write-failure cleanup and
  preservation, and rename-failure cleanup and preservation.
- Direct inaccessible-root and 10,001-file regressions are present.
- Coordinator GREEN: 14/14 tests, both typecheck layers, focused ESLint,
  Prettier, TypeDoc/API inventory, and whitespace checks.
- Final bounded re-review assigns the existing style/maintainability and
  performance/reliability roles, each expected and explicitly dispatched
  `gpt-5.6-terra` / `high`. API remains closed because no public declaration
  changed.
- Final re-review result: registry allowlisting, inaccessible-root handling,
  and the 10,001-file bound are CLEAN. One P2 test-evidence gap remains:
  atomic failure mocks record removal without physically removing staged
  files; the write-failure case creates no partial stage; success does not
  replace an existing target.
- A fresh existing `implementer`, expected and explicitly dispatched
  `gpt-5.6-terra` / `medium`, owns only real-filesystem atomic-test correction.
  No production/public change is authorized.
- Test-only correction now proves actual staged-file removal and existing
  target replacement/preservation on the real filesystem. Coordinator GREEN
  is 14/14 tests plus both typecheck layers, focused lint/format,
  TypeDoc/API, and whitespace checks.
- This deterministic fixture correction resolves the sole remaining P2 and
  does not reopen a specialist lane under the review protocol.
- Slice B1a is converged: no P0/P1 remains, every accepted P2 is resolved,
  style/maintainability, TypeScript/API, and performance/reliability concerns
  are clean after correction, and documentation has the recorded N/A
  disposition.
- Slice B1a is accepted for commit and immediate task-branch push.

## Slice B1b specialist assignments

Scope: internal installed-model dependency graph resolution, requester-relative
manifest/package resolution, deterministic dependency-first order, canonical
Proto ownership, identity/direct-registry-dependency validation, cycle and
duplicate-root/ownership failures, and bounded iterative traversal.

- Style/maintainability: existing `style_maintainability_reviewer`, expected
  and explicitly dispatched `gpt-5.6-terra` / `high`; focus on graph cohesion,
  duplicated policy, names, diagnostic clarity, and avoiding premature B2
  abstractions.
- Performance/reliability: existing `performance_reliability_reviewer`,
  expected and explicitly dispatched `gpt-5.6-terra` / `high`; focus on
  requester-relative Node resolution, nested/hoisted dependency graphs,
  deterministic ordering, cycles, identity conflicts, ownership, traversal
  bounds, and the disposition of a direct 10,001-package fixture.
- TypeScript/API docs: N/A because `model-graph.ts` is an internal module not
  exported by the package map; its declarations are not an end-user contract.
- Documentation completeness: N/A because B1b changes no guide, README,
  example, or end-user claim. Complete tooling documentation remains Slice D.

Both reviewers are read-only, may not spawn children, and must return CLEAN or
prioritized actionable findings. Explicit dispatch and immutable configured
profiles are available; independent child self-introspection is not.

## Slice B1b specialist results

Both invoked roles ran with expected and explicitly dispatched
`gpt-5.6-terra` / `high`; immutable configured profiles match and independent
self-introspection is unavailable.

- P1 accepted: graph resolution assumes the exported manifest target is at the
  package root. A valid export to `dist/spine-proto-manifest.json` therefore
  looks for `dist/package.json`; locate package metadata independently and read
  the resolved manifest target.
- P1 accepted: a requester's declared dependency range is syntax-checked but
  never compared with the installed model package version. Reject
  deterministically incompatible semver ranges with requester/dependency
  evidence.
- P1 accepted: the package counter bounds distinct completed nodes, not direct
  input allocation or scheduled dependency edges. Bound roots and traversed
  edges before allocation/scheduling so dense valid graphs cannot consume
  unbounded work or queue memory.
- P2 accepted: add a requester-relative hoisted dependency fixture.
- The two reviewers' graph-bound findings are deduplicated into the P1
  bounded-work correction. Prove the admission/edge limit through a narrow,
  non-pathological fixture rather than 10,001 installed package trees.

Registry-policy cohesion, iterative traversal, nested resolution, cycles,
identity/root and Proto-ownership conflicts, and deterministic output are
otherwise clean. One complete correction batch returns to the existing B1b
implementation context; both invoked lanes require bounded re-review.

## Slice B1b correction and re-review

- Correction resolves non-root manifest exports through bounded package-root
  discovery and an internal exact-manifest seam while retaining the public
  one-argument `readManifest()` declaration.
- Installed dependency compatibility uses maintained `semver` behavior for
  evaluable registry ranges; mutable npm tags remain locally indeterminate.
- Direct root inputs are rejected before traversal allocation and scheduled
  dependency edges have an independent 10,000-item bound. Hoisted resolution
  is covered.
- Coordinator GREEN: 20/20 focused tests, both typecheck layers, focused
  ESLint, Prettier, TypeDoc/API inventory, and whitespace checks.
- Bounded re-review reuses the existing style/maintainability and
  performance/reliability roles, each expected and explicitly dispatched
  `gpt-5.6-terra` / `high`. Both are read-only and may not spawn children.

## Slice B1b re-review findings

- P1 accepted: installed manifest dependencies are cloned/sorted before the
  scheduled-work budget is checked. Reject an oversized dependency array
  before cloning/sorting, compare the whole list against remaining capacity,
  and prove the limit with one package manifest rather than package trees.
- P1 accepted: package-root discovery stops at the first ancestor
  `package.json`; it must continue until package identity matches, allowing a
  nested `dist/package.json`.
- P1 accepted: a failed `semver.validRange()` is treated as a mutable tag, so
  malformed range-like registry strings can bypass compatibility checks.
  Distinguish the already-supported valid tag grammar from invalid ranges,
  including npm aliases.
- P2 accepted: add graph regressions for zero-major caret, comparator ranges,
  npm alias range extraction, and explicit mutable-tag acceptance.

The non-root export and hoisted-resolution behavior, public one-argument
manifest declaration, maintained semver dependency split, and direct-root
admission are otherwise clean. One final aggregated batch returns to the same
B1b owner; both reviewer lanes reopen only for these findings.

## Slice B1b final correction evidence

- Raw manifest dependency admission now precedes list normalization; graph
  scheduled-work capacity is compared for the whole list before sorting and
  enqueueing.
- Package-root discovery skips nested metadata whose package identity does not
  match the requested package.
- Maintained semver validation distinguishes evaluable ranges, valid mutable
  tags, malformed ordinary ranges, and npm-alias ranges.
- Focused regressions cover raw 10,001 dependencies, one root plus 10,000
  scheduled dependencies, nested `dist/package.json`, zero-major caret,
  comparator ranges, npm aliases, tags, and malformed ordinary/alias ranges.
- Coordinator GREEN: 24/24 tests, both typecheck layers, focused ESLint,
  Prettier, and whitespace checks.
- Final bounded re-review reuses both existing reviewer roles with their
  originally explicit `gpt-5.6-terra` / `high` profiles.

## Slice B1b closure

- Style/maintainability final re-review: CLEAN.
- Performance/reliability final re-review: CLEAN; four targeted tests passed
  independently.
- Both roles retained their expected and originally explicit
  `gpt-5.6-terra` / `high` profiles. Immutable configured metadata matches;
  independent self-introspection remains unavailable.
- TypeScript/API and documentation retain their concrete N/A dispositions for
  this internal, prose-free slice.
- All accepted P1/P2 findings are resolved. Slice B1b is accepted for commit
  and immediate task-branch push.
