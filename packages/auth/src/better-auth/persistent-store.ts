/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { clone, equals, type Message } from "@bufbuild/protobuf";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { Time } from "@spine-event-engine/core/time";
import type {
  BetterAuthAccountRecord,
  BetterAuthSessionRecord,
  BetterAuthUserRecord,
  BetterAuthVerificationRecord,
} from "@spine-event-engine/proto/auth";
import {
  BetterAuthAccountRecordSchema as AccountSchema,
  BetterAuthUserRecordSchema as UserSchema,
} from "@spine-event-engine/proto/auth";
import type {
  RecordSpec,
  RecordStorage,
  StorageFactory,
  StorageGroup,
  RecordContinuation,
} from "@spine-event-engine/storage";
import { defaultQueryCandidateLimit } from "@spine-event-engine/storage";
import { StoragePreparations } from "@spine-event-engine/storage/provider";

import { accountSpec, context, sessionSpec, userSpec, verificationSpec } from "./record-specs.js";
import { nativeAdapter, type NativeRecordAccess } from "./native-adapter.js";
import { BetterAuthRecords } from "./record-codec.js";
import { ExpiryMaintenance } from "./expiry-maintenance.js";
import { SessionRecords } from "../sessions/session-record.js";

/**
 * Native record families admitted by the selected Better Auth profile.
 */
export type BetterAuthModel = "user" | "account" | "session" | "verification";

/**
 * Complete native user supplied by an existing identity directory.
 */
export interface BetterAuthUser {
  /**
   * Stable native user identifier.
   */
  readonly id: string;

  /**
   * Display name.
   */
  readonly name: string;

  /**
   * Unique normalized login email.
   */
  readonly email: string;

  /**
   * Whether the directory has verified the email.
   */
  readonly emailVerified: boolean;

  /**
   * Optional profile image URL.
   */
  readonly image?: string;

  /**
   * Original creation instant.
   */
  readonly createdAt: Date;

  /**
   * Most recent update instant.
   */
  readonly updatedAt: Date;
}

/**
 * Read-only complete User source replacing persisted User records.
 */
export interface BetterAuthUsers {
  /**
   * Resolves one complete user by stable native ID.
   *
   * @param id Native User identifier.
   * @param signal Optional cancellation of the external lookup.
   * @returns Complete User or absence.
   */
  findById(id: string, signal?: AbortSignal): Promise<BetterAuthUser | undefined>;

  /**
   * Resolves one complete user by normalized login email when required.
   *
   * @param email Normalized directory email.
   * @param signal Optional cancellation of the external lookup.
   * @returns Complete User or absence.
   */
  findByEmail?(email: string, signal?: AbortSignal): Promise<BetterAuthUser | undefined>;
}

/**
 * Immutable selected account definition supplied by an administrator.
 */
export interface BetterAuthAccount {
  /**
   * Stable linked user identifier.
   */
  readonly userId: string;

  /**
   * Immutable provider subject.
   */
  readonly accountId: string;

  /**
   * Immutable configured provider identifier.
   */
  readonly providerId: string;

  /**
   * Optional precomputed password hash for the credential provider.
   */
  readonly password?: string;

  /**
   * Original account creation instant.
   */
  readonly createdAt: Date;

  /**
   * Most recent account update instant.
   */
  readonly updatedAt: Date;
}

/**
 * Complete administrator-selected identities provisioned before auth traffic.
 */
export interface BetterAuthProvisioning {
  /**
   * Complete selected Users; omitted when using an external source.
   */
  readonly users?: readonly BetterAuthUser[];

  /**
   * Complete immutable credential or prelinked provider accounts.
   */
  readonly accounts?: readonly BetterAuthAccount[];
}

/**
 * Selected record placement and physical preparation policy.
 */
export interface BetterAuthStoreOptions {
  /**
   * Factory used to acquire independent selected record handles.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Physical group shared by the selected record families.
   */
  readonly group: StorageGroup;

  /**
   * Explicit native record families to persist.
   */
  readonly models: readonly BetterAuthModel[];

  /**
   * Complete external user source in place of a stored User model.
   */
  readonly users?: BetterAuthUsers;

  /**
   * Whether to prepare and check selected structures; defaults to true.
   */
  readonly createMissingStructures?: boolean;

  /**
   * Returns trusted time for expiry reads and explicit maintenance.
   *
   * @returns Current trusted instant.
   */
  readonly clock?: () => Timestamp;
}

/**
 * Independently closeable selected native record handles.
 */
interface Handles {
  readonly user: RecordStorage<string, BetterAuthUserRecord> | undefined;
  readonly account: RecordStorage<string, BetterAuthAccountRecord> | undefined;
  readonly session: RecordStorage<string, BetterAuthSessionRecord> | undefined;
  readonly verification: RecordStorage<string, BetterAuthVerificationRecord> | undefined;
}

/**
 * Persistent selected Better Auth records without a second database engine.
 */
export class PersistentBetterAuthStore {
  readonly #handles: Handles;

  readonly #users: BetterAuthUsers | undefined;

  readonly #clock: () => Timestamp;

  #closed = false;

  #provisioning = false;

  #provisioningFault = false;

  #failedBatch: ProvisioningRecords | undefined;

  #active = 0;

  #drained: (() => void) | undefined;

  #closing: Promise<void> | undefined;

  /**
   * Captures the completed selected-handle configuration.
   *
   * @param handles Independently closeable model handles.
   * @param users Optional external complete User source.
   * @param clock Trusted expiry and maintenance clock.
   */
  private constructor(
    handles: Handles,
    users: BetterAuthUsers | undefined,
    clock: () => Timestamp,
  ) {
    this.#handles = handles;
    this.#users = users;
    this.#clock = clock;
    const access: NativeRecordAccess = {
      storage: (model) => this.#storage(model),
      users: () => this.#users,
      now: () => this.#clock(),
      requireOpen: () => {
        this.#requireTrafficReady();
      },
      run: (operation) => this.#run(operation),
    };
    nativeFactories.set(this, nativeAdapter(access));
    nativeSelections.set(this, {
      models: new Set(
        (["user", "account", "session", "verification"] as const).filter(
          (model) => handles[model] !== undefined,
        ),
      ),
      externalUsers: users !== undefined,
      externalEmail: users?.findByEmail !== undefined,
    });
  }

  /**
   * Removes expired selected Session and Verification records on request.
   *
   * A concurrent replacement can leave eligible rows for a later invocation.
   * Cleanup does not determine whether ordinary native reads accept a record.
   *
   * @param cutoff Latest eligible exact expiry, no later than trusted time.
   * @param signal Optional cooperative cancellation.
   * @returns Number of confirmed conditional removals.
   */
  purgeExpired(cutoff: Timestamp, signal?: AbortSignal): Promise<number> {
    return this.#run(async () => {
      const valid = SessionRecords.deadline(cutoff);
      if (SessionRecords.compare(valid, SessionRecords.deadline(this.#clock())) > 0)
        throw new RangeError("Better Auth purge cutoff cannot exceed trusted time.");
      let removed = 0;
      if (this.#handles.session)
        removed += await ExpiryMaintenance.purgeExpired(this.#handles.session, valid, signal);
      if (this.#handles.verification)
        removed += await ExpiryMaintenance.purgeExpired(this.#handles.verification, valid, signal);
      return removed;
    }, false);
  }

  /**
   * Persists complete immutable identities before a public auth listener starts.
   *
   * One administrator process must serialize calls across all store instances.
   * A partial failure fences native traffic until an identical retry succeeds.
   *
   * @param input Complete selected User and Account definitions.
   * @returns Completion after all definitions are verified or inserted.
   */
  async provision(input: BetterAuthProvisioning): Promise<void> {
    this.#requireOpen();
    if (this.#provisioning) throw new Error("Better Auth provisioning is already in progress.");
    this.#provisioning = true;
    this.#active++;
    let writing = false;
    try {
      const { users, accounts } = this.#proposedBatch(input);
      if (
        this.#failedBatch !== undefined &&
        !BetterAuthDefinitions.sameBatch(this.#failedBatch, { users, accounts })
      )
        throw new Error("Partial Better Auth provisioning requires an identical full retry.");
      await this.#checkProvisioning(users, accounts);
      writing = true;
      if (this.#failedBatch === undefined)
        this.#failedBatch = this.#detachedBatch({ users, accounts });
      for (const user of users) await this.#insertDefinition("user", user);
      for (const account of accounts) await this.#insertDefinition("account", account);
      this.#provisioningFault = false;
      this.#failedBatch = undefined;
    } catch (error) {
      if (writing) this.#provisioningFault = true;
      throw error;
    } finally {
      this.#provisioning = false;
      this.#active--;
      if (this.#active === 0) this.#drained?.();
    }
  }

  /**
   * Encodes complete caller definitions before checking a failed-batch retry.
   *
   * @param input Administrator-selected native definitions.
   * @returns Domain records detached from caller objects.
   */
  #proposedBatch(input: BetterAuthProvisioning): ProvisioningRecords {
    const users = (input.users ?? []).map(
      (user) =>
        BetterAuthRecords.encode(
          "user",
          user as unknown as Record<string, unknown>,
        ) as BetterAuthUserRecord,
    );
    const accounts = (input.accounts ?? []).map((account) => {
      const data = account as unknown as Record<string, unknown>;
      return BetterAuthRecords.encode("account", {
        ...data,
        id: BetterAuthRecords.key("account", data),
      }) as BetterAuthAccountRecord;
    });
    return { users, accounts };
  }

  /**
   * Copies the complete batch before the first conditional write can fail.
   *
   * @param batch Encoded administrator definitions.
   * @returns Detached definitions that caller mutation cannot change.
   */
  #detachedBatch(batch: ProvisioningRecords): ProvisioningRecords {
    return {
      users: batch.users.map((user) => clone(UserSchema, user)),
      accounts: batch.accounts.map((account) => clone(AccountSchema, account)),
    };
  }

  /**
   * Checks all identities, links and existing definitions before the first write.
   *
   * @param users Complete proposed User records.
   * @param accounts Complete proposed Account records.
   */
  async #checkProvisioning(
    users: readonly BetterAuthUserRecord[],
    accounts: readonly BetterAuthAccountRecord[],
  ): Promise<void> {
    if (users.length && !this.#handles.user) throw new Error("Stored User was not selected.");
    if (accounts.length && !this.#handles.account) throw new Error("Account was not selected.");
    BetterAuthDefinitions.unique(
      users.map((user) => user.id),
      "User ID",
    );
    BetterAuthDefinitions.unique(
      users.map((user) => user.email),
      "User email",
    );
    BetterAuthDefinitions.unique(
      accounts.map((account) => account.id),
      "provider account",
    );
    const proposed = new Set(users.map((user) => user.id));
    for (const user of users) await this.#checkUser(user);
    for (const account of accounts) {
      await this.#checkDefinition("account", account);
      if (!proposed.has(account.userId)) await this.#requireLinkedUser(account.userId);
    }
  }

  /**
   * Checks email uniqueness and an existing User definition.
   *
   * @param proposed Complete proposed User.
   */
  async #checkUser(proposed: BetterAuthUserRecord): Promise<void> {
    const storage = this.#handles.user;
    if (storage === undefined) throw new Error("Stored User was not selected.");
    let after: RecordContinuation<string> | undefined;
    for (;;) {
      const collisions = await storage.queryEntries({
        filters: [{ column: "email_digest", value: BetterAuthRecords.indexKey(proposed.email) }],
        sort: [{ field: "id" }],
        limit: defaultQueryCandidateLimit,
        ...(after === undefined ? {} : { after }),
      });
      if (
        collisions.some(
          (entry) => entry.record.email === proposed.email && entry.id !== proposed.id,
        )
      )
        throw new Error("Better Auth email is already assigned to another User.");
      if (collisions.length < defaultQueryCandidateLimit) break;
      const last = collisions.at(-1);
      if (last === undefined) break;
      after = { id: last.id, values: [{ field: "id", value: last.id }] };
    }
    await this.#checkDefinition("user", proposed);
  }

  /**
   * Verifies an account link against selected stored or external Users.
   *
   * @param id Stable linked User identifier.
   */
  async #requireLinkedUser(id: string): Promise<void> {
    const source = this.#users;
    if (source !== undefined) {
      const user = await source.findById(id);
      if (user === undefined) throw new Error("Provisioned Account refers to an absent User.");
      BetterAuthRecords.encode("user", user as unknown as Record<string, unknown>);
      return;
    }
    if ((await this.#handles.user?.read(id)) === undefined)
      throw new Error("Provisioned Account refers to an absent User.");
  }

  /**
   * Rejects conflicting already-stored immutable definitions.
   *
   * @param model Selected administrator-managed family.
   * @param proposed Complete proposed record.
   */
  async #checkDefinition(
    model: "user" | "account",
    proposed: BetterAuthUserRecord | BetterAuthAccountRecord,
  ): Promise<void> {
    const current = await this.#storage(model).read(proposed.id);
    if (current !== undefined && !BetterAuthDefinitions.sameDefinition(model, current, proposed))
      throw new Error(`Conflicting Better Auth ${model} definition.`);
  }

  /**
   * Inserts one absent immutable definition or confirms an identical retry.
   *
   * @param model Selected administrator-managed family.
   * @param proposed Complete proposed record.
   */
  async #insertDefinition(
    model: "user" | "account",
    proposed: BetterAuthUserRecord | BetterAuthAccountRecord,
  ): Promise<void> {
    const storage = this.#storage(model);
    if (await storage.compareAndSet(proposed.id, undefined, proposed)) return;
    const current = await storage.read(proposed.id);
    if (current === undefined || !BetterAuthDefinitions.sameDefinition(model, current, proposed))
      throw new Error(`Conflicting Better Auth ${model} definition.`);
  }

  /**
   * Selects a prepared handle while preserving its private Protobuf family.
   *
   * @param model Requested selected native family.
   * @returns Record handle for that family.
   */
  #storage(model: BetterAuthModel): RecordStorage<string, Message> {
    this.#requireOpen();
    const handle = this.#handles[model];
    if (handle === undefined) throw new Error(`Better Auth model ${model} was not selected.`);
    return handle;
  }

  /**
   * Rejects work after the close fence.
   */
  #requireOpen(): void {
    if (this.#closed) throw new Error("Better Auth store is closed.");
  }

  /**
   * Prevents native traffic after a partial provisioning failure.
   */
  #requireTrafficReady(): void {
    this.#requireOpen();
    if (this.#provisioning || this.#provisioningFault)
      throw new Error("Better Auth provisioning must complete before traffic.");
  }

  /**
   * Tracks admitted native work until the close fence can release handles.
   *
   * @param operation One native storage operation.
   * @returns Its result after raw work settles.
   * @typeParam T Native operation result.
   */
  async #run<T>(operation: () => Promise<T>, traffic = true): Promise<T> {
    if (traffic) this.#requireTrafficReady();
    else this.#requireOpen();
    this.#active++;
    try {
      return await operation();
    } finally {
      this.#active--;
      if (this.#active === 0) this.#drained?.();
    }
  }

  /**
   * Acquires selected handles and completes default physical preparation.
   *
   * @param options Selected model placement and preparation policy.
   * @returns Prepared store, or an explicitly non-preparing store.
   */
  static async create(options: BetterAuthStoreOptions): Promise<PersistentBetterAuthStore> {
    const models = BetterAuthDefinitions.validateModels(options.models, options.users);
    const acquired: { close(): void }[] = [];
    try {
      const handles: Handles = {
        user: models.includes("user") ? this.#acquire(options, userSpec, acquired) : undefined,
        account: models.includes("account")
          ? this.#acquire(options, accountSpec, acquired)
          : undefined,
        session: models.includes("session")
          ? this.#acquire(options, sessionSpec, acquired)
          : undefined,
        verification: models.includes("verification")
          ? this.#acquire(options, verificationSpec, acquired)
          : undefined,
      };
      if (options.createMissingStructures !== false) await this.#prepare(options, handles);
      return new PersistentBetterAuthStore(
        handles,
        options.users,
        options.clock ?? Time.currentTime,
      );
    } catch (error) {
      this.#closeAcquired(acquired, error);
    }
  }

  /**
   * Closes acquired handles while retaining preparation and cleanup failures.
   *
   * @param acquired Handles acquired before factory failure.
   * @param error Original acquisition or preparation failure.
   * @throws Original error or combined preparation and cleanup failures.
   */
  static #closeAcquired(acquired: { close(): void }[], error: unknown): never {
    const failures: unknown[] = [error];
    for (const handle of acquired.reverse()) {
      try {
        handle.close();
      } catch (closeError) {
        failures.push(closeError);
      }
    }
    if (failures.length > 1)
      throw new AggregateError(failures, "Better Auth preparation and handle cleanup failed.");
    throw error;
  }

  /**
   * Acquires a selected handle with atomic conditional mutation capability.
   *
   * @typeParam R Selected domain record.
   * @param options Selected storage placement.
   * @param spec Physical record layout.
   * @param acquired Handles retained for failure cleanup.
   * @returns Acquired conditional storage handle.
   */
  static #acquire<R extends Message>(
    options: BetterAuthStoreOptions,
    spec: RecordSpec<string, R>,
    acquired: { close(): void }[],
  ): RecordStorage<string, R> {
    const handle = options.storageFactory.createRecordStorage(context, spec, options.group, {
      prepareOnAccess: false,
    });
    acquired.push(handle);
    if (!handle.atomicCompareAndSet)
      throw new Error("Better Auth storage requires atomic compare-and-set.");
    return handle;
  }

  /**
   * Prepares only selected physical record families before returning the store.
   *
   * @param options Selected storage placement.
   * @param handles Acquired selected handles.
   * @returns Completion after all selected structures are prepared.
   */
  static async #prepare(options: BetterAuthStoreOptions, handles: Handles): Promise<void> {
    const preparation = StoragePreparations.for(options.storageFactory);
    if (handles.user) await preparation.prepareRecord(context, userSpec, options.group, "create");
    if (handles.account)
      await preparation.prepareRecord(context, accountSpec, options.group, "create");
    if (handles.session)
      await preparation.prepareRecord(context, sessionSpec, options.group, "create");
    if (handles.verification)
      await preparation.prepareRecord(context, verificationSpec, options.group, "create");
  }

  /**
   * Closes selected handles without closing the injected shared factory.
   *
   * @returns Completion after all selected handles have closed.
   */
  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    this.#closed = true;
    this.#closing = this.#finishClose();
    return this.#closing;
  }

  /**
   * Drains admitted native work and releases every selected handle.
   *
   * @returns Completion after all handles close.
   */
  async #finishClose(): Promise<void> {
    if (this.#active > 0)
      await new Promise<void>((resolve) => {
        this.#drained = resolve;
      });
    const failures: unknown[] = [];
    for (const handle of [
      this.#handles.user,
      this.#handles.account,
      this.#handles.session,
      this.#handles.verification,
    ]) {
      try {
        handle?.close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, "Better Auth handle close failed.");
  }
}

/**
 * Complete encoded User and Account definitions for one administrator batch.
 */
interface ProvisioningRecords {
  readonly users: readonly BetterAuthUserRecord[];
  readonly accounts: readonly BetterAuthAccountRecord[];
}

/**
 * Selected physical layouts for preparation.
 */
const specs = {
  user: userSpec,
  account: accountSpec,
  session: sessionSpec,
  verification: verificationSpec,
};

/**
 * Private one-to-one native factories for M10 integration without a public peer type.
 */
const nativeFactories = new WeakMap<PersistentBetterAuthStore, unknown>();

/**
 * Selected native family names and external User replacement for construction checks.
 */
const nativeSelections = new WeakMap<
  PersistentBetterAuthStore,
  {
    readonly models: ReadonlySet<BetterAuthModel>;
    readonly externalUsers: boolean;
    readonly externalEmail: boolean;
  }
>();

/**
 * Returns the internal native database factory to the later bounded integration.
 *
 * @param store Selected prepared store.
 * @returns Internal native factory without a public Better Auth declaration edge.
 */
export function nativeFactoryFor(store: PersistentBetterAuthStore): unknown {
  const factory = nativeFactories.get(store);
  if (factory === undefined) throw new Error("Better Auth native factory is unavailable.");
  return factory;
}

/**
 * Returns the selected store profile without exposing it on the optional public entry.
 *
 * @param store Selected prepared store.
 * @returns Captured model set and external User choice.
 */
export function nativeSelectionFor(store: PersistentBetterAuthStore): {
  readonly models: ReadonlySet<BetterAuthModel>;
  readonly externalUsers: boolean;
  readonly externalEmail: boolean;
} {
  const selection = nativeSelections.get(store);
  if (selection === undefined) throw new Error("Better Auth store selection is unavailable.");
  return selection;
}

/**
 * Validates administrator definitions and selected model declarations.
 */
const BetterAuthDefinitions = Object.freeze({
  /**
   * Validates the explicit model set before storage acquisition.
   *
   * @param models Caller-selected persisted models.
   * @param users Optional external User source.
   * @returns Detached unique selected model names.
   */
  validateModels(
    models: readonly BetterAuthModel[],
    users: BetterAuthUsers | undefined,
  ): BetterAuthModel[] {
    if (!Array.isArray(models) || models.length === 0)
      throw new TypeError("At least one Better Auth model must be selected.");
    const unique = new Set<BetterAuthModel>();
    for (const candidate of models as readonly unknown[]) {
      if (typeof candidate !== "string" || !Object.hasOwn(specs, candidate))
        throw new TypeError(`Invalid Better Auth model: ${String(candidate)}`);
      const model = candidate as BetterAuthModel;
      if (unique.has(model)) throw new TypeError(`Duplicate Better Auth model: ${model}`);
      unique.add(model);
    }
    if (users !== undefined && unique.has("user"))
      throw new TypeError("Stored User and external User cannot be selected together.");
    return [...unique];
  },

  /**
   * Rejects duplicate immutable identities in one administrator batch.
   *
   * @param values Proposed identity values.
   * @param label Identity domain label.
   */
  unique(values: readonly string[], label: string): void {
    if (new Set(values).size !== values.length)
      throw new Error(`Duplicate Better Auth ${label} in provisioning batch.`);
  },

  /**
   * Compares complete immutable administrator definitions by their domain schema.
   *
   * @param model Selected administrator-managed family.
   * @param current Existing record.
   * @param proposed Proposed record.
   * @returns Whether the complete definitions match.
   */
  sameDefinition(model: "user" | "account", current: Message, proposed: Message): boolean {
    return model === "user"
      ? equals(UserSchema, current as BetterAuthUserRecord, proposed as BetterAuthUserRecord)
      : equals(
          AccountSchema,
          current as BetterAuthAccountRecord,
          proposed as BetterAuthAccountRecord,
        );
  },

  /**
   * Compares complete detached failed and retried administrator batches by identity.
   *
   * @param failed Definitions captured before the first attempted write.
   * @param retry Newly encoded complete proposed definitions.
   * @returns Whether every User and Account definition is identical.
   */
  sameBatch(failed: ProvisioningRecords, retry: ProvisioningRecords): boolean {
    if (
      failed.users.length !== retry.users.length ||
      failed.accounts.length !== retry.accounts.length
    )
      return false;
    const users = new Map(failed.users.map((user) => [user.id, user]));
    const accounts = new Map(failed.accounts.map((account) => [account.id, account]));
    return (
      retry.users.every((user) => {
        const prior = users.get(user.id);
        return prior !== undefined && this.sameDefinition("user", prior, user);
      }) &&
      retry.accounts.every((account) => {
        const prior = accounts.get(account.id);
        return prior !== undefined && this.sameDefinition("account", prior, account);
      })
    );
  },
});
