# Vercel and Ax adapter

For developers evaluating the future Spine Agent adapter, this package proves
that Ax can generate and correct structured output while Vercel AI SDK makes
the physical model requests. To run the smallest protocol suite from the
repository root, use `pnpm exec vitest run packages/ai-vercel-ax/test/bridge.test.ts`.
It should report the protocol tests passing without credentials or network access.

This optional package is the future production connection between Spine's AI
facade and Vercel AI SDK models. It is not ready for application registration.
The current package contains a tested internal compatibility bridge: Ax builds a
native structured request and manages corrections and tool continuations, while
Vercel makes each provider request. No credentials or network access are needed
to run the protocol tests.

The bridge currently accepts text prompts, native JSON schemas, and Ax functions.
It requires a physical-request limit and awaits a caller's reservation before
sending a request. The future facade must provide validation, authenticated
selection, durable audit, byte and tool limits, recovery, and deployment factories
before applications use it.

See [REFERENCE.md](REFERENCE.md) for the tested contract and limitations.
