# Release Notes Studio desktop guidance

Follow the repository [agent instructions](../../AGENTS.md) and
`build-protocol/BUILD_PROTOCOL.md` for this example. The MōBrowser 2.18.0 API is
version-specific: before editing its runtime or IPC, read the installed
`node_modules/@mobrowser/api/docs/guides/` and `docs/api/` reference. Run
`pnpm gen:desktop` from this directory after install or a desktop `.proto`
change; the CLI also downloads the matching agent documentation when this
`AGENTS.md` is present. The generated `src/main/gen/` and `src/renderer/gen/`
directories are build outputs and stay untracked.

For native end-to-end tests, read the installed
`node_modules/@mobrowser/cli/e2e.d.ts` fixture contract and the matching SDK
testing guides under `node_modules/@mobrowser/api/docs/`. Use the official
`@mobrowser/cli/e2e` fixture. Repository instructions take precedence over
vendor guidance.

For this example's Agent, model, and history contracts, use the
[coding-agent reference](REFERENCE.md). The [README](README.md) guides users
through the desktop application.
