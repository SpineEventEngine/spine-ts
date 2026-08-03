# T-0086 Review Record

Status: Converged

## Canonical Concerns

- Style/maintainability: required for the example rename, component structure,
  and domain/UI ownership.
- Documentation: required for renamed example READMEs and UI behavior.
- TypeScript/API docs: required for authored Proto contracts, validation
  snippets, and generated API use.
- Performance/reliability: required for ordering, relative-time updates,
  subscription refresh, validation error propagation, and browser resources.

## Wave 1 Dispatches

- Existing role: `style_maintainability_reviewer`.
  Scope: milestone diff and affected example/client structure, naming,
  simplicity, component ownership, and test maintainability.
  Expected model: `gpt-5.6-terra`; expected reasoning: high.
- Existing role: `documentation_reviewer`.
  Scope: affected human READMEs, agent references, guides, Proto prose, TSDoc,
  commands, paths, and beginner accuracy.
  Expected model: `gpt-5.6-luna`; expected reasoning: medium.
- Existing role: `typescript_api_docs_reviewer`.
  Scope: changed `client-web` behavior, authored Proto contracts, generated
  usage, public TypeScript declarations, validation response shape, and
  compatibility.
  Expected model: `gpt-5.6-terra`; expected reasoning: high.
- Existing role: `performance_reliability_reviewer`.
  Scope: ordering, timer/subscription/request cleanup, retries, concurrent
  refresh, startup lifecycle, bundle warning, and browser/server reliability.
  Expected model: `gpt-5.6-terra`; expected reasoning: high.

Every dispatch must pass both fields explicitly. Runtime self-metadata is
recorded when exposed; otherwise the immutable configured role/profile and the
surface limitation are the acceptance evidence.

## Wave 2 Results

Runtime self-metadata was unavailable for every lane. The immutable configured
role/profile is the accepted evidence; no visible mismatch or fallback
occurred.

- Style/maintainability (`gpt-5.6-terra` / high): clean. The three accepted P2
  findings are resolved, and no P0-P2 finding remains.
- TypeScript/API (`gpt-5.6-terra` / high): the raw-value P1 is resolved. One
  accepted P2 corrects the registry summary from “lists packages” to an
  application type registry composed from the declared model packages. The
  claimed test-count P2 is rejected: the reviewer's command ran the component
  file alone at 24 tests, while the recorded 25/25 result explicitly includes
  both the component and relative-time web test files.
- Performance/reliability (`gpt-5.6-terra` / high): one P1 remained. If a
  subscription refresh was in flight when a post succeeded, an ordinary first
  refresh rejection discarded the queued post-success refresh.

The reliability P1 was reproduced by a RED interleaving test: update refresh
in flight, post success queues another refresh, first refresh rejects, and the
old implementation stayed at two sends. The coalescing loop now handles each
request failure independently and continues when a newer refresh request is
queued. The same test is GREEN and renders the authoritative post. Abort and
generation cleanup remain unchanged. The registry wording fixture passes the
complete 87-test Proto-tools suite.

## Final Targeted Reliability Dispatch

- Existing role: `performance_reliability_reviewer`.
  Scope: only the wave-2 P1 correction and its exact interleaving regression.
  Expected model: `gpt-5.6-terra`; expected reasoning: high.

Both fields must be explicit. This additional targeted check is required
because the second wave exposed unresolved P1 risk; it is not another complete
review wave.

## Final Targeted Result

Runtime self-metadata was unavailable. The immutable configured
`performance_reliability_reviewer` profile (`gpt-5.6-terra` / high) is the
accepted evidence; no visible mismatch or fallback occurred.

The lane is clean with no P0-P2 findings. Ordinary rejection preserves a newer
queued authoritative refresh, execution remains bounded to one in-flight
request plus one coalesced follow-up, and abort/generation cleanup remains
effective. The exact regression passes.

## Converged Disposition

- Style/maintainability: clean after correction.
- Documentation: clean after the deterministic accepted wording correction.
- TypeScript/API docs: clean after the accepted registry wording correction;
  the raw-value P1 is closed and the test-count finding is rejected by exact
  two-file evidence.
- Performance/reliability: clean after the final targeted P1 correction.
- Security: N/A for the concrete unchanged-boundary reason recorded in wave 1.

No P0-P2 finding remains. Final verification may proceed.

Dispatch status:

- Style used explicit `gpt-5.6-terra` / high fields.
- TypeScript/API used explicit `gpt-5.6-terra` / high fields.
- Documentation selected the immutable `documentation_reviewer` profile
  (`gpt-5.6-luna` / medium). The Desktop collaboration surface rejected Luna
  as a free model override and exposes it only through that fixed role; this
  limitation is recorded rather than substituting another model.

## Wave 1 Results

Runtime self-metadata was unavailable for every lane. The immutable configured
role/profile is the accepted evidence; no visible mismatch or fallback
occurred.

- Style/maintainability (`gpt-5.6-terra` / high): three P2 findings.
  Remove the unreferenced `browser-fixture.tsx`; split the 257-line `Board`
  component across synchronization, message-list, and post-form semantics; and
  reverse the stale Chat-to-Message Board immutable-baseline mapper with a
  regression test.
- Documentation (`gpt-5.6-luna` / medium): one P2 finding. Clarify that blank
  text is submitted to the server for validation but cannot be accepted. All
  other affected docs were clean.
- TypeScript/API (`gpt-5.6-terra` / high): one P1 and two P2 findings. Submit
  raw username/message values instead of browser-only trimming; apply the same
  reference correction; and replace the exported registry's single-line TSDoc
  with the required block form, including generator output.
- Performance/reliability (`gpt-5.6-terra` / high): one P1 finding. After every
  successful post, run an authoritative refresh so the row appears even when
  no subscription update arrives, with a regression test.

The documentation/API reference finding is one deduplicated P2. Accepted
correction batch: two P1s and four P2s. Security is N/A because the task does
not change authentication/authorization semantics, credentials, trust
boundaries, or deployment policy; the renamed example policy is behaviorally
unchanged and retains its existing tests.

## Wave 1 Corrections

- Deleted the unused browser fixture and split synchronization, query-row
  ordering, message rendering, and posting into small semantic modules.
- Reversed the immutable baseline migration mapper to map each current
  Message Board family path to its actual historical Chat path. A deterministic
  regression proves all three exact mappings.
- Preserved raw username and message values through the browser command path.
  A focused regression proves whitespace reaches the server unchanged.
- Added an authoritative refresh after every successful post. A focused
  regression proves the row appears without a subscription update.
- Corrected the browser reference wording and generated registry TSDoc source,
  then regenerated the Message Board registry.
- Converted the Shadcn wrappers to documented React component constants and
  completed TSDoc layout/parameter coverage found by deterministic enforcement.

Focused correction evidence is clean: Message Board web tests 25/25,
Proto-tools tests 87/87, cleanup-rule tests 108/108, generated TypeScript build,
tooling typecheck, ESLint, TSDoc enforcement, cleanup enforcement, docs/API,
Buf lint, generated cleanliness, format, and `git diff --check`. Live
Playwright acceptance passes Chromium, Firefox, and WebKit.

Documentation does not reopen: its deduplicated wording correction is
record-only and is proved by deterministic documentation checks. The affected
style, TypeScript/API, and performance/reliability concerns reopen because the
component structure, raw-value contract, and refresh lifecycle changed
substantively.

## Wave 2 Dispatches

- Existing role: `style_maintainability_reviewer`.
  Scope: the accepted style corrections only: split UI ownership, removal of
  the dead fixture, React wrapper declarations, and historical-path mapper.
  Expected model: `gpt-5.6-terra`; expected reasoning: high.
- Existing role: `typescript_api_docs_reviewer`.
  Scope: the accepted API corrections only: raw form values, generated
  registry TSDoc source/output, and focused regression coverage.
  Expected model: `gpt-5.6-terra`; expected reasoning: high.
- Existing role: `performance_reliability_reviewer`.
  Scope: the accepted reliability correction only: post-success authoritative
  refresh, refresh coalescing/cancellation, and its no-update regression.
  Expected model: `gpt-5.6-terra`; expected reasoning: high.

Every dispatch must pass both fields explicitly. Runtime self-metadata is
recorded when exposed; otherwise the immutable configured role/profile and the
surface limitation are the acceptance evidence.
