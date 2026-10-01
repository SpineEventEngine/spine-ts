# npm publication implementation

Read this brief first. Act as the project's existing implementer, a senior
TypeScript/release engineer. Model is explicitly gpt-6-sol with medium reasoning,
standard service tier and memories disabled. Do not use prior memory or spawn
subagents. You are not alone in the checkout: preserve all existing version and
other changes. Main handles records, broad docs, commits/pushes and verification.

## First assignment: recovery evidence only

The human approved replacing Lerna with pinned npm CLI publication of the
already-tested tarballs, keeping token-free OIDC and Sigstore provenance, and
allowing one fresh attempt only for a proven pre-upload Rekor HTTP 409 conflict.
Read task_plan.md, findings.md and TASK.md in this directory, plus relevant
BUILD_PROTOCOL.md and CODE_QUALITY.md rules. The new human approval supersedes
historical text saying a replacement is not yet approved.

Before production changes, establish the exact observable error emitted by
npm 11.16.0 and the fact no npm package upload occurs when provenance creation
fails. Inspect the installed/pinned npm and its Sigstore sources, not just the
old Lerna stack. Reproduce the actual-library failure and one fresh signing
attempt locally. Distinguish orchestration fixtures from real signing/CLI proof.
No real identities, registry writes, vendor source patching, disabled provenance,
or long batch timeout/retry workarounds. Use local HTTP/network fixtures if needed.

You may add bounded focused test/fixture files in scripts, documenting all
functions, and run only the narrow tests. Do not run full builds, installs,
complete test suites, commits or pushes. Do not change production publishing
behavior before reporting this first evidence result.

Report whether stderr/JSON/npm debug logs expose enough information to classify
the exact conflict safely. If only a generic TLOG_CREATE_ENTRY_ERROR is exposed,
do not broaden the accepted retry automatically. Explain the smallest supported
way to identify the HTTP 409 cause, or report the blocker.

Use test-driven-development and its testing-anti-patterns reference. Use
apply_patch for edits. Preserve project method size and TSDoc rules. The broader
approved plan is context, not permission to start all its slices now.

Write implementation-report.md in this directory with inspected versions,
commands/results, changed files, precise evidence and remaining uncertainty.
Return a short report. Main will resume this same context for the production
implementation after reviewing the evidence.
