# B1 Implementation Report — Auth Contract Foundation

## Scope delivered

- Added `@spine-event-engine/auth` with exhaustive `IncomingRequest` facts for
  command, query, subscribe, activate, and cancel.
- Added credential-excluding allowlisted transport facts and provider-neutral
  authentication, session, authorization, trusted-context, clock, and decoder
  seams.
- Added optional Wave 3 `TypeRegistryLookup` decoding for packed commands.
  Unknown or malformed `Any` values safely remain type-URL-only facts.
- Added `spine.auth.AuthenticationService.ResolveContext`. Its request has no
  credential field and its response contains only informational actor, tenant,
  and expiry data.
- Extended Proto provenance validation to checksum-pinned Spine TS-owned
  contracts without fabricating upstream JVM provenance. The frozen descriptor
  checksum and generated manifest now include the auth contract.

## TDD evidence

- RED: `packages/auth/test/incoming-request.test.ts` initially failed because
  the auth package did not exist.
- GREEN: the focused auth test passes for all five request kinds, allowlisted
  transport facts, registered packed message decoding, and unknown/malformed
  `Any` handling.
- RED: `scripts/verify-proto-sources.test.mjs` initially rejected a checksum-
  pinned Spine TS-owned contract as absent from copied-source provenance.
- GREEN: the verifier accepts the explicit owned-source checksum while retaining
  copied-source provenance validation.

## Focused verification

- `pnpm --config.link-workspace-packages=true proto:generate` passed: 40 source
  checksums and 49 descriptor files.
- `pnpm --config.link-workspace-packages=true typecheck:build:generated` passed.
- Focused Vitest passed: 3 files, 10 tests.
- `pnpm --config.link-workspace-packages=true format:check` passed.
- `git diff --check` passed.

## Limits

B1 does not forward RPCs, rewrite context, persist or validate sessions, handle
cookies/bearers, implement OIDC/providers, establish subscription bindings, add
React/Chat/Envoy work, or run any Spine JVM operation.

## Review correction evidence

- `@spine-event-engine/proto/auth` is now frozen and resolved by the canonical
  entrypoint test.
- `@spine-event-engine/auth` is now a TypeDoc entrypoint with an exact checked
  public-export inventory.
- Regression coverage rejects malformed outer Query/Subscribe/Activate/Cancel
  envelopes and proves their decoded target/context facts.
- README wording now accurately locates optional model-registry decoding on the
  command `IncomingRequestInput` variant.
- Fresh focused evidence passed: `docs:check`, generated build typecheck, four
  focused test files / 15 tests, formatting, and `git diff --check`.

## Full-gate mechanical correction

- Updated frozen package metadata and Proto module expectations for the auth
  subpath and its two generated request/response schemas.
- Fresh evidence passed: six focused test files / 21 tests, generated build
  typecheck, docs/API checks, formatting, and `git diff --check`.

## Coverage correction

- Added meaningful safe-default coverage for omitted request facts and optional
  transport fields. The tests exposed and corrected undefined allowlisted
  headers becoming empty diagnostic facts; undefined headers are now omitted.
- Focused auth tests (5/5), generated build typecheck, formatting, and
  `git diff --check` pass. A one-file coverage invocation reports the global
  repository threshold and therefore cannot be used as a standalone pass gate.
