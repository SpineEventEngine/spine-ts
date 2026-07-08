# T-0016b Review Log

Status: round 1 fixes applied; integration result pending

Scope: framework-owned generated repository assembly, to-do example assembly
cleanup, and related docs/tests.

## Required Lanes

| Lane                       | Reviewer sub-agent | Status  | Required focus                                                                                         |
| -------------------------- | ------------------ | ------- | ------------------------------------------------------------------------------------------------------ |
| Code style/maintainability | `019f3f8b-a395-7363-80cb-b2a9a9b7cc9f` | Clean                 | Small JVM-familiar API, no new broad factory hierarchy, names under the cleanup rules.                  |
| Documentation completeness | `019f3f8b-a444-72b3-aab7-2b1a97467754` | Fixed, pending integration | Package docs, user guides, task/decision logs, and example instructions describe entity-class assembly. |
| TypeScript/API docs        | `019f3f8b-a4b4-7d12-9c67-542df0ad5b15` | Fixed, pending integration | Public overloads/comments are clear; internals stay internal; app code avoids registry internals.       |
| Security                   | `019f3f8b-a548-7602-b6e4-299ae1fc579f` | Fixed, pending integration | Dynamic import path handling remains file-URL/path constrained; cleanup guard blocks app internals.     |
| Performance/reliability    | `019f3f8b-a5c0-7fa0-b564-1f4ea125b1b8` | Fixed, pending integration | Registry discovery is cached/one-shot per build path; errors are deterministic; verification passes.    |

## Rounds

- Round 1 reviewed branch head `2c94a08` using review package
  `.superpowers/sdd/review-08d8f0e..2c94a08.diff`.
- Code style/maintainability: clean.
- Documentation completeness findings:
  - stale docs still claimed default repository construction from entity
    classes is deferred or unsupported;
  - generated registry root/default behavior was not explained clearly enough;
  - task/review logs needed round status and closure metadata.
- TypeScript/API docs finding:
  - public `withGeneratedRegistryRoot(root: GeneratedRegistryRoot)` exposed a
    non-exported public type.
- Security findings:
  - defaulting dynamic import roots to `process.cwd()` and accepting arbitrary
    roots without realpath confinement could import an unintended registry;
  - cleanup guard did not catch string-literal element access such as
    `server["GeneratedRegistryDiscovery"]`.
- Performance/reliability finding:
  - a previously imported registry module could still be returned from Node's
    ESM cache after the file was removed; builds must check freshness before
    import.
- Round 1 fixes applied by review-fix sub-agent at `2026-07-08 03:40 WEST`.
  Commit metadata: branch `task/T-0016b-framework-owned-assembly`, planned
  message `Fix generated registry assembly review findings`.
  - Documentation: package README, user guide, API docs, developer API, and
    to-do docs now show explicit
    `withGeneratedRegistryRoot(compiledPackageRoot).buildAsync()` for generated
    entity-class assembly; sync `build()` remains documented for explicit
    repositories.
  - TypeScript/API: `withGeneratedRegistryRoot()` now exposes `string | URL`
    directly instead of a non-root-exported `GeneratedRegistryRoot` type.
  - Security: entity-class assembly no longer falls back to `process.cwd()`;
    the builder requires an explicit root, canonicalizes root and registry
    file realpaths, and rejects registry paths that escape the trusted root.
  - Reliability: the registry file must exist and be readable before each
    import, preventing a deleted registry from succeeding via Node ESM cache.
  - Cleanup: example guardrails now reject string-literal element access to
    forbidden server internals.
  - Verification: focused server/cleanup tests passed (123 tests), escalated
    to-do tests passed (18 tests), `corepack pnpm typecheck` passed,
    `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
    warning, sandboxed full tests failed only on local HTTP/2 listener and
    ZeroMQ IPC permission errors, and escalated `corepack pnpm test` passed
    (50 files / 829 tests).
