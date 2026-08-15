# T-0197c Evidence

Baseline: `aaff3b4c` on `wave13-t0197c-harness`.

## Commands

```sh
pnpm install --offline --frozen-lockfile
pnpm proto:generate && pnpm typecheck:build:generated
pnpm exec vitest run packages/server/test/server/server-integration-broker-cross-process.test.ts --reporter=verbose
node --check packages/server/test/server/server-integration-broker-child.mjs
pnpm exec prettier --check packages/server/test/server/server-integration-broker-cross-process.test.ts packages/server/test/server/server-integration-broker-child.mjs
git diff --check
```

## Results

- The generated build completed successfully after Protobuf generation.
- The focused Vitest run produced one expected RED failure in 481 ms:
  `producer fixture failed: Wave 13 requires
createZeroMqTransportFactory(ZeroMqConfig).`
- Child syntax, fixture formatting, and whitespace diff checks each exited 0.
- The static forbidden-shortcut audit confirmed the child requires
  `createZeroMqTransportFactory`, `ZeroMqConfig.create`,
  `withGeneratedRegistryRoot`, version 3 metadata, and ordinary
  `eventBus().post()`; it contains no `ExternalMessage`, `ContextTransport`,
  or forwarder implementation.

The test is intentionally RED on this branch. Product-green evidence belongs
to the later integration owner and must use the same unmodified fixture.
