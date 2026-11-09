# Fieldnotes reference

Human entry point: [README](README.md). Detailed behavior and deployment:
[user guide](USER_GUIDE.md). Domain diagram:
[event storming](docs/event-storming.svg).

## Purpose and domain

Fieldnotes demonstrates authenticated private data in a single-tenant web
application. Keep one `PlaceAggregate` and one `PlaceViewProjection`. A Place
contains its typed `PlaceId`, name, coordinates, author `UserId`, one Markdown
string, revision, creation timestamp, update timestamp, and removal marker.
An empty note is valid. Equal coordinates do not imply equal identity.

The five Commands and Events are distinct generated domain messages:

| Command         | Event             |
| --------------- | ----------------- |
| `AddPlace`      | `PlaceAdded`      |
| `RenamePlace`   | `PlaceRenamed`    |
| `MovePlace`     | `PlaceMoved`      |
| `EditPlaceNote` | `PlaceNoteEdited` |
| `DeletePlace`   | `PlaceDeleted`    |

`PlaceUnavailable`, `PlaceAlreadyExists`, `PlaceRevisionConflict`, and
`InvalidPlaceCoordinates` are domain rejections. Do not replace them with
state messages or generic framework payloads in fixtures.

## Source map

| Path                                    | Responsibility                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `model/proto/`                          | Authored domain Protobuf contracts                                                 |
| `model/generated/`                      | Ignored generated schemas and query APIs                                           |
| `server/src/place-domain.ts`            | Aggregate transitions and complete-result Projection                               |
| `server/src/fieldnotes-host.ts`         | Sequential storage, native server and browser gateway lifecycle                    |
| `server/src/host-settings.ts`           | Explicit deployment inputs and secret validation                                   |
| `server/src/fieldnotes-access.ts`       | Gateway request policy and trusted actor resolution                                |
| `server/src/fieldnotes-read-filters.ts` | Principal-based state and outcome filtering                                        |
| `server/src/reader-proof.ts`            | jose implementation of existing reader-proof SPI                                   |
| `server/src/auth-routes.ts`             | Exact auth HTTP admission, session bootstrap, exchanges and logout                 |
| `server/src/direct-oidc.ts`             | Persistent direct-Google flow and application-session issuance                     |
| `server/src/firebase-auth.ts`           | Official Admin lifecycle and verified Google identity checks                       |
| `server/src/main.ts`                    | Configured Node host entry point                                                   |
| `server/src/fieldnotes-process.ts`      | One process shutdown path                                                          |
| `server/test/`                          | Domain, host, privacy, and infrastructure tests                                    |
| `web/src/private-relay.ts`              | Fixed route allowlist, streaming, cancellation, cookie and redirect forwarding     |
| `web/src/public-config.ts`              | Selected public browser settings without host secrets                              |
| `web/src/browser-auth.ts`               | Browser PKCE, app-session bootstrap and credential-bound authentication requests   |
| `web/src/browser-lifecycle.ts`          | Identity lifecycle and suppression of work from a previous sign-in                 |
| `web/src/firebase-browser.ts`           | Official Firebase popup login with in-memory provider state                        |
| `web/src/place-collection.ts`           | Complete byte-key traversal, live revision merge and terminal removal tracking     |
| `web/src/native-places.ts`              | Authenticated Connect client, canonical author topic and query page adapter        |
| `web/src/place-commands.ts`             | Distinct Commands, selected outcomes, resulting-view wait and subscription cleanup |
| `web/src/workspace-state.ts`            | Committed selection, independent drafts and explicit save/conflict states          |
| `web/src/place-workspace.tsx`           | Signed-in screen and lifecycle of the private client and workspace state           |
| `web/src/place-panels.tsx`              | Saved-place list, detail panel and distinct editing forms                          |
| `web/src/mobile-panels.tsx`             | Responsive shadcn/Radix Sheet navigation for places and details                    |
| `web/src/place-map.tsx`                 | MapLibre resources, selectable markers and coordinate selection                    |
| `web/src/safe-markdown.tsx`             | Maintained UIW editor and saved-note rendering                                     |
| `web/src/safe-markdown-policy.tsx`      | Shared sanitized preview and non-loading external-image behavior                   |
| `web/src/ui/`                           | Reused shadcn components and their local styling utility                           |
| `web/src/app/auth/[...path]/route.ts`   | Node-runtime authentication proxy route handlers                                   |
| `web/src/app/spine/[...path]/route.ts`  | Node-runtime application RPC proxy route handlers                                  |
| `docs/event-storming.svg`               | Domain interactions and separate technical auth band                               |

## Domain invariants

- Derive the author from the admitted Command actor; never accept an author
  field as editable application data.
- Check author and active state before checking the expected revision.
- Unknown, removed, or foreign mutation targets return `PlaceUnavailable`
  without their current data or revision.
- An active same-author `AddPlace` collision returns `PlaceAlreadyExists`;
  a removed ID cannot be reused.
- Use the Entity version as the source of accepted revision increments and
  trusted server time for timestamps.
- Every Event carries complete resulting facts. The Projection accepts only
  a newer complete result and retains immutable author and creation time.
- A deletion clears current display fields, retains its author/revision
  marker, and is terminal for that ID. This is not historical erasure.
- Ordinary handlers return generated domain messages. Do not construct
  framework Command/Event envelopes, control transactions, or materialize
  handler metadata in the application.

## Request boundaries

The Node host assembles the single-tenant environment and Bounded Context.
Next.js serves the interface and proxies same-origin application routes.
Both processes share loopback networking: the proxy accepts only the configured
`http://127.0.0.1` upstream and the host binds its gateway to loopback.
Do not create a second `ServerEnvironment` in the UI process.

The gateway admits only the five Commands, author-scoped `PlaceView` queries,
the canonical author-only Entity subscription target, permitted domain
outcomes, and validated subscription handle operations. Reject tenant-bearing
requests, arbitrary Aggregate/system/App Query targets, forged actors, and
foreign handles. Native service calls require the configured reader proof.

State/outcome filters use the verified principal, not a caller-supplied actor.
Require the author predicate before storage selects bounded query candidates;
post-selection filtering alone can omit permitted records behind foreign ones.

Entity subscription targets must retain the author predicate but allow its
removal markers. Do not substitute a broad target with a UI-side filter:
raw controls may contain identifiers even when message content is hidden.
Privacy tests must inspect the wire updates and controls.

## Collection cursor

`PlaceView.place_key` is opaque UTF-8 bytes of `PlaceId.value`, derived by the
Projection with standard `TextEncoder`. Keep the typed ID as entity identity.
Do not normalize Unicode, restrict the ID alphabet, hash or truncate the key.
Every accepted revision, including a removal marker, retains these bytes.

Generated queries support unsigned byte ranges and ordering. Use
`QUERY_SERVICE_MAX_RESULTS` from the public core package as the existing
per-request capacity, and traverse author+active queries with an optional
`placeKey > cursor` predicate until an empty page. Preserve exact canonical
Target checks and the author-only live subscription.

Use `Uint8Array` content equality, detach retained cursor bytes, and verify a
returned key against UTF-8 encoding of its typed ID. Derive continuation from
the raw returned page before merging live updates. An empty bounded reconnect
response is a scan trigger, not a complete empty collection. Revision merging,
terminal removal IDs, and principal/generation fences govern reconciliation.

Terminal IDs are retained for the lifetime of that authenticated collection,
including across rescans, and cleared on collection close. Memory therefore
includes IDs removed during that lifetime as well as active records. An empty
query is not a stream watermark: it cannot prove that an older buffered state
will never arrive. Do not reclaim these IDs merely because a scan omits them.

Large-collection proof uses PostgreSQL BYTEA ordering, including accent and
BMP/supplementary Unicode boundaries. Do not substitute JavaScript string
comparisons or claim equivalent large-query behavior for every storage provider.
MySQL variable-BLOB sorts may raise the existing record-evaluation budget error when
an exact limited prefix cannot be established within that budget.

## Persistence

PostgreSQL supplies domain records, persistent opaque application sessions,
and durable subscription bindings. The direct Google launch also persists OIDC
flow transactions and one-use grants. Authentication identity comes from the
selected provider; Firebase is not the Place database.

Keep stable deployment secrets and storage placement across restarts.
Persistent factory calls prepare/check structures by default. Database and
user provisioning are external. Do not add a tenant index to this example,
reset a configured database, or add migration/compatibility paths.

Infrastructure tests provision a unique schema and remove only that schema
following resource closure. The ordinary test suite must not silently skip
an environment-dependent PostgreSQL test; keep it in the explicit
infrastructure inventory.

## Authentication semantics

Both provider launches issue the same persistent opaque application-session
strategy. Direct Google uses the existing verified OIDC flow. Firebase uses
the official browser SDK and Admin verification with explicit project,
Google provider, revoked-token, and recent-authentication checks.

Provider-qualified identifiers are distinct. Do not link by email or present
provider revocation as immediate revocation of an existing app session.
Logout revokes before reporting success, then clears browser session state;
stop local protected streams best effort. Do not claim distributed logout.

Origin, method, content type, and non-simple header checks protect login
start/exchange. Authenticated RPC and logout use credential-bound cookie CSRF.
Do not log callback/grant URLs, verifiers, tokens, credentials, or secrets.
Required policy values remain explicit; do not add application defaults for
limits, timeouts, retries, or cleanup schedules.

Return 401 for Firebase's unambiguous invalid-ID-token, expired-token,
revoked-token, disabled-user, and absent-user error codes. Operational errors
and the ambiguous `auth/argument-error` return 503. Admin 14.5.0 uses that same
code for some malformed tokens, invalid signatures or claims, and public-key
retrieval failures; it does not retain a typed cause that distinguishes them.
Some invalid tokens therefore receive 503. Preserve official Admin verification
and avoid message matching or duplicate JWT verification. Neither refusal
exposes the SDK error or issues a session. Track admitted exchange work through
shutdown and reject late session issuance after route cancellation.
A finite session-bootstrap request must release its authentication monitor
when it finishes without revoking the reusable application credential.

## Authentication routes

The same host session strategy serves both authentication routes and the
gateway. Its public auth routes are selected at startup:

| Method and path                | Mode          | Purpose                                                                             |
| ------------------------------ | ------------- | ----------------------------------------------------------------------------------- |
| `POST /auth/session`           | Both          | Resolve the app cookie and return the current principal.                            |
| `POST /auth/logout`            | Both          | Revoke the app session before clearing its cookies.                                 |
| `POST /auth/google/start`      | Direct Google | Start the persisted OIDC transaction with the browser's PKCE challenge.             |
| `GET /auth/google/callback`    | Direct Google | Validate the provider response and return a grant in the fixed completion fragment. |
| `POST /auth/google/exchange`   | Direct Google | Redeem that grant with the retained browser verifier.                               |
| `POST /auth/firebase/exchange` | Firebase      | Verify the Firebase Google ID token and issue the app session.                      |

All POST routes require the exact public Origin, JSON, and
`x-fieldnotes-auth: 1`. Session bootstrap and logout also require the
credential-bound CSRF header/cookies. Bootstrap uses POST because same-origin
browser GET requests may omit Origin. Do not synthesize Origin in the proxy.
The provider callback is the sole route allowing a missing Origin; its OIDC
validation remains required. Session responses must be non-cacheable and must
not expose credential material.

## Explicit maintenance

`FieldnotesHost.purgeExpired(cutoff: Timestamp)` delegates to persistent app
sessions and the selected direct-Google flow store. It returns `sessions` and,
when Google mode is selected, `google.transactions` and `google.grants` counts.
The supplied cutoff must be current or earlier. There is no background cleanup
timer, public purge route, or default schedule. Application maintenance invokes
this API explicitly; authentication expiry does not wait for cleanup.

## Browser semantics

Keep draft text and its starting revision separate from the latest committed
PlaceView. Live updates must not advance that draft revision. Reapplying against
a newer revision requires an explicit action after the saved value is visible.
Observe outcomes
before posting and reconcile the corresponding committed revision before
reporting saved state. An admission acknowledgement alone is not saved state.
Preserve drafts on conflict/network failure and never reveal one principal's
cached data or draft after another signs in.

The initial query and live subscription can race. Revision reconciliation and
terminal removal tracking must prevent old query results from restoring a
removed place. Complete the keyset scan through its final empty page; the
QueryResponse wire has no continuation token.

Use MapLibre/OpenFreeMap without a map API key. Preserve attribution, dispose
map resources, and keep private Markdown out of map-provider requests. Use
reused shadcn components, maintained Markdown parsing/rendering, sanitized GFM
preview, and non-loading external-image rendering. Apply the same Markdown
policy to saved display and editor preview.

## Browser transport

`deploy/Caddyfile` supplies the HTTP/2 public ingress for local development and
production. Next runs on loopback HTTP behind it. Keep all browser application
requests on that public origin; HTTP/1.1 connection exhaustion can prevent a
Command or logout from reaching the host while subscriptions are active.
Per-command outcome selection does not remove this multi-tab requirement.

The ingress reads `FIELDNOTES_PUBLIC_ORIGIN`, `FIELDNOTES_BIND_ADDRESS`,
`FIELDNOTES_NEXT_ADDRESS`, `FIELDNOTES_TLS_CERT`, and `FIELDNOTES_TLS_KEY`.
Caddy 2.11.4 is the tested version. Retain unknown-length streaming responses
and downstream cancellation. Do not configure negative `flush_interval`,
response buffering, added stream deadlines, or callback-query access logging.
Retain the global runtime log filters for request URI and headers: disabling
access logging alone does not remove them from upstream-failure error logs.
Browser acceptance must verify negotiated `h2`, Commands with concurrent
subscriptions/tabs, and teardown through the actual ingress.

## Map worker assets

The map selects the MapLibre worker from the installed package with a module URL
before creating a map. Next emits that worker as a versioned same-origin asset
during development and production builds. The web package keeps MapLibre's
upstream license notice in `public/maplibre-gl-LICENSE.txt`.

## Map package types

MapLibre's declarations refer to the upstream `GeoJSON` global namespace.
The web workspace explicitly installs `@types/geojson` so pnpm's dependency
isolation does not hide those declarations, and enables `allowUmdGlobalAccess`
in its local bundler TypeScript configuration. Keep this accommodation local
to the web project. Application strictness and library checking remain enabled;
do not introduce a replacement GeoJSON declaration.

## Markdown rendering

Use the official `@uiw/react-md-editor/nohighlight` export for both the editor
and saved display. It retains the maintained editor and preview without syntax
highlighting or the default raw-HTML processing path. Keep `skipHtml` and
`rehype-sanitize` in the shared preview options, and render images as
non-loading alternative-text placeholders. Ordinary links retain the safe URL
handling and referrer policy. Exercise the actual renderer in component tests
and check image requests in the browser; a policy-object assertion alone does
not prove Markdown rendering behavior.

## Editor package declarations

The workspace pins UIW's editor and applies
`patches/@uiw__react-md-editor@4.2.3.patch` to its published declarations.
Those declarations retained imports for absent source `.less` files and gave
`className` an optional type inconsistent with React under
`exactOptionalPropertyTypes`. The patch removes only those declaration imports
and derives that property type from React. Runtime JavaScript and CSS are
unchanged. Keep library checking enabled; do not replace the editor's types
with ambient stubs. Reassess the patch when updating the pinned editor.

## Review and evidence boundaries

Run focused domain and raw Connect privacy checks, PostgreSQL persistence
checks, both local provider flows through the actual Next proxy, and real
browser interactions. Local OIDC and Firebase Auth Emulator acceptance do not
prove a live cloud account sign-in. Report this distinction accurately.

Keep the three human/agent documents, app settings, route implementations,
SVG, and PR examples aligned. Detailed review logs and execution evidence stay
outside Git; the repository task file records current requirements and
remaining work.

## Generated Next route types

The web typecheck script removes stale generated `.next/dev/types` before
running `next typegen` and the strict application typecheck. Development and
production runs can generate different route-type files; this preparation
keeps a later build from consuming an obsolete development copy. Use the
package scripts and stop the development server before a production build.
Authored routes and maintained TypeScript settings are not removed.
