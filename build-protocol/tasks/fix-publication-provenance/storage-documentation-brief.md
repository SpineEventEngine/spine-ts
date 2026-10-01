# Storage documentation correction

Orchestrator-dispatched documentation function: `gpt-6-luna`, `medium`, Standard
speed. No children, memory, commits, pushes, builds or tests. Main accepts the
result only after checking the configured model and reasoning and the diff.

You are not alone in the checkout. The runtime implementer is working on
delivery files and tests. Preserve all existing edits. Your exclusive write
scope is comments and declaration spacing in these production files:

- `packages/storage/src/memory/tenant-records.ts`
- `packages/storage/src/internal/entity-commit.ts`
- `packages/storage/src/memory/in-memory-entity-commit.ts`
- `packages/storage-mysql/src/mysql/storage-factory.ts`
- `packages/storage-datastore/src/datastore/entity-history.ts`

Read AGENTS.md, the applicable build protocol documentation rules and
CODE_QUALITY.md. Run `pnpm lint:tsdoc` and fix every finding in your assigned
files. Document all classes, methods, type parameters, arguments and return
values required by the existing gate, including private declarations. Use
simple descriptions of what callers supply or receive. Do not narrate agent
work or use unexplained internal wording. Do not invent behavior or change
runtime expressions, declarations, visibility, names, tests or debt baselines.
Use apply_patch. Format your assigned files and rerun the gate.

Entity commits now return Promise<void> and do not compare an expected old
Entity state. Immutable history/Event checks remain. The memory implementation
prepares only affected entries and publishes them together. Transactional
providers use database transactions; MyISAM/Aria retain documented partial
writes. Qualify the provider port's atomicity descriptions accordingly. Keep
unrelated record compare-and-set behavior documented as it actually works.

Main may have other incomplete files in the gate. Report their exact paths,
but do not edit outside the scope. Return changed files, exact command results
and any wording uncertainty. Write the final report only to the supplied
temporary output file; main records acceptance in the branch log.
