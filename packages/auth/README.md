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

The package exposes contracts only in B1. Request forwarding, concrete session
strategies, OIDC providers, and browser integration are deferred to later Wave
4 slices. The shared `AuthenticationService.ResolveContext` Protobuf service
returns informational actor, tenant, and expiry data; it is not a credential
and every later request is independently authenticated and authorized.
