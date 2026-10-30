# Baseline verification

Assignment: orchestrator-dispatched mechanical verification function; explicit
configured profile `gpt-6-luna` / `low`, fork none, no descendants. Runtime
self-introspection was unavailable. This records the immutable configured
profile and the explicit dispatch fields from the assignment. No production
files were edited.

Worktree: `/Users/armiol/.codex/worktrees/app-queries-read-filters/spine-ts`

## Commands and results

1. `pnpm proto:generate` — **passed**, exit 0. The workflow reported:
   - 57 Spine Proto source file checksums verified;
   - authored Proto style checks passed;
   - example Proto quality checks passed;
   - rejection source naming checks passed;
   - 55 frozen descriptor files verified against normalized digest
     `0844be5a0c588717932dc09da4d3fdc62c945a4f82be9bbb4e4d3d4814e42c3b`.
     The command completed without further output or errors.
2. `pnpm typecheck:build:generated` — **passed**, exit 0. It ran desktop code
   generation for `example-release-notes`, TypeScript project build, runtime
   copy, and declaration normalization. Desktop generation completed
   successfully.
3. `pnpm exec vitest run packages/core/test/validation-facade-boundary.test.ts packages/proto-tools/test/handler-codegen.test.ts packages/proto-tools/test/generated-registry-writer.test.ts packages/server/test/handler/generated-registry-discovery.test.ts packages/server/test/services/spine-services.test.ts packages/client-web/test/client.test.ts --maxWorkers=1`
   — **passed**, exit 0: 6 test files, 290 tests. Vitest 4.1.12 reported
   duration 10.78s (transforms 1.74s, imports 2.50s, tests 7.64s).

## Worktree effects

After generation and build, `git status --short` showed 16 modified Proto
manifest/generation metadata files: manifests and `.spine-proto-generation.json`
under examples, Proto package, and test fixtures. Inspection of a representative
pair showed the generation ID changed from `b23937ec-f05a-47d7-ab6a-c5617f253c41`
to `08072bd6e46f8150aca229f18dd97d5840ae33f531d7265f9f3b29cad408bd1d` in both
files. These are deterministic workflow outputs; they were left as generated
for the orchestrator to assess. No cleanup or reset was performed. The task
folder also contains concurrent orchestrator/splitter records; this assignment
created only this `BASELINE.md`.
