# M02 TypeScript/API review

Scope: changed Command/Event admission contracts, public validation lookup, Ack error representation, related tests and current API documentation against `3227be3ac`, including the untracked registered-module test. Existing `typescript_api_docs_reviewer` role, explicit `gpt-6-sol` / `medium` dispatch; runtime self-introspection was not exposed. Production and tests were frozen for this review.

## Actionable finding

### P1 — A decoded default Command payload can reach a dispatcher

`packages/server/src/bus/command-errors.ts:95-100` treats any nonempty `Any.typeUrl` as a nondefault Command message. After unpacking, `packages/server/src/bus/command-bus.ts:283-302` checks declared constraints and implicit IDs but does not reject a decoded domain message equal to its schema default. The JVM `CommandValidator.ViolationCheck.validateMessage()` checks `isDefault(command.message())`, and `CommandEnvelope.message()` returns the *enclosed decoded Command message*, so its rule is not satisfied by a populated `Any` type URL alone. This also contradicts the new `packages/server/REFERENCE.md:852-853` claim.

The existing meaningful `CreateNumberedProject` Command fixture (`packages/server/test-fixtures/proto/repository-routing/project_commands.proto:37-40`) demonstrates the gap: its first field is `int32`, so `ImplicitRequiredIds.supported()` does not add an ID rule; it has no declared field constraints. Packing `create(CreateNumberedProjectSchema)` produces a known type URL and a default decoded payload, which `Validate.check()` accepts. A custom Command dispatcher can then run. Check the decoded payload for its schema default after successful unpacking and before `onAdmit`/dispatch, return a `CommandValidationError` with structured details, and add a direct-bus and service Ack regression using this fixture. Retain the declared-constraint and technical-error distinctions.

## Other reviewed contracts

No other P0–P2 finding. Command envelope checks precede route selection and custom dispatch; missing ID and context produce field-addressed `ValidationError` details. Service mapping uses enum-qualified `spine.core.CommandValidationError`, numeric `INVALID_COMMAND`/`UNSUPPORTED_COMMAND`, and packed details for constraint failures, while technical faults retain the technical Ack path. Event envelope and domain payload validation precede admission, storage and delivery without adding undeclared `EventContext` recursion. The default generated-module lookup remains behind the optional existing `TypeRegistryLookup` parameter, and the new registered-module test exercises it without a caller-supplied lookup. The affected Proto fixtures represent Commands and Events rather than reused wire-compatible types. Query and subscription conversion belongs to M03.

No P3 observations. The orchestrator supplied the passing 243-test, generated build, cheap-check, coverage, and installed packed-consumer evidence; this bounded review did not rerun those checks.

## Targeted P1 correction confirmation

**Resolved.** `CommandBus.#validatePayload()` now decodes against the registered Command schema and rejects `equals(schema, message, create(schema))` before declared-constraint checks, tenant admission, or dispatch (`packages/server/src/bus/command-bus.ts:298-323`). Its field-addressed `CommandValidationError` follows the existing service conversion to enum-qualified `spine.core.CommandValidationError`, numeric `INVALID_COMMAND`, and packed `ValidationError` details. The direct bus regression uses the domain-correct `CreateNumberedProject` schema and proves neither admission nor custom dispatch runs (`packages/server/test/bus/command-bus.test.ts:200-228`). The service regression checks the Ack type, code, `message` field path, and absent dispatch (`packages/server/test/services/spine-services.test.ts:1894-1919`). This closes the JVM decoded-default rule and the server REFERENCE claim. No remaining blocker in this targeted API concern.

The orchestrator supplied 245/245 focused tests and passing generated build and cheap checks after correction; this confirmation inspected the changed source and tests without rerunning them.
