# Old browser clients and newer Protobuf definitions

## Request and scope

2026-09-30: analysis and questions only. Local master was updated to
`9e1147298248a8e0b095bf41ecabd8d8dbb2b511`, including merged PR 13. New branch
`proto-client-compatibility` starts at that commit in the existing clean managed
worktree. No runtime, test, dependency, or version changes are authorized yet.

Investigate whether browser clients using earlier generated application schemas
can read data produced by later schemas after field renames with unchanged
numbers/types, removed/reserved fields, and removed unused enum members with
the remaining numbers/names unchanged. Establish actual binary and JSON paths,
existing tests, limits, and a minimal compatibility test plan.

## Human-Imposed Requirements Ledger

- Analyze the current implementation; explain in simple words with examples.
- Preserve field-number compatibility so older browser clients can read new
  server data without immediately updating generated application code.
- Ask concrete questions only for unresolved choices; do not implement yet.
- Do not create a new chat, PR, merge, publish, rerun publication, or edit master.
- Branch names have no `codex/`, `feature/`, or internal task-number prefix.
- Follow project model routing and independent read-only investigation rules.
- No invented wire format, unnecessary abstraction, or third-party source patch.
- Tests proposed for implementation must use meaningful domain Proto fixtures,
  with Commands, Events, and Entity states in appropriate separate source files.

## Investigation protocol

This is planning for a serialized compatibility boundary. Treat proposed runtime
contract changes as high risk if evidence shows they are needed; do not assume
JSON is used or that binary decoding alone proves application compatibility.
No baseline build is needed: the preceding verified tree differs from this
merge only by merge history. Any diagnostic is narrow and read-only with respect
to repository sources.

Skills: using-git-worktrees (reuse; read completely), systematic-debugging
(trace actual data paths before remedies; read completely). Canonical protocol
and model assignments were read in this session and are unchanged by PR 13.
The available session inventory, expected-skill manifest, and installed skill
lock were checked in the preceding task; scope-specific applicability is limited
to the two skills above. No implementation/TDD/release check is started during
analysis. Selected Desktop bundled CLI supports explicit child profiles; native
child slots remain occupied, so fresh CLI contexts may be used without history
or memories. Children must not spawn children or edit repository files.

Read-only functions dispatched by the main orchestrator:

- Browser transport and test scan: explicit `gpt-6-luna` / `medium`.
- Server-to-browser data path scan: explicit `gpt-6-luna` / `medium`.

Main Astra/high reasoning combines evidence with current official Protobuf and
library documentation. These are bounded investigation functions, not new
project roles. Actual dispatch/result evidence and the final plan follow below.

## Findings

The supplied browser clients already transfer binary Protobuf. This is not a
confirmed JSON transport defect. The missing evidence is a test using different
generated application schemas on the server and browser sides.

- `packages/client-web/src/client/client.ts:493`: `forGrpcWeb()` uses the
  installed Connect Web 2.1.2 binary default.
- `packages/client-web/src/client/client.ts:511`: `forConnect()` explicitly sets
  `useBinaryFormat: true`. An injected custom transport chooses its own encoding.
- `packages/core/src/index.ts:961`: `AnyMessages.pack()` writes binary bytes;
  `unpack()` checks the type URL and reads those bytes with the supplied schema.
  It does not translate application state through JSON.
- `packages/server/src/services/spine-services.ts:1970` and `:2112`: query rows
  and state subscription updates pack application state into `Any`. Event
  subscriptions carry the Event's packed message, including rejection messages
  (`:2150`). Browser example code unpacks with its generated schema, for example
  `examples/message-board/web/src/board-payloads.ts:146`.
- Existing client tests check transport configuration
  (`packages/client-web/test/client.test.ts:1472`) and same-schema decoding
  (`:2905`). The independent scans found no mixed-version test for the requested
  schema changes. Existing integration tests do not prove that scenario.

The message's fully qualified Protobuf name and type URL must remain unchanged.
Field numbers/types must remain unchanged and removed numbers must not be
reused. Removing a field cannot preserve a value the newer server no longer
sends. The old client instead observes its schema's absent-field behavior:
for example an empty string for an ordinary proto3 string, or absence for an
optional field. Remaining enum values decode by number, not by their names.
This does not promise that removing an enum value still present in historical
data is safe for application code or validation.

Two related boundaries are name-based:

1. Query filters and sorting identify columns by name. Subscription filters
   also identify fields by name. See
   `packages/core/src/query/entity-query.ts:1209` and
   `packages/server/src/services/spine-services.ts:1241`, `:1777`, and `:1886`.
   An old subscription filter for `title` is rejected if the new schema only
   contains `display_title`, even though response bytes remain readable.
   The `(column)` option is boolean, not a stable alternate column name
   (`packages/proto/proto/spine/options.proto:445`).
2. The default conversion for message-valued IDs and stored message columns
   uses ProtoJSON (`packages/core/src/index.ts:1047`). Renaming fields inside
   such messages can change their stored string representation or prevent
   older strings from being read. Entity state/history itself uses binary
   data; this finding must not be described as all storage being JSON.

Unknown-field forwarding is outside the requested read-only guarantee:
`AnyMessages.pack()` sets `writeUnknownFields: false`. Do not claim that an old
client can read, change, and resend new fields without losing them.

## Narrow diagnostic evidence

A read-only Node diagnostic used installed `@bufbuild/protobuf` 2.12.1 and
the existing built `AnyMessages` implementation. Two separate descriptors had
the same `library.Book` type name. Version one had `title = 1`, `shelf_note = 2`,
and an availability enum. Version two renamed field 1 to `display_title`,
reserved field 2/name `shelf_note`, and removed/reserved an unused enum member.
The remaining enum names/numbers were unchanged. The diagnostic explicitly
supplied normal generated JSON names in its descriptors.

Results for a new message with title `Dune` and availability `AVAILABLE`:

- New binary data decoded with the old schema retained `title: "Dune"` and
  the enum value. The removed ordinary string became `shelfNote: ""`.
- The same result passed through `AnyMessages.pack()` and `unpack()`.
- Actual ProtoJSON contained `displayTitle`. The old schema rejected that key.
- Ignoring unknown JSON keys did not solve the problem: the title became empty.
- Reading old JSON containing `title` with the new schema likewise failed.

This proves the local encoding behavior, not a complete browser/server test.
No project builds, test suites, Docker services, or dependency installs ran.
The implementation tests must use real, generated domain Proto sources, not
handwritten descriptors or encoded source blobs.

Primary references consulted:

- [Protobuf binary compatibility and field numbers](https://protobuf.dev/programming-guides/proto3/).
- [ProtoJSON representation and compatibility](https://protobuf.dev/programming-guides/json/).
- [Browser protocol choices](https://connectrpc.com/docs/web/choosing-a-protocol/).

## Proposed implementation sequence, pending answers

1. Add two small versions of a library-domain model as real Proto fixtures.
   Generate them separately, preserving the same Protobuf package/message
   names and field numbers. Keep Entity states, Events, and rejections in
   appropriately named files. Register only the new version on the server;
   decode only with the old version on the client. Do not combine both versions
   in one type registry.
2. Add focused compatibility tests for each requested change separately and
   together: renamed fields retain values, removed fields have the correct
   absent-field behavior, and remaining enum values retain their meaning.
   Cover a nested message and optional-field absence without creating a large
   combinatorial suite. Include a true ProtoJSON contrast demonstrating that
   ignoring unknown names is not a fix.
3. Exercise a real server/browser-client connection using the existing test
   setup, for both supplied protocols. Check query responses, live state
   subscriptions, recovery after reconnect, and Event/rejection payloads.
   Assert old-schema decoded values, not just request success. Verify that the
   transport remains binary; a mocked RPC returning in-memory messages does
   not establish network compatibility.
4. Address only defects demonstrated by those tests. If the supplied transport
   paths pass, retain their binary format. Do not invent number-keyed JSON or
   weaken JSON parsing. Filter/sorting compatibility and stored ID/column
   compatibility require the scope decisions below before designing changes.
5. Document the supported changes with old/new Proto examples, explain why a
   JavaScript object in the browser does not mean JSON was sent, and state the
   limits: stable message names/type URLs, no number reuse, absent deleted
   values, and custom JSON transports outside the binary guarantee.
6. After implementation, run the protocol's cheap checks and affected tests
   before relevant independent reviews. Choose the final verification scope
   from actual changes; a shared transport or serialized contract change needs
   release verification. Bump all packages together to the next unused snapshot
   in the required separate version-only commit before preparing a mergeable PR.

## Questions for the user

1. Must old query filters, subscription filters, and sorting continue working
   after a referenced field is renamed? For example, an old browser asks for
   books where `title == "Dune"`, but the server field is now `display_title`.
   Recommendation: include this if the intended guarantee is that the old app
   keeps working, rather than only that returned messages can be decoded.
   Already released name-based requests cannot reveal their original field
   number unless the server has information about the earlier name.
2. Should this task also cover existing stored message-valued IDs and columns?
   For example, an ID previously stored as `{"isbn":"978..."}` changes to
   `{"bookCode":"978..."}` after a rename with the same Protobuf number.
   Recommendation: keep this as a separate, explicit storage-compatibility
   task unless such renames are included in the current application upgrade.

## Investigation acceptance record

- Browser scan: fresh context `01a0f2c9-5942-77b2-9544-872e39ad8582`.
- Server scan: fresh context `01a0f2c9-5dbe-77f2-a349-5451cb9b27e5`.
- Both were orchestrator-dispatched read-only investigation functions, explicitly
  configured as `gpt-6-luna` with `medium` reasoning, Standard/default service
  tier, memories disabled, and no inherited conversation. Neither was an
  implementation or specialist review assignment. The dispatch profile was
  explicit; the CLI did not expose separate per-response model metadata or
  report fallback. Reports were accepted as bounded investigation evidence.
- Main analysis corrected potentially misleading shorthand: a removed field
  is absent/default on the old reader, not a preserved value; binary Connect
  is explicit in our client factory, not the Connect Web library default.
- Implementation and release-readiness reviews are not claimed by these scans.
  No runtime changes are ready for acceptance. Work awaits the two scope answers.
