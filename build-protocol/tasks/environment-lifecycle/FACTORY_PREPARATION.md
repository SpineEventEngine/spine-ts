# Factory preparation contract

Accepted for milestone 4 by D-0150. These contracts are planned, not current API.

## Chosen design

Keep synchronous Storage and Entity-port construction. A SQL handle initially captures a logical destination and record definition. Resolve the application tenant settings, PostgreSQL default schema, and physical preparation asynchronously when an awaited operation or explicit preparation first needs them. Construction performs local validation only: it must neither invoke the async resolver nor start an unobserved Promise. Do not require application callers to perform a new public resolve/bind step before `createRecordStorage()`.

Add exactly the accepted public connection diagnostic and resolver methods. Add a small provider-only preparation port for existing record, Entity, and surviving Agent-audit requirements. Server enumerates immutable definitions from registered repositories and framework record definitions; it never constructs and closes Storage merely to discover or prepare requirements.

Physical preparation state belongs in each concrete factory and is shared by explicit preparation and every ordinary record handle for that destination/family. Preserve M3's retained Storage instances and D-0148 close tracking. This is not another Storage-retention registry or a generic lifecycle framework.

The last paragraph of `factory-preparation-map.md` is incorrect: the resolver itself is already approved, including asynchronous application-directory lookup. The unresolved issue was implementation shape, now settled here.

## Exact interfaces

### Application-facing additions

```ts
// StorageFactory, alongside the existing synchronous createRecordStorage().
checkConnection(): Promise<void>;

// PostgreSQL builder.
setTenantResolver(
  resolver: (tenantId: TenantId) =>
    PostgresStorageFactoryOptions | Promise<PostgresStorageFactoryOptions>,
): this;

// MySQL/MariaDB builder.
setTenantResolver(
  resolver: (tenantId: TenantId) =>
    MysqlStorageOptions | Promise<MysqlStorageOptions>,
): this;
```

Retain SQL `build(): Promise<ConcreteFactory>` to avoid unnecessary signature churn, but it completes after local assembly only. Datastore's existing synchronous builder remains synchronous. `checkConnection()` checks only the explicitly configured shared destination, without model registration, TenantIndex access, tenant enumeration, tenant resolver calls, DDL, or test writes. No tenant overload is needed for this task. Per-tenant checks happen inside preparation and normal awaited operations.

`setOptions` supplies the shared existing database, including single-tenant Entity storage and shared framework records. It is required for SQL assembly under the new environment contract, even when tenant options/resolver are present. `setTenantOptions` remains the finite-list alternative to the resolver; reject configuring both tenant options and a resolver. Remove the old prohibition on combining shared options with tenant settings. Static entries remain available to the existing finite provider catalog; a dynamic resolver does not become an enumerable catalog. Dynamic persistent membership requires the already-approved application TenantIndex.

No new Bounded Context public methods beyond the accepted runtime methods are introduced. The existing proposal defines runtime/environment `createStorageStructures(...tenantIds)` and `checkStructureCompatibility(...tenantIds)`, both returning `Promise<void>`.

### Provider-only preparation

Export the following only through `@spine-event-engine/storage/provider`, using the existing factory-registration pattern. The names below are the chosen implementation contract, not an invitation to build a capability catalog.

```ts
type StoragePreparationMode = "create" | "check";

type EntityStoragePreparationInput<I, S extends Message> = Omit<
  EntityStorageInput<I, S>,
  "stateHistoryStorage" | "eventHistoryStorage"
>;

interface StoragePreparation {
  prepareRecord<I, R extends Message>(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    group: StorageGroup | undefined,
    mode: StoragePreparationMode,
  ): Promise<void>;

  prepareEntity<I, S extends Message>(
    input: EntityStoragePreparationInput<I, S>,
    mode: StoragePreparationMode,
  ): Promise<void>;

  prepareAgentHistory<I>(
    input: AgentHistoryStorageInput<I>,
    mode: StoragePreparationMode,
  ): Promise<void>;
}

// Same style as EntityCommitStorageFactories; no public root export.
StoragePreparations.register(factory: StorageFactory, preparation: StoragePreparation): void;
StoragePreparations.for(factory: StorageFactory): StoragePreparation;
```

The Entity method exists because a custom coherent Entity provider may select different structures from ordinary record customization. It covers current state, enabled state history, enabled diagnostic Event history, and any actual provider-private structures required by that implementation. The Agent method covers mandatory surviving audit only, using the already-existing AgentHistoryStorageInput; no Agent execution, claim, replay, or recovery preparation contract is added. EventStore and shared Inbox/shard/subscription records use `prepareRecord` with their real specs. Framework EventStore requirements are explicitly included wherever their actual runtime uses them; do not assume an Entity's event-history flag enumerates the Event Bus store.

All three methods are async and prepare definitions without Storage acquisition. Each concrete provider can factor shared physical-definition functions internally; its creator and preparer must use the same functions and the same custom registration selection rules. No preparation method takes an existing Storage handle.

An unimplemented base `StorageFactory.checkConnection()` rejects with a clear unsupported-operation error after checking the close fence. An unregistered `StoragePreparations.for(factory)` rejects clearly. Never default these to successful no-ops for an unknown custom adapter. Memory deliberately supplies local implementations. Test adapters must deliberately implement/register supported behavior; an explicit no-external-structures implementation is valid when true.

## SQL binding and resource lifetime

1. `createRecordStorage` performs source/group/table-name and local spec validation, clones the tenant identity, and returns a closeable logical handle. The provider Entity ports similarly retain logical record handles. No pool or resolver work is required by synchronous construction.
2. A private factory destination operation coordinates one pending resolution for a complete TenantBoundary. Shared storage uses captured `setOptions`; tenant storage uses the configured static entry or awaits the resolver with a defensive TenantId copy. Tenant membership is a server responsibility, not a factory responsibility.
3. Before database use, parse/copy the returned options, enforce configured tenant destination separation, connect read-only, and resolve the existing schema/database. PostgreSQL must preserve its current-schema behavior; assuming `public` at construction is incorrect. Missing databases/schemas fail; no CREATE DATABASE/SCHEMA is permitted.
4. Publish a resolved destination only after the read-only destination check and cleanup succeed. Share concurrent first attempts. Failed resolution/options/connection attempts clear only their pending state so later valid input can retry, including rerunning the application resolver. A failure in a later table requirement does not discard a successfully resolved destination.
5. Successful tenant binding is stable for the factory lifetime. Later directory membership changes remain visible to admission; silently remapping retained Storage to a different database does not. Live destination/credential remapping and cache invalidation APIs are excluded. Application code replaces/restarts the factory to deliberately change a successful binding. The resolver is not an authorization check.
6. Explicit check/preparation uses a temporary connection source unless a runtime pool already exists. Always release the client and end a temporary pool in `finally`; do not retain one idle pool connection per enumerated tenant. Cache connection/schema evidence and options, not a temporary socket. Do not discard a shared runtime pool to perform diagnostics. Actual business use may create/reuse the normal configured pool for that destination; respect existing application options and add no new artificial pool caps or timeouts.
7. A PostgreSQL logical handle's async entry points await destination/table binding before SQL, transaction-client operations, or a qualified table identifier is used. Its package-local synchronous helpers can require an already-bound destination; they are never a new application precondition. MySQL follows the same rule even though its table name can be computed locally. A deferred delegate, if used, must be private and retained once, not recreated per operation.
8. Closing an unused logical handle creates no pool. Synchronous record close fences future operations. Factory close immediately fences resolver/check/preparation admission, then awaits all already admitted destination/preparation work before draining pools under D-0148. A pending attempt cannot add a late untracked pool or resurrect a closed handle. A Bounded Context close retains its admitted preparation until settled; it does not close the shared factory. Cleanup failures are observable and all acquired resources are attempted.

A single factory deduplicates physical preparation by canonical configured endpoint/database and resolved schema/table. Credentials and options are sensitive and never diagnostics. Distinct connection principals must not borrow each other's successful authorization proof. Preserve existing normalized-target collision validation; do not claim DNS aliases can always be recognized as one server. Do not add cross-factory global caches.

Distinct tenant databases remain the SQL isolation contract: reject two distinct tenants resolving to the same configured physical database. The shared destination may reuse an existing database, including a tenant database, when its required physical record families are disjoint. If shared and tenant logical scopes would map the same family to the same unpartitioned table, reject that collision instead of mixing records. Generic StorageContext names remain diagnostic. EventStore explicitly derives a stable StorageGroup from its context name and domain/System role under D-0160; its construction, atomic provider writes, reads and preparation use that same group. Entity families and shared Inbox keys do not gain a context namespace. Existing source/group/record layout rules still apply.

## Preparation state and races

Connection success is independent from each physical family requirement. A requirement identity includes physical destination, source and record types, group/table mapping, ID representation, and complete canonical physical layout (columns/nullability/defaults/keys and provider requirements). Object identity and tenant-only booleans are insufficient. Reject conflicting definitions for one physical table; do not treat a previous different layout as success. Custom DDL configuration is fixed with the factory.

For each physical family retain a pending attempt and separately recorded successful creation and successful compatibility evidence. Both modes establish the same provider-declared structural requirements for the supplied definition. For SQL, creation means create-if-absent followed by required inspection; compatibility means inspection only. For a schemaless provider with nothing to create, both modes perform the same applicable validation. These guarantees are documented alongside the concrete provider; this does not introduce a public requirement/capability catalog. Creation success implies compatible readiness for that same requirement set. A successful check is sufficient readiness even when creation has never run. An ensuing explicit create or ordinary use may return that already-satisfied result without issuing DDL or falsely claiming that DDL ran. If a requirement in that set cannot be established, both modes reject and neither records successful readiness; create cannot certify a requirement that check would reject as unsupported.

| Existing state         | `check`                           | `create` or first ordinary use           |
| ---------------------- | --------------------------------- | ---------------------------------------- |
| Compatible success     | Return remembered success         | Return remembered success; no DDL        |
| Creation/check pending | Await same attempt                | Await same attempt                       |
| No success/pending     | Inspect only                      | Create-if-absent, then inspect           |
| Attempt rejects        | Reject all waiters; clear pending | Reject all waiters; later call may retry |

Do not escalate a pending check into creation. A create caller that joined a failed check receives that failed attempt; its next call may create. A check may await independently requested creation but cannot start it. Do not leave PostgreSQL's currently rejected `#ready` Promise permanently cached. There is no background preparation retry loop. Existing narrowly required provider transaction-conflict handling is not a license for a new retry budget.

PostgreSQL: extract/reuse the current canonical table inspection, retain advisory coordination for creation, run inspection without CREATE or custom operation-factory calls in check mode, and release the temporary transaction client on every path. MySQL: split `createAndInspect`, reuse the same column/key/index/engine checks, and move handle-local ready state to the factory's physical-family entry. Do not acquire an operation connection merely to wait for another handle's initializer; that can exhaust a pool before preparation gets a connection.

Read-only success is remembered evidence, not a guarantee against external later alteration or that every future data-dependent operation/query will succeed. The same limitation applies to create success. Do not silently invalidate readiness and issue corrective DDL in response to ordinary query failures. Such failures remain operation failures; schema migration/repair is out of scope.

## Requirement enumeration and later runtime integration

Server keeps a private collection of preparation callbacks built from immutable, typed definitions. A callback accepts the selected StorageContext, mode, and provider preparation port; it closes over a concrete RecordSpec or declarative Entity input. This preserves generic types without inventing a heterogeneous public requirement manifest or casting arbitrary domain messages into one generic storage schema.

Repository assembly contributes its current Entity spec and captured history policy; an Agent additionally contributes its surviving audit input. Framework modules contribute the same pure spec-building functions their actual Storage constructors consume. Enumerating requirements never calls `createRecordStorage`, custom creators, model handlers, directory resolvers, or application callbacks that extract values from records. Do not create dummy Protobuf records to discover schemas.

Shared setup requirements and each Bounded Context's requirements remain distinct. Shared Inbox and shard storage always select the single-tenant shared destination. A first tenant input prepares that Bounded Context's shared dependencies and the selected tenant's full model requirements, not every indexed tenant. Monitoring prepares only its shared registry dependencies.

Runtime/environment operations subsequently use this port exactly as PROPOSAL sections 8–9 require: capture fully built/open Bounded Contexts, validate all explicit IDs across effective live indexes before any resolver or structure action, skip excluded overrides, enumerate no-argument requests in pages, include single-tenant Bounded Contexts, and retain selected runtimes during admitted preparation. No factory membership lookup, implicit keep, or resolver-based enumeration.

For late model registration, add its definitions before that registration becomes usable and mark the applicable model set incomplete. Previously compatible families remain valid; only new/different requirements need work. Eager registration awaits those additions; deferred registration gates the next affected input. If an internal registration path is still synchronous, install its pending readiness gate before exposing new routes rather than claiming eager success. An environment call retains the completed model set captured at entry; subsequent additions prepare through their registration/lazy path. An unfinished build reservation does not count as a completed model. No permanent Bounded-Context/tenant readiness boolean may skip late definitions.

M4 supplies the provider seam and pure requirement definitions; M8–M11 wire approved environment/runtime entrypoints. Do not pull unrelated admission, registration, Agent-removal, or Delivery work into M4 merely to exercise the provider contract.

## Memory and Datastore

Memory: connection check succeeds locally while open. Preparation validates the same record-family identity and schema constraints as its normal backend binding; it needs no remote schema creation. Use pure definition validation or backend definition metadata, not throwaway InMemoryRecordStorage. A check must not create application records or register a tenant.

Datastore keeps its supplied client and native namespaces. No SQL pool, tenant-to-database resolver, SQL tables, fake schema rows, or framework-provisioned indexes are introduced. `checkConnection` performs a real read-only SDK request against the configured client/shared scope and remembers success; it cannot certify arbitrary write/index permissions. Do not close the application-supplied client because a check or Bounded Context ends. Use an existing metadata/read operation, without a full namespace scan or introducing an arbitrary limit.

Built-in Datastore create and check modes establish the same narrow compatibility facts: valid kind mapping, namespace conversion/collision rules, ID/stringifier/layout requirements ascertainable from the supplied definitions, and read connection access. A nonexistent kind is valid because kinds have no separately created schema. Both modes can therefore succeed without creating any remote structure or sentinel data, and either success satisfies the same remembered readiness. Do not make native check universally unsupported after allowing native create to succeed.

Datastore compatibility does not certify deployed composite indexes, write permissions, the contents of every stored record, or every future query combination. Its existing `RecordLayout` declares only a kind; `RecordSpec` declares record/ID/column mapping, not a complete application query/index manifest. Composite indexes remain explicit application deployment prerequisites. This includes the known retained-history query shapes and the three surviving Agent-audit indexes supplied in `packages/storage-datastore/index.yaml`, as well as application-specific combinations. Document that preparation does not verify their deployment or readiness. Missing-index errors from actual queries remain honest operation failures; do not manufacture readiness probes using fake business records, deploy indexes, or substitute a full compatibility promise. Existing recovery-only index entries belong to M7 removal and are not new M4 requirements.

A custom provider may declare stronger structural requirements through the contract documented for its preparation callback. If it cannot prove a requirement it claims to cover, both create and check reject without caching success. Missing custom preparation support continues to fail clearly in either mode. This keeps the common state table coherent without adding a provider-specific readiness state or weakening an unsuccessful check into success.

Preserve custom registration selection exactly: ordinary record exact/fallback creators differ from built-in generated Entity records, which currently bypass ordinary record creators; a custom coherent Entity creator replaces its whole Entity bundle. Namespace converters and stringifiers are not silently imposed on custom implementations that previously handled those themselves.

Extend existing custom creator registrations with optional trailing preparation callbacks; when a selected custom creator has no callback, its preparation rejects explicitly before invoking the creator. Keeping these arguments optional preserves standalone creator construction; it does not promise preparation support.

```ts
type PrepareDatastoreRecordStorage<R extends Message = Message> = <I>(
  context: StorageContext,
  spec: RecordSpec<I, R>,
  client: Datastore,
  mode: StoragePreparationMode,
) => Promise<void>;

type PrepareDatastoreEntityStorage<S extends Message = Message> = <I>(
  input: EntityStoragePreparationInput<I, S>,
  client: Datastore,
  mode: StoragePreparationMode,
) => Promise<void>;

// Append to both existing useRecordStorage overloads:
// (...existingArguments, preparation?: PrepareDatastoreRecordStorage<R>): this
// Append to existing useEntityStorage:
// (sourceType, creator, preparation?: PrepareDatastoreEntityStorage<S>): this
```

Each registration already selects its family, so the callback need not receive a generic custom layout object. The callback and creator share application-managed readiness as necessary. `check` must perform no writes and must ensure later use does not auto-create those checked structures. `create` must verify what it creates. Partial callback acquisition is cleaned up by the callback; partial creator acquisition remains the creator's D-0148 responsibility. A factory must never manufacture a custom Storage bundle to inspect it or change its disposal path.

## Ordered reviewable slices

All slices are high-risk because they change persistence/lifecycle/public or provider contracts. One existing implementer (`gpt-6-sol` / `medium`) changes overlapping files at a time; M3 must finish its overlapping provider edits first. Existing relevant specialist reviewers inspect a complete bounded wave after deterministic checks; no new role is needed.

1. **Shared contract and memory.** Responsible files: storage factory/provider entrypoint, one preparation-port module, memory factory/backend definition validation, focused storage contract tests. Introduce checkConnection, provider port, honest unsupported defaults, and memory implementation. Acceptance: synchronous construction remains; check mode does not create Storage, data or tenant membership; failed attempts retry; closed factories reject; incompatible same-family definitions cannot reuse success; custom test factories must opt in. Exclude SQL/provider rewrites and public runtime methods. Record the exact intended server requirements as pure definitions only where presently accessible without broad repository restructuring.
2. **PostgreSQL offline binding.** Responsible files: PostgreSQL factory/configuration, record lifecycle binding, associated connection/builder tests. Acceptance: build with an unreachable URL succeeds locally; no resolver call at build/handle creation; first awaited operation resolves one tenant once across concurrent calls; default schema is read from the real connection; missing existing destination fails without provisioning; shared check does not touch tenants; transient failures retry; close drains pending resolution; check-only temporary pools end. Preserve table naming, local validation and M3 cleanup. Exclude MySQL and global server assembly.
3. **PostgreSQL model preparation.** Responsible files: table initializer/spec mapping, PostgreSQL preparation registration, record operation integration, preparation behavior tests. Acceptance: complete Entity/history/EventStore/audit requirements are derivable without Storage construction; two handles/explicit calls share physical preparation; successful check followed by first use has zero DDL/custom-create invocations; check/create races obey the table above; incompatible layouts reject; unrelated tenant remains usable; partial successes survive a later failure. Exclude Agent recovery structures from the new contract and runtime M8–M11 changes.
4. **MySQL/MariaDB parity.** Responsible files: MySQL factory, record initialization/lifecycle, pure table-spec preparation, corresponding tests. Reuse the accepted shared contract, not PostgreSQL classes. Acceptance: offline build/dynamic resolver/temporary pool lifecycle as above; split DDL from inspection; retain MariaDB/MySQL physical type/engine behavior and custom operation factory; successful read-only checks suppress later auto-DDL across handles. Exclude SQL dialect convergence and pool redesign.
5. **Datastore native guarantees and custom preparations.** Responsible files: Datastore factory/layout selection, creator contract declarations, read-only probe/preparation implementation, focused creator/lifecycle tests. Acceptance: no fake DDL or sentinel records; exact/fallback/custom Entity semantics preserved; preparation never calls a creator; native create/check establish the same documented structural facts and either success satisfies the other; missing custom support or an unprovable declared requirement fails in both modes without cached readiness; no success claims index deployment; supplied client stays open; callbacks receive correct tenant/model and mode; cleanup follows D-0148. Exclude composite-index provisioning, native-key workarounds, migrations and namespace membership redesign.

Later M9/M11 acceptance must cover late model addition, effective TenantIndex override selection, prevalidation of all explicit IDs, zero completed models, explicit/lazy concurrency and close. These are required integration checks, not evidence that M4 alone implements public runtime preparation.

## Risks, exclusions, and remaining concrete work

The main risks are PostgreSQL helpers touching the schema before binding, readiness keys omitting a history/layout requirement, MySQL holding a connection while waiting for initialization, custom Datastore creators bypassing preparation, and concurrent close publishing a late resource. Each is covered by the slices' behavior criteria. No tests or verification were run in this design assignment.

There is no remaining human product decision required for async resolver or preparation semantics. Implementation must select the concrete Datastore SDK read-only probe from the installed client version. The native structural guarantee is settled above and deliberately excludes index-deployment verification; picking the probe is bounded provider/API verification, not another architecture pass. An application requiring stronger deployment validation supplies that validation through its deployment process or a custom preparation implementation, whose two modes must establish the same claimed requirements.

Excluded: provisioning databases/schemas/indexes, migration or conversion, dynamic resolver enumeration, live successful-destination remapping, new public Bounded Context APIs, generalized capability descriptors, a common resource-retention framework, arbitrary concurrency/time/retry caps, Agent recovery preparation, changes to configured domain serialization, and reopening completed M1–M3 design.

## Source evidence and JVM guardrail

Worktree-relative TS evidence inspected:

- `packages/storage/src/storage/storage-factory.ts`: synchronous creation and D-0148 close fence.
- `packages/storage/src/provider.ts`, `internal/entity-commit.ts`, `internal/entity-history.ts`, `memory/in-memory-entity-history.ts`: existing synchronous provider registration and declarative EntityStorageInput/history flags.
- `packages/storage/src/entity/agent-history.ts`: existing surviving audit input.
- `packages/server/src/repository/repository.ts`: RepositoryStorage.entityStorageInput, retained read/write storage acquisition, and actual Entity/Agent ports; definitions already precede acquisition.
- `packages/storage-postgres/src/postgres/storage-factory.ts`: Builder.build/connect/prove, current-schema resolution, database/context exact lookup, canonical table spec and custom DDL factory.
- `packages/storage-postgres/src/postgres/record-storage.ts`, `table-initializer.ts`, `table-resolver.ts`, `entity-commit.ts`: eager physical constructor requirements, auto-DDL initialization, failed Promise retention, physical-family naming and current/history/EventStore preparation.
- `packages/storage-mysql/src/mysql/storage-factory.ts`, `record-storage.ts`: eager pools and handle-local createAndInspect; MySQL using() acquires before awaiting local readiness.
- `packages/storage-datastore/src/datastore/storage-factory.ts`, `tenant-catalog.ts`: custom callback responsibilities, coherent custom Entity bundle, generated Entity record customization bypass, existing native namespace metadata query.
- Datastore correction inspection: `storage-factory.ts` RecordLayout declares only `kind`; `record-storage.ts` constructs namespace/kind/ID mappings, materializes columns and excludes binary payload from indexes; `entity-history.ts` uses entity_id/version/created query combinations; `agent-history.ts` uses scope_digest with order_key and optional category/conversation_digest. `packages/storage-datastore/index.yaml` declares three audit indexes plus recovery-only indexes; README.md's credentials/indexes section requires application deployment of query-dependent indexes. These support one narrow native create/check guarantee, with index deployment explicitly outside its proof.

Local notes read:

- `/Users/armiol/.codex/worktrees/environment-lifecycle/spine-ts/spine-jvm-docs/spine-validation-storage-observability-and-support.md`, Storage abstraction and provider/record model sections.
- `/Users/armiol/.codex/worktrees/environment-lifecycle/spine-ts/spine-jvm-docs/spine-server-runtime-and-bounded-context.md`, System Context and environment/storage wiring sections.

Local JVM source read:

- `/Users/armiol/development/Spine/core-jvm/server/src/main/java/io/spine/server/storage/StorageFactory.java`: synchronous RecordSpec-based construction, default higher-level storages, shared delivery storage, concurrent history acquisition.
- `/Users/armiol/development/Spine/core-jvm/server/src/main/java/io/spine/server/tenant/TenantIndex.java`: membership storage and enumeration separate from storage factory selection; it does not establish TS dynamic SQL resolution.
- `/Users/armiol/development/Spine/jdbc-2x/rdbms/src/main/java/io/spine/server/storage/jdbc/JdbcStorageFactory.java`: local tableSpecFor(RecordSpec), configured DataSource, custom operations, and synchronous construction. Its tableCreationSql currently constructs a JdbcRecordStorage; the accepted TS no-throwaway requirement deliberately uses pure table-spec functions instead.

Impact: preserve the familiar RecordSpec and synchronous StorageFactory seam, keep model/tenant selection outside low-level physical checks, and put async behavior in existing Promise-returning operations. JVM precedents do not supersede the explicit TS read-only preparation, shared Inbox, unconditional admission, or asynchronous application resolver requirements.
