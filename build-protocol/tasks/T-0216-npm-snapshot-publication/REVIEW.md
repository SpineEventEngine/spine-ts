# T-0216 Review

## Review package

- Baseline: `ea7ec5e8cf7f0cbcdfa78befd45a41788aee8c8c`.
- Candidate: `d5317979eda710354cb249ab17f8f788eb5d3c08`.
- Requirements: the complete Human-Imposed Requirements Ledger in `TASK.md`.
- External review inputs:
  `/Users/armiol/development/experiments/spine-ts-wave14-publication/publish-spine-ts-2.0.0-snapshot.2.mjs`
  and
  `/Users/armiol/development/experiments/spine-ts-wave14-publication/PUBLISH-2.0.0-snapshot.2.md`.
- Historical or superseded text outside the current task state is not a finding
  unless the current task or changed reader documentation claims it as active.

## Assignment gate

| Concern                    | Existing role                      | Bounded scope                                                                                                          | Explicit model  | Explicit reasoning | Runtime telemetry                                                                                         |
| -------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------ | --------------------------------------------------------------------------------------------------------- |
| Style/maintainability      | `style_maintainability_reviewer`   | New publication/artifact modules and affected tests only                                                               | `gpt-5.6-terra` | high               | Explicit dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable. |
| Documentation completeness | `documentation_reviewer`           | Changed reader prose, package metadata descriptions, and external disposable instructions                              | `gpt-5.6-luna`  | medium             | Explicit dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable. |
| TypeScript/API docs        | `typescript_api_docs_reviewer`     | Published package contracts, packed exports/targets, dependency rewriting, and external compile/import proof           | `gpt-5.6-terra` | high               | Explicit dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable. |
| Performance/reliability    | `performance_reliability_reviewer` | Exact-artifact lifecycle, ordering, visibility polling, resumption, interruption, and bounded cleanup                  | `gpt-5.6-terra` | high               | Explicit dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable. |
| Security                   | `security_reviewer`                | Credential handling, command execution, registry mutation gating, integrity comparison, and malicious/mismatched state | `gpt-5.6-terra` | high               | Explicit dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable. |

## Wave result

All five concern-specific lanes reported. Documentation completeness is clean.
The other reports are technically accepted and deduplicated into this one
correction batch:

1. Reject every tracked, staged, and untracked checkout change before install,
   validation, packing, or publication; add a regression for an untracked file.
2. Pin `npm whoami` and `npm publish` to
   `https://registry.npmjs.org/` and preserve inherited publication stdio.
3. Validate repository identity and reviewed publication-module hashes before
   importing checkout code from the disposable wrapper.
4. Recompute each tarball's SHA-512 immediately before the registry comparison
   and publication; abort without publishing if the bytes changed. Add explicit
   mismatch/zero-publication coverage.
5. Replace string-prefix consumer containment with path-aware containment and
   cover a sibling-prefix/symlink escape.
6. Declare the React type dependency required by the published `client-react`
   declarations, update the lockfile separately, and rerun the exact consumer.

The style and reliability clean-checkout reports are one root cause. The
security integrity report and the style mismatch-test report share one
regression. No finding is waived, and none requires broader compiler, tooling,
authentication, or SPI restructuring.

## Correction assignment gate

| Existing role | Bounded ownership                                                                                                                                   | Explicit model  | Explicit reasoning | Child spawning | Runtime telemetry                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `implementer` | The six accepted corrections above in package metadata/lockfile, publication/artifact modules and tests, and the two external disposable files only | `gpt-5.6-terra` | medium             | Prohibited     | Explicit follow-up dispatch and immutable configured role/profile will be visible; child self-telemetry is unavailable. |

Affected re-review after deterministic correction checks: style/maintainability,
TypeScript/API documentation, performance/reliability, and security.
Documentation completeness is not reopened because no accepted correction
changes reader-facing claims.

## Correction result

- `541dae011` declares the React type peer required by the public
  `client-react` declarations; `5f54a35db` updates only the lockfile.
- `231ba8541` pins `npm whoami` and `npm publish` to the public registry while
  publication retains inherited terminal stdio.
- `9c9c55571` changes consumer containment to path-aware comparison;
  `8e77e6aa0` adds the sibling-prefix regression and closes both integrity timing
  boundaries against the prepared SHA-512 baseline.
- `465808d63` adds the immediate pre-publish integrity recheck and zero-publish
  mutation regression.
- The external disposable wrapper now rejects every porcelain status entry,
  validates the exact root/version/18-package inventory, and verifies embedded
  SHA-512 hashes for all imported permanent publication modules before dynamic
  import. A disposable Git fixture proves an untracked file is rejected before
  imports. The wrapper remains outside Git.
- Focused publication, artifact, and metadata suites pass 28/28; the added
  integrity/containment subset passes 15/15 with focused ESLint clean. The exact
  all-18 external consumer passes 2/2 in 29.99 seconds.

## Affected re-review assignment gate

| Concern                 | Existing role                      | Bounded scope                                                                                      | Explicit model  | Explicit reasoning | Runtime telemetry                                                                                         |
| ----------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------- | --------------- | ------------------ | --------------------------------------------------------------------------------------------------------- |
| Style/maintainability   | `style_maintainability_reviewer`   | Clean-checkout and mutation regressions plus the small corrected seams                             | `gpt-5.6-terra` | high               | Explicit dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable. |
| TypeScript/API docs     | `typescript_api_docs_reviewer`     | React declaration dependency and exact consumer only                                               | `gpt-5.6-terra` | high               | Explicit dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable. |
| Performance/reliability | `performance_reliability_reviewer` | Complete checkout gate, two integrity timing boundaries, isolation containment, and cleanup impact | `gpt-5.6-terra` | high               | Explicit dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable. |
| Security                | `security_reviewer`                | Public-registry pin, pre-import trust, tarball integrity timing, and path containment              | `gpt-5.6-terra` | high               | Explicit dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable. |

## First affected re-review result

- TypeScript/API documentation is clean; the React declaration dependency and
  exact tarball consumer resolve the prior finding.
- Both integrity timing boundaries and complete porcelain checkout gating are
  confirmed correct.
- One final deduplicated correction batch remains:
  1. make containment separator-safe and add explicit Windows semantics;
  2. exercise the real `realpath` traversal with an escaping symlink fixture;
  3. preserve the disposable wrapper's untracked-checkout behavior as an
     executable embedded fixture/self-test without committing the wrapper;
  4. authenticate the entire reviewed checkout by pinning its immutable Git
     commit before install or packing, in addition to the existing clean state,
     inventory, and module hashes.

## Final correction and re-review gate

| Function/concern        | Existing role                      | Bounded scope                                                                       | Explicit model  | Explicit reasoning | Child spawning | Runtime telemetry                                                                                                   |
| ----------------------- | ---------------------------------- | ----------------------------------------------------------------------------------- | --------------- | ------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| Correction owner        | `implementer`                      | The four final corrections above in artifact helper/tests and external wrapper only | `gpt-5.6-terra` | medium             | Prohibited     | Explicit follow-up dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable. |
| Style/maintainability   | `style_maintainability_reviewer`   | Executable wrapper and real symlink regressions only                                | `gpt-5.6-terra` | high               | Prohibited     | Explicit dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable.           |
| Performance/reliability | `performance_reliability_reviewer` | Cross-platform containment and symlink traversal only                               | `gpt-5.6-terra` | high               | Prohibited     | Explicit dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable.           |
| Security                | `security_reviewer`                | Immutable checkout identity and cross-platform containment only                     | `gpt-5.6-terra` | high               | Prohibited     | Explicit dispatch and immutable configured role/profile are visible; child self-telemetry is unavailable.           |

No other concern is reopened. The wrapper's final immutable commit value may be
refreshed deterministically after integration so the human's fresh `main`
checkout is the authenticated candidate; the validation behavior itself is the
reviewed security contract.

## Final re-review result

- Style/maintainability and performance/reliability are clean. The wrapper
  fixture exercises its production cleanliness guard, and native/Windows plus
  real symlink traversal regressions pass with bounded cleanup.
- Security accepts the commit pin, import ordering, registry pinning, integrity
  boundaries, and containment, but found one remaining P1: ordinary Git status
  can honor configuration or index flags that hide untracked or modified paths.
- Accepted final correction: force complete untracked/ignored visibility and
  independently compare every tracked worktree file's Git blob identity and
  mode with the pinned commit tree before imports. Extend the embedded fixture
  with a modified `assume-unchanged` tracked file so this bypass is executable.
  This changes only the external disposable wrapper and will be security
  re-reviewed; permanent/package code remains converged.
