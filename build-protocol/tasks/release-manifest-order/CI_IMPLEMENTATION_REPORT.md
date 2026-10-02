# PR publication parity implementation

## Design finding and correction

Before editing, the existing `executeRelease()` seams were too broad for the
requested trial. Injecting `registry` bypassed the real registry HTTP parser;
injecting `invoke` bypassed npm argument construction and isolated config.
The implementation adds narrow `fetch` and npm subprocess injection while
retaining the existing defaults for real publication. No release format,
publisher policy, package API, or real trusted-publishing path changed.

The shared composite action prepares saved archives in both PR and publishing
workflows with the same pinned tools, frozen install, audits before verification,
Rekor loopback fixture, and archive command. PR CI transfers the 19 archives
to a fresh Node-only job. Its standalone trial calls the real `main()` release
dispatcher for preflight, publish, rerun, and read-only verification. It uses
the real saved loader, source SHA checks, registry parser, npm arguments and
config, report writer/reader, publication logic, and confirmation. Only HTTP
responses and the npm network-producing subprocess are substituted. Unknown
URLs, HTTP write requests, npm arguments, and config paths fail closed.

## Red and green evidence

1. `node_modules/.bin/vitest run scripts/release-cli.test.mjs -t 'routes registry reads|builds npm arguments'`
   was red: the HTTP test received `unexpected real fetch`; the subprocess
   test did not call the injected runner. This identified the missing seams.
   The latter red run reached the preexisting npm subprocess once with a
   nonexistent local archive. The npm debug log shows `ENOENT` opening that
   archive before any registry request is logged. No package was published.
   Subsequent tests and the trial use only injected service I/O.
2. After adding the narrow seams, the same command passed: 2 selected tests.
   The subprocess test checks the exact npm arguments, empty distinct config
   files, cleanup, and persisted failed-attempt report.
3. `node_modules/.bin/vitest run scripts/release-workflows.test.mjs` was red
   before workflow edits: 3 failed because the shared action and fresh trial
   job were absent. After editing, it passed: 5 tests. The tests require the
   common preparation action, audit order, pinned tooling, Rekor fixture,
   archive upload/download, and a Node-only PR trial job.
4. `node_modules/.bin/vitest run scripts/release-trial.test.mjs` was initially
   red because the offline harness was absent, then passed: 2 tests. A further
   red run showed the harness accepted POST to a known registry URL. After
   rejecting methods other than GET and request bodies, the same focused test
   passed. The harness also rejects unexpected URLs and npm commands.
5. A bounded local integration run generated temporary synthetic archives for
   the actual 19-package dependency graph, with checksums and a saved manifest.
   The first fixture retained a private `workspace:*` dev dependency, and the
   real archive validator correctly rejected it. With the temporary fixture
   corrected, `runTrial(input, output)` passed through the actual
   `loadPrepared()` checks and printed: `Offline publication trial: 19 normal,
partial failure, rerun, and read-only checks passed.` The saved resumed
   report contained 19 `published` packages at attempt 2. Temporary archives
   and reports were removed. The PR job will use actual prepared archives.

## Final focused checks

- `node_modules/.bin/vitest run scripts/release-artifacts.test.mjs scripts/release-cli.test.mjs scripts/release-publication.test.mjs scripts/release-registry.test.mjs scripts/release-workflows.test.mjs scripts/release-trial.test.mjs`: 6 files, 73 tests passed.
- `node scripts/check-cleanup-rules.mjs`: passed.
- `node scripts/check-tsdoc.mjs`: passed after correcting two summaries and the
  async return documentation.
- `node scripts/check-release-readiness.mjs`: passed; 87 package imports, 54
  package assets, and 423 relative Markdown links checked.
- `node_modules/.bin/prettier --check` over changed release scripts, tests,
  workflows, action, and runbook: passed.
- `node --check scripts/release-trial.mjs && node --check scripts/release-cli.mjs && git diff --check`: passed.

No full release gate, remote workflow, actual archive preparation, real
publishing, or external publishing-service request was run as part of the
completed trial. The offline trial cannot establish live npm availability,
trusted-publisher configuration, GitHub environment authorization, or live
provenance acceptance. Existing CI install, audit, and artifact I/O remains.

## Files changed by the implementer

- `.github/actions/prepare-release/action.yml` (new)
- `.github/workflows/build.yml`
- `.github/workflows/publish.yml`
- `scripts/release-cli.mjs`
- `scripts/release-cli.test.mjs`
- `scripts/release-trial.mjs` (new)
- `scripts/release-trial.test.mjs` (new)
- `scripts/release-workflows.test.mjs`
- `docs/release-publishing.md`
- `build-protocol/tasks/release-manifest-order/CI_IMPLEMENTATION_REPORT.md`

Main changed task records and the build protocol concurrently; those edits
were preserved. The assignment explicitly configured the existing implementer
as `gpt-6-sol` with `medium` reasoning. Runtime model and reasoning metadata
were not exposed to this implementer; the explicit configured profile is the
available evidence.

## 2026-10-02 correction batch

The updated human ledger required the trial to fail closed if the injected
subprocess is ignored. `withProcessGuard()` now scopes a `child_process.spawnSync`
replacement around the trial, calls `syncBuiltinESMExports()`, permits only the
exact local checkout identity and archive inspection commands, and restores
the binding in `finally`. An ignored npm injection raises `Blocked trial
subprocess: npm`. The guard is separate from the injected npm runner. The
regression adds an outer npm fence in the test process, so even a broken guard
cannot start a real npm command during that test. The existing global fetch
fence still rejects an ignored HTTP injection.

Other corrections in the same batch:

- Kept the PR job identifier `verify`; `trial` depends on it.
- Added `if: always()` upload of trial reports under the distinct
  `publication-trial-report` artifact and directory. These reports are separate
  from real publication's `publication-report` recovery artifact. The workflow
  tests assert the names and upload condition.
- CLI parsing now rejects absent `--input` or `--output` and missing values
  before any release files are read. Three CLI usage cases are tested.
- Offline selected `latest` now remains at the newly published stable version;
  snapshot publication preserves the previous `latest`. Both cases are tested.
- The npm substitute rejects any package sent out of manifest dependency order,
  including an otherwise correctly formed npm command. The regression sends
  the second package first and observes `Trial publication order changed`.

### Correction red and green evidence

`node_modules/.bin/vitest run scripts/release-workflows.test.mjs scripts/release-trial.test.mjs`
was red before these edits: 7 failed, including missing subprocess guard,
missing CLI option handling, overwritten stable `latest`, absent upload-order
assertion, and the changed PR job identifier. The guard test had an outer npm
fence before implementation. After the batch, the same command passed: 13
tests. The final focused six-file command passed: 79 tests.

Before the real archive run, `git rev-parse HEAD` returned
`faeea301a7469a23b6787454741e5760229e0e73`; the supplied directory
`/tmp/spine-ci-release-check-20261002` contained 19 `.tgz` archives, and the
trial output path did not exist. After the guard regression passed,
`node scripts/release-trial.mjs --input /tmp/spine-ci-release-check-20261002 --output /tmp/spine-ci-trial-check-20261002`
exited 0 in 2.4 seconds with `Offline publication trial: 19 normal, partial
failure, rerun, and read-only checks passed.` The output directory contains
five isolated JSON reports:

| Report                   | Attempt | Package attempts | Result                                        |
| ------------------------ | ------: | ---------------: | --------------------------------------------- |
| `normal.json`            |       1 |               19 | 19 published                                  |
| `partial.json`           |       1 |                2 | Two unconfirmed; later packages not attempted |
| `read-only.json`         |       1 |               19 | 19 published                                  |
| `resumed.json`           |       2 |               19 | 19 published                                  |
| `resumed-read-only.json` |       2 |               19 | 19 published                                  |

No synthetic archives were rebuilt in this correction turn. The real archive
trial used only injected publishing-service I/O; it did not call npm publish or
make a publishing-service HTTP request.

Final bounded checks: 79 focused tests passed; cleanup, TSDoc, Prettier,
JavaScript syntax, and `git diff --check` passed. No full release gate,
remote workflow, commit, or push was run by this implementer. The main agent's
task-record edits remained untouched.
