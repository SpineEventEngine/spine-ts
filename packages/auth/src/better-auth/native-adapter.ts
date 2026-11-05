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

import { AsyncLocalStorage } from "node:async_hooks";
import type { Message } from "@bufbuild/protobuf";
import { timestampFromDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import {
  defaultQueryCandidateLimit,
  type RecordContinuation,
  type RecordStorage,
} from "@spine-event-engine/storage";
import { createAdapterFactory, type CleanedWhere, type CustomAdapter } from "better-auth/adapters";

import { BetterAuthRecords } from "./record-codec.js";
import type { BetterAuthModel, BetterAuthUsers } from "./persistent-store.js";
import { SessionRecords } from "../sessions/session-record.js";

/**
 * Carries an admitted operation lifetime through native adapter callbacks.
 */
// This static context passes a signal through the native callback stack without an API option.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class NativeSignalContext {
  /**
   * Executes native work with its caller's cancellation signal.
   *
   * @typeParam T Result of the admitted work.
   * @param signal Current browser or session lifetime.
   * @param work Native work to execute.
   * @returns Settled work result.
   */
  static run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    return nativeSignals.run(signal, work);
  }

  /**
   * Returns the current admitted native operation signal, when supplied.
   *
   * @returns Current signal or absence for standalone store calls.
   */
  static current(): AbortSignal | undefined {
    return nativeSignals.getStore();
  }
}

const nativeSignals = new AsyncLocalStorage<AbortSignal>();

/**
 * Internal selected record access without leaking native types in public declarations.
 */
export interface NativeRecordAccess {
  /**
   * Returns the selected physical handle, or rejects an unselected family.
   *
   * @param model Selected native record family.
   * @returns Physical handle for the selected family.
   */
  storage(model: BetterAuthModel): RecordStorage<string, Message>;

  /**
   * Returns the configured complete external User source, if selected.
   *
   * @returns External User directory or absence.
   */
  users(): BetterAuthUsers | undefined;

  /**
   * Returns trusted time for ordinary expiry decisions.
   *
   * @returns Current trusted instant.
   */
  now(): Timestamp;

  /**
   * Rejects native operations after the store close fence.
   */
  requireOpen(): void;

  /**
   * Waits for one admitted native operation until its raw storage work settles.
   *
   * @typeParam T Result of the admitted operation.
   * @param operation Native work admitted before the close fence.
   * @returns The operation's result after its work settles.
   */
  run<T>(operation: () => Promise<T>): Promise<T>;
}

/**
 * Creates the native Better Auth factory over selected Spine records.
 *
 * @param access Narrow selected record and lifetime access.
 * @returns Actual Better Auth adapter factory viewed through an internal boundary.
 */
export function nativeAdapter(access: NativeRecordAccess): ReturnType<typeof createAdapterFactory> {
  const records = new NativeOperations(access);
  const factory = createAdapterFactory({
    config: { adapterId: "spine-record", supportsNumericIds: false, transaction: false },
    adapter: ({ schema }) => records.adapter(schema),
  });
  return (options) =>
    factory({
      ...options,
      advanced: {
        ...options.advanced,
        database: { ...options.advanced?.database, joins: true },
      },
    });
}

/**
 * Native operation translation with indexed candidate selection and per-slot CAS.
 */
class NativeOperations {
  readonly #access: NativeRecordAccess;

  /**
   * Binds the selected record access.
   *
   * @param access Selected record handles and trusted clock.
   */
  constructor(access: NativeRecordAccess) {
    this.#access = access;
  }

  /**
   * Creates the selected native operations after checking the schema fields.
   *
   * @param schema Native selected model schema.
   * @returns Better Auth adapter methods bound to the selected handles.
   */
  adapter(schema: Record<string, { fields: Record<string, unknown> }>): CustomAdapter {
    for (const [name, definition] of Object.entries(schema)) {
      const model = NativePredicates.selectedModel(name);
      for (const field of Object.keys(definition.fields))
        if (!BetterAuthRecords.fields(model).includes(field))
          throw new Error(`Unsupported ${model} schema field: ${field}`);
    }
    return { ...this.#readAdapter(), ...this.#writeAdapter() };
  }

  /**
   * Binds native reads and selected runtime creation to admitted work.
   *
   * @returns Native read and create operations.
   */
  #readAdapter(): Pick<CustomAdapter, "create" | "findOne" | "findMany" | "count"> {
    return {
      create: ({ model, modelKey, data }) =>
        this.#access.run(() => this.create(NativePredicates.selectedModel(model, modelKey), data)),
      findOne: ({ model, modelKey, where, select, join }) =>
        this.#access.run(() => {
          const selected = NativePredicates.selectedModel(model, modelKey);
          if (join !== undefined) return this.#joinedOne(selected, where, select, join);
          return this.findOne(selected, where);
        }),
      findMany: ({ model, modelKey, where, limit, offset, sortBy, select, join }) =>
        this.#access.run(() => {
          if (join !== undefined)
            return this.#joinedMany(
              NativePredicates.selectedModel(model, modelKey),
              where,
              limit,
              offset,
              sortBy,
              select,
              join,
            );
          return this.findMany(
            NativePredicates.selectedModel(model, modelKey),
            where,
            limit,
            offset,
            sortBy,
          );
        }),
      count: ({ model, modelKey, where }) =>
        this.#access.run(() => this.count(NativePredicates.selectedModel(model, modelKey), where)),
    } as Pick<CustomAdapter, "create" | "findOne" | "findMany" | "count">;
  }

  /**
   * Reads one selected native relation using existing indexed model readers.
   *
   * @param model Selected base family.
   * @param where Exact indexed base predicate.
   * @param select Native projection, which is unsupported for joined reads.
   * @param join Effective native relation configuration.
   * @returns Base row with an explicit related member, or absence.
   */
  async #joinedOne(
    model: BetterAuthModel,
    where: readonly CleanedWhere[],
    select: readonly string[] | undefined,
    join: NativeJoin,
  ): Promise<Record<string, unknown> | null> {
    const kind = NativeRelations.kind(model, where, select, join);
    return kind === "session-user" ? this.#sessionUser(where) : this.#userAccount(where);
  }

  /**
   * Reads the complete User related to one visible Session.
   *
   * @param where Validated Session token equality.
   * @returns Session with explicit User or null relation.
   */
  async #sessionUser(where: readonly CleanedWhere[]): Promise<Record<string, unknown> | null> {
    const signal = NativeSignalContext.current();
    if (signal?.aborted) return null;
    if (this.#access.users() === undefined) this.#access.storage("user");
    const session = await this.findOne("session", where);
    if (session === null || signal?.aborted) return null;
    if (typeof session.userId !== "string") throw new Error("Stored Session has no User ID.");
    const user = await this.findOne("user", [NativePredicates.equality("id", session.userId)]);
    this.#access.requireOpen();
    if (signal?.aborted || !this.#visible("session", session)) return null;
    return { ...session, user };
  }

  /**
   * Reads the native Account page related to one complete User.
   *
   * @param where Validated User email equality.
   * @returns User with explicit Account page or empty relation.
   */
  async #userAccount(where: readonly CleanedWhere[]): Promise<Record<string, unknown> | null> {
    const signal = NativeSignalContext.current();
    if (signal?.aborted) return null;
    if (this.#access.users() === undefined) this.#access.storage("user");
    this.#access.storage("account");
    const user = await this.findOne("user", where);
    if (user === null || signal?.aborted) return null;
    if (typeof user.id !== "string") throw new Error("Stored User has no ID.");
    const account = await this.findMany(
      "account",
      [NativePredicates.equality("userId", user.id)],
      100,
    );
    this.#access.requireOpen();
    if (signal?.aborted) return null;
    return { ...user, account };
  }

  /**
   * Reads one prelinked Account and its complete User through native's fixed join.
   *
   * @param model Selected base family.
   * @param where Exact provider and subject equality.
   * @param limit Native collision-defense page size.
   * @param offset Optional native offset, which must be absent.
   * @param sortBy Optional native sort, which must be absent.
   * @param select Native projection, which is unsupported for joined reads.
   * @param join Effective User relation.
   * @returns Matching Account rows with explicit User or null.
   */
  async #joinedMany(
    model: BetterAuthModel,
    where: readonly CleanedWhere[] | undefined,
    limit: number,
    offset: number | undefined,
    sortBy: { field: string; direction: "asc" | "desc" } | undefined,
    select: readonly string[] | undefined,
    join: NativeJoin,
  ): Promise<Record<string, unknown>[]> {
    NativeRelations.accountUser(model, where, limit, offset, sortBy, select, join);
    const signal = NativeSignalContext.current();
    if (signal?.aborted) return [];
    if (this.#access.users() === undefined) this.#access.storage("user");
    const accounts = await this.findMany("account", where, 2);
    const result: Record<string, unknown>[] = [];
    for (const account of accounts) {
      if (signal?.aborted) return [];
      if (typeof account.userId !== "string") throw new Error("Stored Account has no User ID.");
      const user = await this.findOne("user", [NativePredicates.equality("id", account.userId)]);
      this.#access.requireOpen();
      if (signal?.aborted) return [];
      result.push({ ...account, user });
    }
    return result;
  }

  /**
   * Binds conditional native mutations to admitted work.
   *
   * @returns Native mutation operations.
   */
  #writeAdapter(): Pick<
    CustomAdapter,
    "update" | "updateMany" | "delete" | "deleteMany" | "consumeOne"
  > {
    return {
      update: ({ model, modelKey, where, update }) =>
        this.#access.run(() =>
          this.mutate(
            NativePredicates.selectedModel(model, modelKey),
            where,
            update as Record<string, unknown>,
            false,
          ),
        ),
      updateMany: ({ model, modelKey, where, update }) =>
        this.#access.run(() =>
          this.mutateMany(NativePredicates.selectedModel(model, modelKey), where, update, false),
        ),
      delete: ({ model, modelKey, where }) =>
        this.#access.run(() =>
          this.#deleteOne(NativePredicates.selectedModel(model, modelKey), where),
        ),
      deleteMany: ({ model, modelKey, where }) =>
        this.#access.run(() =>
          this.mutateMany(NativePredicates.selectedModel(model, modelKey), where, {}, true),
        ),
      consumeOne: ({ model, modelKey, where }) =>
        this.#access.run(() =>
          this.mutate(NativePredicates.selectedModel(model, modelKey), where, {}, true),
        ),
    } as Pick<CustomAdapter, "update" | "updateMany" | "delete" | "deleteMany" | "consumeOne">;
  }

  /**
   * Deletes one selected row and rejects a repeated OAuth state consume.
   *
   * @param model Selected record family.
   * @param where Complete native predicate.
   * @returns Completion after conditional deletion.
   */
  async #deleteOne(model: BetterAuthModel, where: readonly CleanedWhere[]): Promise<void> {
    const removed = await this.mutate(model, where, {}, true);
    if (model === "verification" && NativePredicates.isOAuthState(where) && removed === null)
      throw new Error("OAuth state was already consumed.");
  }

  /**
   * Creates one runtime-managed session or singleton verification if absent.
   *
   * @param model Selected record family.
   * @param data Native transformed row.
   * @returns Persisted native row.
   */
  async create(
    model: BetterAuthModel,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.#access.requireOpen();
    if (model === "user" || model === "account")
      throw new Error(`${model} creation requires controlled provisioning.`);
    const id = BetterAuthRecords.key(model, data);
    const record = BetterAuthRecords.encode(model, { ...data, id });
    if (!(await this.#access.storage(model).compareAndSet(id, undefined, record)))
      throw new Error(`Duplicate ${model} identity.`);
    return BetterAuthRecords.decode(model, record);
  }

  /**
   * Finds one currently visible row satisfying the full native predicate.
   *
   * @param model Selected record family.
   * @param where Native transformed predicates.
   * @returns First matching native row or null.
   */
  async findOne(
    model: BetterAuthModel,
    where: readonly CleanedWhere[],
  ): Promise<Record<string, unknown> | null> {
    for await (const candidate of this.#candidates(model, where)) return candidate.row;
    return null;
  }

  /**
   * Reads a finite requested native page in stable ID order.
   *
   * @param model Selected record family.
   * @param where Native transformed predicates.
   * @param limit Requested result count.
   * @param offset Rows skipped before the page.
   * @param sortBy Optional supported ID ordering.
   * @returns Matching native rows.
   */
  async findMany(
    model: BetterAuthModel,
    where: readonly CleanedWhere[] | undefined,
    limit: number,
    offset = 0,
    sortBy?: { field: string; direction: "asc" | "desc" },
  ): Promise<Record<string, unknown>[]> {
    if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(offset) || offset < 0)
      throw new RangeError("Better Auth page bounds must be nonnegative safe integers.");
    const singletonVerification =
      model === "verification" &&
      limit === 1 &&
      offset === 0 &&
      where?.length === 1 &&
      where[0]?.field === "identifier" &&
      (where[0].operator ?? "eq") === "eq" &&
      typeof where[0].value === "string";
    if (
      sortBy !== undefined &&
      !(sortBy.field === "id" && sortBy.direction === "asc") &&
      !(singletonVerification && sortBy.field === "createdAt" && sortBy.direction === "desc")
    )
      throw new Error("Unsupported Better Auth sort order.");
    if (limit === 0) return [];
    const result: Record<string, unknown>[] = [];
    let skipped = 0;
    for await (const candidate of this.#candidates(model, where)) {
      if (skipped++ < offset) continue;
      result.push(candidate.row);
      if (result.length === limit) break;
    }
    return result;
  }

  /**
   * Calculates the matching row count through finite provider pages.
   *
   * @param model Selected record family.
   * @param where Native transformed predicates.
   * @returns Number of currently matching rows.
   */
  async count(model: BetterAuthModel, where?: readonly CleanedWhere[]): Promise<number> {
    let total = 0;
    for await (const candidate of this.#candidates(model, where)) {
      void candidate;
      total++;
    }
    return total;
  }

  /**
   * Updates or removes one matching row without inserting an absent row.
   *
   * @param model Selected record family.
   * @param where Full native predicate.
   * @param update Supported mutable fields.
   * @param remove Whether to delete instead of update.
   * @returns Changed native row or null.
   */
  async mutate(
    model: BetterAuthModel,
    where: readonly CleanedWhere[],
    update: Record<string, unknown>,
    remove: boolean,
  ): Promise<Record<string, unknown> | null> {
    if (where.length === 0) throw new Error("Better Auth mutation requires a predicate.");
    NativePredicates.validateMutation(model, update, remove);
    for await (const candidate of this.#candidates(model, where))
      return this.#mutateCandidate(model, candidate.id, where, update, remove);
    return null;
  }

  /**
   * Calculates successful conditional changes from indexed candidates.
   *
   * @param model Selected record family.
   * @param where Full native predicate.
   * @param update Supported mutable fields.
   * @param remove Whether to delete instead of update.
   * @returns Number of successfully changed slots.
   */
  async mutateMany(
    model: BetterAuthModel,
    where: readonly CleanedWhere[],
    update: Record<string, unknown>,
    remove: boolean,
  ): Promise<number> {
    if (where.length === 0) throw new Error("Better Auth bulk mutation requires a predicate.");
    NativePredicates.validateMutation(model, update, remove);
    let changed = 0;
    for await (const candidate of this.#candidates(model, where))
      if (await this.#mutateCandidate(model, candidate.id, where, update, remove)) changed++;
    return changed;
  }

  /**
   * Checks the full predicate after each competing slot mutation.
   *
   * @param model Selected record family.
   * @param id Stable storage slot.
   * @param where Original native predicate.
   * @param update Supported replacement fields.
   * @param remove Whether to delete the row.
   * @returns Changed row or null after contention.
   */
  async #mutateCandidate(
    model: BetterAuthModel,
    id: string,
    where: readonly CleanedWhere[],
    update: Record<string, unknown>,
    remove: boolean,
  ): Promise<Record<string, unknown> | null> {
    const storage = this.#access.storage(model);
    const oauthState = model === "verification" && NativePredicates.isOAuthState(where);
    for (;;) {
      this.#access.requireOpen();
      const current = await storage.read(id);
      if (oauthState) NativePredicates.requireLiveState();
      if (current === undefined) return null;
      const row = BetterAuthRecords.decode(model, current);
      if (!NativePredicates.matches(row, where) || !this.#visible(model, row)) return null;
      const next = remove ? undefined : BetterAuthRecords.encode(model, { ...row, ...update });
      if (oauthState) NativePredicates.requireLiveState();
      if (await storage.compareAndSet(id, current, next))
        return next === undefined ? row : BetterAuthRecords.decode(model, next);
    }
  }

  /**
   * Yields indexed candidates after validating all native predicate terms.
   *
   * @param model Selected record family.
   * @param where Full native predicate.
   * @returns Matching entries in stable slot order.
   */
  async *#candidates(
    model: BetterAuthModel,
    where: readonly CleanedWhere[] = [],
  ): AsyncGenerator<{ id: string; row: Record<string, unknown> }> {
    this.#access.requireOpen();
    NativePredicates.validateWhere(model, where);
    if (model === "user" && this.#access.users() !== undefined) {
      yield* this.#externalUsers(where);
      return;
    }
    const storage = this.#access.storage(model);
    const id = NativePredicates.exactKey(model, where);
    if (id !== undefined) {
      const record = await storage.read(id);
      if (record !== undefined) yield* this.#matching(model, [{ id, record }], where);
      return;
    }
    const ids = NativePredicates.idMembership(where);
    if (ids !== undefined) {
      yield* this.#byIds(model, storage, ids, where);
      return;
    }
    const anchor = NativePredicates.indexedAnchor(model, where);
    if (where.length > 0 && anchor === undefined)
      throw new Error(`Better Auth ${model} query requires an indexed identity or predicate.`);
    yield* this.#byIndex(model, storage, anchor, where);
  }

  /**
   * Reads finite primary-key membership pages through provider ID selection.
   *
   * @param model Selected record family.
   * @param storage Selected physical handle.
   * @param ids Requested stable IDs.
   * @param where Complete native predicate.
   * @returns Matching visible entries.
   */
  async *#byIds(
    model: BetterAuthModel,
    storage: RecordStorage<string, Message>,
    ids: readonly string[],
    where: readonly CleanedWhere[],
  ): AsyncGenerator<{ id: string; row: Record<string, unknown> }> {
    for (let offset = 0; offset < ids.length; offset += defaultQueryCandidateLimit) {
      const entries = await storage.queryEntries({
        ids: ids.slice(offset, offset + defaultQueryCandidateLimit),
        sort: [{ field: "id" }],
        limit: defaultQueryCandidateLimit,
      });
      yield* this.#matching(model, entries, where);
    }
  }

  /**
   * Reads finite indexed equality pages or unfiltered selected ID pages.
   *
   * @param model Selected record family.
   * @param storage Selected physical handle.
   * @param anchor Optional declared equality index.
   * @param where Complete native predicate.
   * @returns Matching visible entries.
   */
  async *#byIndex(
    model: BetterAuthModel,
    storage: RecordStorage<string, Message>,
    anchor: { column: string; value: unknown } | undefined,
    where: readonly CleanedWhere[],
  ): AsyncGenerator<{ id: string; row: Record<string, unknown> }> {
    let after: RecordContinuation<string> | undefined;
    for (;;) {
      this.#access.requireOpen();
      const entries = await storage.queryEntries({
        ...(anchor === undefined
          ? {}
          : { filters: [{ column: anchor.column, value: anchor.value }] }),
        sort: [{ field: "id" }],
        limit: defaultQueryCandidateLimit,
        ...(after === undefined ? {} : { after }),
      });
      yield* this.#matching(model, entries, where);
      if (entries.length < defaultQueryCandidateLimit) return;
      const last = entries.at(-1);
      if (last === undefined) return;
      after = { id: last.id, values: [{ field: "id", value: last.id }] };
    }
  }

  /**
   * Checks complete predicates and expiry after provider selection.
   *
   * @param model Selected record family.
   * @param entries Provider-selected entries.
   * @param where Full native predicate.
   * @returns Visible matching entries.
   */
  *#matching(
    model: BetterAuthModel,
    entries: readonly { id: string; record: Message }[],
    where: readonly CleanedWhere[],
  ): Generator<{ id: string; row: Record<string, unknown> }> {
    for (const entry of entries) {
      const row = BetterAuthRecords.decode(model, entry.record);
      if (NativePredicates.matches(row, where) && this.#visible(model, row))
        yield { id: entry.id, row };
    }
  }

  /**
   * Checks selected authoritative expiry without automatic deletion.
   *
   * @param model Selected record family.
   * @param row Native row.
   * @returns Whether the row is currently visible.
   */
  #visible(model: BetterAuthModel, row: Record<string, unknown>): boolean {
    if (model !== "session" && model !== "verification") return true;
    const expires = row.expiresAt;
    if (!(expires instanceof Date)) throw new Error(`Stored ${model} has no expiry.`);
    return (
      SessionRecords.compare(
        timestampFromDate(expires),
        SessionRecords.deadline(this.#access.now()),
      ) > 0
    );
  }

  /**
   * Resolves one complete external User by indexed identity only.
   *
   * @param where Native User predicate.
   * @returns Matching complete directory User.
   */
  async *#externalUsers(
    where: readonly CleanedWhere[],
  ): AsyncGenerator<{ id: string; row: Record<string, unknown> }> {
    const users = this.#access.users();
    if (users === undefined) throw new Error("External User source was not selected.");
    const id = where.find((term) => term.field === "id" && (term.operator ?? "eq") === "eq");
    const email = where.find((term) => term.field === "email" && (term.operator ?? "eq") === "eq");
    if (id === undefined && email === undefined)
      throw new Error("External User lookup requires ID or email equality.");
    if (id === undefined && users.findByEmail === undefined)
      throw new Error("External User email lookup was not configured.");
    const value =
      id !== undefined
        ? await users.findById(String(id.value), NativeSignalContext.current())
        : await users.findByEmail?.(String(email?.value), NativeSignalContext.current());
    this.#access.requireOpen();
    if (NativeSignalContext.current()?.aborted) return;
    if (value === undefined) return;
    const row = BetterAuthRecords.decode(
      "user",
      BetterAuthRecords.encode("user", value as unknown as Record<string, unknown>),
    );
    if (NativePredicates.matches(row, where)) yield { id: value.id, row };
  }
}

/**
 * Effective transformed relation supplied by the pinned native adapter factory.
 */
type NativeJoin = NonNullable<Parameters<CustomAdapter["findOne"]>[0]["join"]>;

/**
 * Validates the selected native Session, User, and Account relation reads.
 */
const NativeRelations = Object.freeze({
  /**
   * Validates the exact native prelinked Account→User relation before any read.
   *
   * @param model Selected base family.
   * @param where Native provider and subject predicates.
   * @param limit Native duplicate-account defense.
   * @param offset Native offset, which must be absent.
   * @param sortBy Native sort, which must be absent.
   * @param select Native projection, which must be absent for joined reads.
   * @param join Effective User relation.
   */
  accountUser(
    model: BetterAuthModel,
    where: readonly CleanedWhere[] | undefined,
    limit: number,
    offset: number | undefined,
    sortBy: { field: string; direction: "asc" | "desc" } | undefined,
    select: readonly string[] | undefined,
    join: NativeJoin,
  ): void {
    if (select !== undefined && select.length > 0)
      throw new Error("Unsupported Better Auth Account join projection.");
    if (model !== "account" || where === undefined || limit !== 2 || offset || sortBy)
      throw new Error("Unsupported Better Auth Account join page.");
    const fields = new Set(where.map((term) => term.field));
    if (
      where.length !== 2 ||
      fields.size !== 2 ||
      !fields.has("providerId") ||
      !fields.has("accountId")
    )
      throw new Error("Unsupported Better Auth Account join predicate.");
    NativePredicates.validateWhere(model, where);
    for (const term of where)
      if (
        typeof term.value !== "string" ||
        (term.operator ?? "eq") !== "eq" ||
        (term.connector ?? "AND") !== "AND" ||
        (term.mode ?? "sensitive") !== "sensitive"
      )
        throw new Error("Unsupported Better Auth Account join predicate.");
    const names = Object.keys(join);
    if (names.length !== 1 || names[0] !== "user" || join.user === undefined)
      throw new Error("Unsupported Better Auth Account join.");
    this.relation(join.user, "user", "userId", "id", "one-to-one", 1);
  },

  /**
   * Determines one exact Session→User or User→Account operation before data reads.
   *
   * @param model Selected base family.
   * @param where Effective native predicate.
   * @param select Optional native field projection.
   * @param join Effective transformed relation.
   * @returns Selected bounded relation kind.
   */
  kind(
    model: BetterAuthModel,
    where: readonly CleanedWhere[],
    select: readonly string[] | undefined,
    join: NativeJoin,
  ): "session-user" | "user-account" {
    if (select !== undefined && select.length > 0)
      throw new Error("Joined Better Auth projections are unsupported.");
    const names = Object.keys(join);
    if (names.length !== 1) throw new Error("Unsupported Better Auth join.");
    const name = names[0];
    const config = name === undefined ? undefined : join[name];
    if (config === undefined) throw new Error("Unsupported Better Auth join.");
    if (model === "session" && name === "user") {
      this.relation(config, "user", "userId", "id", "one-to-one", 1);
      this.predicate(model, where, "token");
      return "session-user";
    }
    if (model === "user" && name === "account") {
      this.relation(config, "account", "id", "userId", "one-to-many", 100);
      this.predicate(model, where, "email");
      return "user-account";
    }
    throw new Error("Unsupported Better Auth join.");
  },

  /**
   * Validates one exact indexed equality predicate for a joined base row.
   *
   * @param model Selected base family.
   * @param where Effective native predicate.
   * @param field Required indexed field.
   */
  predicate(model: BetterAuthModel, where: readonly CleanedWhere[], field: string): void {
    NativePredicates.validateWhere(model, where);
    const term = where[0];
    if (
      where.length !== 1 ||
      term?.field !== field ||
      typeof term.value !== "string" ||
      (term.operator ?? "eq") !== "eq" ||
      (term.connector ?? "AND") !== "AND" ||
      (term.mode ?? "sensitive") !== "sensitive"
    )
      throw new Error("Unsupported Better Auth joined predicate.");
  },

  /**
   * Validates the native relation keys, fields, cardinality and page size.
   *
   * @param value Effective native relation.
   * @param model Related family.
   * @param from Base join field.
   * @param to Related join field.
   * @param cardinality Native relation cardinality.
   * @param limit Native relation page size.
   */
  relation(
    value: NativeJoin[string],
    model: string,
    from: string,
    to: string,
    cardinality: "one-to-one" | "one-to-many",
    limit: number,
  ): void {
    const link: unknown = value.on;
    if (
      link === null ||
      typeof link !== "object" ||
      Object.keys(value).some((key) => !["modelKey", "on", "relation", "limit"].includes(key)) ||
      value.modelKey !== model ||
      (link as Record<string, unknown>).from !== from ||
      (link as Record<string, unknown>).to !== to ||
      value.relation !== cardinality ||
      value.limit !== limit ||
      Object.keys(link).length !== 2
    )
      throw new Error("Unsupported Better Auth relation shape.");
  },
});

/**
 * Validates and evaluates the admitted native predicate and mutation profile.
 */
const NativePredicates = Object.freeze({
  /**
   * Rejects an aborted admitted OAuth state consumption before destructive CAS.
   */
  requireLiveState(): void {
    const signal = NativeSignalContext.current();
    if (signal?.aborted) throw signal.reason ?? new Error("OIDC callback cancelled.");
  },

  /**
   * Builds the exact sensitive equality term used for a related indexed read.
   *
   * @param field Related indexed field.
   * @param value Stable relation identifier.
   * @returns Complete native equality term.
   */
  equality(field: string, value: string): CleanedWhere {
    return { field, value, operator: "eq", connector: "AND", mode: "sensitive" };
  },

  /**
   * Checks the pinned native callback's state-consumption predicate.
   *
   * @param where Native verification predicates.
   * @returns Whether this delete gates a purpose-qualified OAuth state.
   */
  isOAuthState(where: readonly CleanedWhere[]): boolean {
    return where.some(
      (term) =>
        term.field === "identifier" &&
        (term.operator ?? "eq") === "eq" &&
        typeof term.value === "string" &&
        term.value.startsWith("auth-state:"),
    );
  },

  /**
   * Validates a native model name before selecting a storage family.
   *
   * @param value Native model name.
   * @param modelKey Optional customized native model key.
   * @returns One admitted selected model name.
   */
  selectedModel(value: string, modelKey?: string): BetterAuthModel {
    value = modelKey ?? value;
    if (value === "user" || value === "account" || value === "session" || value === "verification")
      return value;
    throw new Error(`Unsupported Better Auth model: ${value}`);
  },

  /**
   * Rejects native model mutations outside the selected immutable profile.
   *
   * @param model Selected model.
   * @param update Proposed changed fields.
   * @param remove Whether the operation deletes the row.
   */
  validateMutation(model: BetterAuthModel, update: Record<string, unknown>, remove: boolean): void {
    if (model === "user" || model === "account")
      throw new Error(`${model} mutation requires controlled provisioning.`);
    if (!remove && model === "verification") throw new Error("Verification values are immutable.");
    const forbidden =
      model === "session" ? ["id", "token", "userId"] : ["id", "identifier", "value"];
    if (Object.keys(update).some((field) => forbidden.includes(field)))
      throw new Error(`Cannot change immutable ${model} identity.`);
    for (const field of Object.keys(update))
      if (!BetterAuthRecords.fields(model).includes(field))
        throw new Error(`Unsupported ${model} update field: ${field}`);
  },

  /**
   * Validates operators and fields before any provider query.
   *
   * @param model Selected model.
   * @param where Native predicate terms.
   */
  validateWhere(model: BetterAuthModel, where: readonly CleanedWhere[]): void {
    for (const term of where) {
      if (!BetterAuthRecords.queryFields(model).includes(term.field))
        throw new Error(`Unsupported ${model} query field: ${term.field}`);
      if ((term.connector ?? "AND") !== "AND" || (term.mode ?? "sensitive") !== "sensitive")
        throw new Error("Unsupported Better Auth connector or comparison mode.");
      if (!["eq", "in", "lt", "lte", "gt", "gte"].includes(term.operator ?? "eq"))
        throw new Error(`Unsupported Better Auth operator: ${String(term.operator)}`);
      if (term.operator === "in" && !Array.isArray(term.value))
        throw new TypeError("Better Auth membership requires an array.");
      const date = ["createdAt", "updatedAt", "expiresAt"].includes(term.field);
      const range = ["lt", "lte", "gt", "gte"].includes(term.operator ?? "eq");
      if (range && !date)
        throw new TypeError(`Unsupported ${model} range query field: ${term.field}.`);
      const valid = (value: unknown): boolean =>
        date
          ? value instanceof Date && Number.isFinite(value.getTime())
          : model === "user" && term.field === "emailVerified"
            ? typeof value === "boolean"
            : typeof value === "string";
      const values: readonly unknown[] =
        term.operator === "in" ? (term.value as unknown[]) : [term.value];
      if (!values.every(valid))
        throw new TypeError(`Invalid ${model} query value for ${term.field}.`);
    }
  },

  /**
   * Resolves a direct stable storage slot from complete identity predicates.
   *
   * @param model Selected model.
   * @param where Native predicate terms.
   * @returns Direct slot when an identity is specified.
   */
  exactKey(model: BetterAuthModel, where: readonly CleanedWhere[]): string | undefined {
    const equal = (field: string): unknown =>
      where.find((term) => term.field === field && (term.operator ?? "eq") === "eq")?.value;
    const id = equal("id");
    if (typeof id === "string") return id;
    if (model === "session" && typeof equal("token") === "string") return equal("token") as string;
    if (model === "verification" && typeof equal("identifier") === "string")
      return BetterAuthRecords.key(model, { identifier: equal("identifier") });
    if (
      model === "account" &&
      typeof equal("providerId") === "string" &&
      typeof equal("accountId") === "string"
    )
      return BetterAuthRecords.key(model, {
        providerId: equal("providerId"),
        accountId: equal("accountId"),
      });
    return undefined;
  },

  /**
   * Validates explicit primary-key membership before provider selection.
   *
   * @param where Native predicate terms.
   * @returns Stable deduplicated IDs when membership was requested.
   */
  idMembership(where: readonly CleanedWhere[]): string[] | undefined {
    const term = where.find((candidate) => candidate.field === "id" && candidate.operator === "in");
    if (term === undefined) return undefined;
    if (!Array.isArray(term.value) || term.value.some((value) => typeof value !== "string"))
      throw new TypeError("Better Auth ID membership requires strings.");
    return [...new Set(term.value as string[])].sort();
  },

  /**
   * Finds one declared equality index as a bounded candidate anchor.
   *
   * @param model Selected model.
   * @param where Native predicate terms.
   * @returns Physical column equality or membership filter.
   */
  indexedAnchor(
    model: BetterAuthModel,
    where: readonly CleanedWhere[],
  ): { column: string; value: unknown } | undefined {
    const columns: Record<BetterAuthModel, Record<string, string>> = {
      user: { email: "email_digest" },
      account: {
        userId: "user_digest",
        providerId: "provider_digest",
        accountId: "subject_digest",
      },
      session: { userId: "user_digest" },
      verification: {},
    };
    const term = where.find(
      (candidate) =>
        columns[model][candidate.field] !== undefined &&
        ((candidate.operator ?? "eq") === "eq" || candidate.operator === "in"),
    );
    if (term === undefined) return undefined;
    const column = columns[model][term.field];
    if (column === undefined) throw new Error("Indexed Better Auth column was not found.");
    if (term.operator === "in") {
      if (!Array.isArray(term.value) || term.value.some((value) => typeof value !== "string"))
        throw new TypeError("Indexed Better Auth membership requires strings.");
      const values = term.value as string[];
      return { column, value: values.map((value) => BetterAuthRecords.indexKey(value)) };
    }
    if (typeof term.value !== "string")
      throw new TypeError("Indexed Better Auth equality requires a string.");
    return { column, value: BetterAuthRecords.indexKey(term.value) };
  },

  /**
   * Checks every validated native predicate against one detached row.
   *
   * @param row Native row.
   * @param where Native predicate terms.
   * @returns Whether every term matches.
   */
  matches(row: Record<string, unknown>, where: readonly CleanedWhere[]): boolean {
    return where.every((term) => this.matchesTerm(row, term));
  },

  /**
   * Compares one validated native term against a detached row.
   *
   * @param row Native row selected by identity or index.
   * @param term Validated native predicate term.
   * @returns Whether the term matches the row.
   */
  matchesTerm(row: Record<string, unknown>, term: CleanedWhere): boolean {
    const left =
      row[term.field] instanceof Date ? (row[term.field] as Date).getTime() : row[term.field];
    const right = term.value instanceof Date ? term.value.getTime() : term.value;
    switch (term.operator ?? "eq") {
      case "eq":
        return left === right;
      case "in":
        return (right as unknown[])
          .map((value) => (value instanceof Date ? value.getTime() : value))
          .includes(left);
      case "lt":
        return typeof left === "number" && typeof right === "number" && left < right;
      case "lte":
        return typeof left === "number" && typeof right === "number" && left <= right;
      case "gt":
        return typeof left === "number" && typeof right === "number" && left > right;
      case "gte":
        return typeof left === "number" && typeof right === "number" && left >= right;
    }
    throw new Error(`Unsupported Better Auth operator: ${String(term.operator)}`);
  },
});
