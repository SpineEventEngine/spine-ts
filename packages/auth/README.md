# @spine-event-engine/auth

Provider-neutral authentication gateway contracts for Spine services.

This package defines request facts, authentication/session/authorization and
trusted-context seams. `IncomingRequest` has one discriminated member for each
Spine service operation: command, query, subscribe, activate, and cancel.
Transport facts are allowlisted; credentials are supplied only to
`Authenticator` or `SessionResolver` and never become request facts.

The `command` variant of `IncomingRequestInput` may carry an optional Wave 3
`TypeRegistryLookup` for packed-command inspection. Unknown or malformed `Any`
values remain safe type-URL-only facts, so policies do not need application
schemas.

`UnaryGateway` is the bounded B2 transport-neutral pipeline for
`CommandService.Post`, `QueryService.Read`, and
`AuthenticationService.ResolveContext`. It bounds and decodes known request
bytes before session work, authorizes every Post/Read, rejects stale actor or
tenant hints, and replaces a matching caller `ActorContext` with a newly
constructed trusted value. The trusted timestamp is the value returned by the
context resolver, whose injected clock is available during resolution. Every
non-`ActorContext` envelope field, including unknown Protobuf fields, is
preserved byte-equivalently. Its forwarding and rejection seams intentionally do
not select a gRPC status; B4 owns native transport mapping. The forwarded
request never includes a credential and a unary request is forwarded once.

`AuthenticationService.ResolveContext` validates the application session and
returns only informational actor, tenant, and expiry data. It does not invoke a
Spine backend, it is not a credential, and every later request is independently
authenticated and authorized. Concrete session strategies, OIDC providers,
subscription binding, and browser integration remain later Wave 4 slices.
