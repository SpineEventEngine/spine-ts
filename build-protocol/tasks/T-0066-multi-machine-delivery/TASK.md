# T-0066 — Multi-Machine TS-to-TS Delivery Parity

Status: Complete; committed, pushed, and represented on canonical `main`.

Baseline: `93ebf880`

Classification: high-risk. This packet proves distributed ownership, stale
takeover, process lifecycle, and bounded cleanup across real process and network
boundaries.

## Ownership

Integration/e2e fixtures and their documentation only. A production or public
contract defect discovered by the suite requires a separately recorded,
implemented, and reviewed correction before this packet can close.

## Behavior Acceptance

- Launch one standalone in-memory simple delivery server and at least two
  isolated application processes through public APIs and generated descriptors.
- Both application processes compete for one shard; only one valid session owns
  it at a time.
- Messages written through either process are discovered and dispatched.
- Killing or deliberately stalling the owner demonstrates configured stale
  takeover.
- Explicit shard release and supervisor restart are exercised.
- Admin update ordering and counts, plus health transitions, are asserted through
  the public transport boundary.
- Every process, port, stream, timer, and temporary artifact is released after
  success and failure.
- Run the focused suite twice for flake detection, then the full repository gate.

## Human-Imposed Requirements Ledger

- Continue Wave 1 autonomously until complete or a genuine protocol/environment
  blocker is documented.
- Report progress in feature terms, not task identifiers, at least every 30
  minutes and immediately after every subagent result, verification/review
  result, merge, push, or blocker.
- Use the in-memory `simple-server` model only. Redis and Hazelcast are excluded.
- JVM/TS compatibility tests are deferred to Wave 3; this packet is TS-to-TS.
- Browser admin UI is deferred to Wave 4; no UI/TUI belongs in this packet.
- Use public APIs and generated descriptors, not private in-process shortcuts.
- Preserve unrelated worktree contents and never modify `human-review-1-jul.md`.
- Use one bounded implementation owner; collect one complete relevant review
  wave and one consolidated correction batch.
- Commit and push only after review and verification gates. Push the task branch
  immediately after its commit, then merge, post-merge verify, commit closure,
  and immediately push `main`.

## Assignment Metadata

- Requirements analysis: existing requirements-splitter role; expected and
  explicitly dispatched profile `gpt-5.6-sol` / `high` reasoning. Actual runtime
  metadata must be recorded before accepting the result; if unavailable, record
  the immutable configured role/profile and the limitation.
- Requirements-analysis actual metadata: runtime self-introspection was
  unavailable; the immutable configured requirements-splitter profile is
  `gpt-5.6-sol` / `high`, both fields were explicit in dispatch, and no fallback
  or mismatch was visible. Result accepted.
- Implementation: existing implementer role; expected profile
  `gpt-5.6-terra` / `medium` reasoning, to be explicitly dispatched after the
  requirements acceptance gate.
- Implementation actual metadata: runtime self-introspection was unavailable;
  the immutable configured implementer profile is `gpt-5.6-terra` / `medium`,
  both fields were explicit in dispatch, and no fallback or mismatch was
  visible.

## Separately Closed Runtime Correction

The first exact Admin-count RED exposed one surplus empty pickup/release cycle
after stale takeover. The fixture stopped without expanding production scope.
The separately owned correction `d6a5921b` prevents a controlled delivery run
when its remote source reports zero messages; closure `6d35cc98` integrated that
correction. The corrected `main` was back-merged without conflicts. Its
integrity review was clean across all eight checks before fixture work resumed.

## Required Review Concerns

- Performance/reliability: required for distributed ownership, takeover,
  cancellation, process cleanup, and flake resistance.
- Style/maintainability: required for the integration harness and semantic test
  layout.
- Documentation: required for running and understanding the topology suite.
- TypeScript/API: N/A unless the suite changes or exposes a public contract.
- Final security: deferred to Wave 1 closure unless a critical finding appears.

## Review Correction Outcome

The complete review wave returned one consolidated correction batch. All
accepted P1/P2 findings are implemented: known-service health, lower/upper stale
timing, bounded IPC/readiness settlement, finally-owned success cleanup, empty
initial Admin snapshot, deterministic cleanup aggregation, bounded Admin frame
collection, and exact timing/prerequisite documentation. No production or
public-contract correction was required in this batch.

Performance/reliability, style/maintainability, and documentation were all
substantively affected and require focused re-review. TypeScript/API remains N/A
because the public surface did not change.
