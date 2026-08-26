# T-0220a Work Log

- `2026-08-26`: The orchestrator audited all 306 named test files. The ordinary
  Vitest gate collects 287 files: 283 are self-contained and four contain
  opt-in real Datastore, Datastore-emulator, or MySQL suites. Nineteen named
  test files are already outside the ordinary Vitest gate; Docker and
  Playwright acceptance remains separately invoked.
- `2026-08-26`: GitHub run `32965320472` failed in the self-contained managed
  remote-delivery readiness test because connection shutdown produced Connect
  `CANCELED` while the assertion required only `UNAVAILABLE`. Twelve isolated
  local repetitions passed, confirming a platform/timing-dependent ordering.
- `2026-08-26`: Selected `verify:release` because the correction changes shared
  test configuration used by release and publication workflows. The mandatory
  cheap preflight and one complete release gate will run after implementation
  and review convergence.
- `2026-08-26`: Implementation assignment recorded before dispatch: existing
  `implementer` role, bounded scope from `TASK.md`, explicit
  `gpt-5.6-terra` / `medium`, child spawning prohibited.
- `2026-08-26`: RED: the new `scripts/stable-ci-suite.test.mjs` could not load
  the deliberately absent shared inventory module. This established that the
  repository had no mechanical stable/infrastructure boundary.
- `2026-08-26`: GREEN: `scripts/test-inventory.mjs` now names exactly the four
  provider-dependent files. The ordinary `vitest.config.ts` excludes that
  immutable inventory unconditionally; `vitest.infrastructure.config.ts`
  includes only that inventory. The policy test imports and evaluates both
  configurations, so source comments or dead strings cannot satisfy it.
- `2026-08-26`: The Datastore-emulator and MySQL package commands now select
  the shared inbox provider test with their already fail-closed provider setup.
  There is no standalone server command that could pass by skipping every
  provider suite.
- `2026-08-26`: The managed remote-delivery test still proves a command issued
  after drain is rejected. It now requires a Connect error and permits only
  `UNAVAILABLE` (server rejected the request) or `CANCELED` (the transport
  closed first); unrelated errors remain failures.
- `2026-08-26`: Focused evidence: policy test passed 3/3; the dedicated
  configuration collected exactly 4 skipped provider files / 19 skipped tests
  without provider setup; ordinary Vitest refused the cloud file even with its
  enabling environment variables set; the managed remote-delivery file passed
  5 consecutive isolated runs (3/3 each). `pnpm typecheck:tooling`, focused
  ESLint, Prettier, and `git diff --check` passed.
- `2026-08-26`: Runtime self-telemetry is not exposed by the desktop dispatch
  surface. Acceptance evidence is therefore the immutable configured existing
  `implementer` role with explicit `gpt-5.6-terra` / `medium` dispatch recorded
  in `TASK.md`; no visible fallback occurred.
- `2026-08-26`: Consolidated review correction RED: the strengthened policy
  test failed because the provider commands did not select an inbox provider.
  A second RED test could not import the intentionally absent provider-selection
  helper. Both failures established the missing command/test boundary.
- `2026-08-26`: GREEN: `SPINE_TS_INBOX_PROVIDER` now selects exactly one inbox
  cleanup provider. The emulator command selects `datastore` only after its
  Datastore verifier; the MySQL command selects `mysql` only after its MySQL
  verifier. The policy test asserts the exact verifier-first command mappings
  and executes both verifiers in an environment with provider setup removed,
  proving they fail before Vitest could skip tests.
- `2026-08-26`: The managed drain assertion now treats `CANCELED` as a valid
  transport ordering only while retaining the live subscription relay until
  all admitted work finishes. After releasing the deliberately admitted work,
  it requires the iterator to finish with no further update. A uniquely named
  post-drain command therefore cannot hide an observable admitted state effect.
- `2026-08-26`: Consolidated focused evidence: stable policy plus provider
  selection plus managed remote tests passed 9/9; the managed file then passed
  5 further consecutive isolated runs (3/3 each). `pnpm typecheck:tooling`,
  focused ESLint, Prettier, and `git diff --check` pass after the correction.
- `2026-08-26`: Re-review correction: the stable-suite policy now enforces the
  exact cloud command mapping (cloud verifier first, infrastructure config,
  cloud test only, and no inbox-provider test). It also runs the cloud verifier
  with cloud and provider variables removed and requires a nonzero result. The
  focused policy test passed 4/4 with ESLint, Prettier, and diff checks.
- `2026-08-26`: Both affected re-review concerns are clean. The mandatory cheap
  preflight passed the Node check, 9 focused tests, tooling typecheck, ESLint,
  Prettier, exact disjoint stable/infrastructure collection, and diff check.
- `2026-08-26`: The one post-convergence `pnpm verify:release` passed all 285
  stable files and 4,522 tests. Coverage finished at 93.28% statements, 90%
  branches, 92.81% functions, and 94.44% lines. The release suite collected no
  provider-infrastructure file.
