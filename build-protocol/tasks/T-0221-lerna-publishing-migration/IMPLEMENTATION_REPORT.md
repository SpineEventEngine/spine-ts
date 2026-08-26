# T-0221 Implementation Report

Status: DONE_WITH_CONCERNS

## Result

Lerna `10.0.1` is pinned as the sole reachable publication command. The policy
validates the exact 18-package inventory, common version, internal pins,
metadata, and version-derived channel. Snapshot versions publish with the
`snapshot` tag, stable versions publish with `latest`, and other prereleases
fail. Static package tags are absent so they cannot override this choice.

The official OIDC job performs a read-only registry preflight, prepares and
validates exact package tarballs, creates a disposable non-Git workspace that
contains only packages still missing from the registry, publishes them
sequentially with Lerna `from-package`, and verifies that all 18 package
versions and the selected aggregate tag are visible. The PR workflow remains
read-only. A fully published version fails before mutation; a valid partial
version resumes with only the missing packages.

Implementation commits run from `59e957f6b` (`Bump version ->
2.0.0-snapshot.5`) through `9737df292`. Later commits update task records only.
Affected re-review, final security review, repeated cheap preflight, and one
final `verify:release` remain pending.

## Evidence

- The required version-only commit changed all 26 manifests and only their
  top-level `version` fields. Concrete internal dependency pins and generated
  package-version metadata were aligned in later commits.
- Lerna discovers 25 package workspaces: exactly 18 public framework packages
  and seven private examples. The private root remains outside publication.
- The built-in loopback registry fixture runs real pinned Lerna against
  synthetic packages. It proves dependency-first fresh publication, exact
  selected inventory, partial resumption, fully published no-op behavior,
  concrete packed dependency versions, and awaited server cleanup.
- Complete registry verification now fails closed when any required package is
  missing. Preflight still treats an absent version as unpublished.
- The affected suite passes 48 tests with 94.20% statements, 94.96% branches,
  90.19% functions, and 93.95% lines across the release CLI, policy, and
  registry modules. Prettier, cleanup rules, targeted ESLint, both dependency
  audits, and `git diff --check` are green.
- The exact tarball consumer installs all 18 packages outside the workspace,
  compiles TypeScript, imports the packages, and executes the test path without
  workspace symlinks.
- No public registry was mutated, no credential or token was introduced, no PR
  was created, and no branch was pushed.

## Review Dispositions

The completed affected review used explicit configured profiles:

- performance/reliability: `gpt-5.6-terra`, high;
- style/maintainability: `gpt-5.6-terra`, high;
- documentation/package verification: `gpt-5.6-luna`, medium.

The dispatch surface exposed the immutable configured roles/profiles rather
than runtime self-introspection. All model and reasoning fields were explicit.
TypeScript/API documentation review is N/A because no public TypeScript
declarations or APIs changed. Final security review remains pending.

The early attempt to constrain Lerna with `--scope` was rejected because Lerna
10.0.1 does not support that publish option. It is historical only and is fully
superseded by the strict generated-workspace boundary. Verdaccio was also
removed: version 6.10.0 was incompatible with the resolved `js-yaml` ESM
exports, while 6.2.2 contained vulnerable dependencies. The durable fixture now
uses only the Node.js HTTP server on loopback.

## Dependency Security

Lerna's Nx dependency selected vulnerable `brace-expansion@5.0.8`. The narrow
pnpm override `brace-expansion@5.0.8: 5.0.9` selects the compatible patched
release without changing unrelated versions. Both `pnpm audit --audit-level=low`
and `pnpm audit --prod --audit-level=low` report no known vulnerabilities, and
the real-Lerna integration suite passes. Reassess and remove the override when
the pinned Lerna/Nx graph no longer resolves `5.0.8`, or when Lerna is upgraded.

## Accepted Losses And Remaining Concerns

The migration deliberately loses exact tarball-byte identity, integrity-aware
resume, per-dependency registry-visibility waits, and per-package tag-race
checks. Exact inventory/version selection and aggregate final version/tag
verification remain enforced. The old custom publisher remains tracked but is
unreachable from workflows and the release CLI until one real Lerna release
succeeds; deletion belongs to a separately versioned cleanup.

The human must configure NPM trusted publishing for the official repository
before merge. No local verification can prove that external account setting.
