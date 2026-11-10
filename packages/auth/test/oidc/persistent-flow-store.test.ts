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

import { create, type Message } from "@bufbuild/protobuf";
import { createHash } from "node:crypto";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  AuthenticatedPrincipalSchema,
  OidcLoginGrantSchema,
  OidcLoginTransactionSchema,
} from "@spine-event-engine/proto/auth";
import {
  InMemoryStorageFactory,
  StorageGroup,
  type RecordStorage,
  type RecordSpec,
  type RecordStorageOptions,
  type StorageContext,
} from "@spine-event-engine/storage";
import { StoragePreparations } from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";

import { OidcFlow, PersistentOidcFlowStore } from "../../src/index.js";
import { MemoryOidcFlowStore } from "../../src/oidc/flow-store.js";
import { OidcFlowKeys } from "../../src/oidc/records.js";

const group = new StorageGroup("oidc-flow-store-test");
const deadline = create(TimestampSchema, { seconds: 100n, nanos: 7 });

function transaction(flowId: string, state: string) {
  return create(OidcLoginTransactionSchema, {
    lookupDigest: OidcFlowKeys.digest(flowId, state),
    flowId,
    providerIssuer: "https://issuer.example",
    clientId: "browser-app",
    callbackUri: "https://app.example/callback?fixed=1",
    nonce: "nonce",
    providerCodeVerifier: "verifier",
    browserCodeChallenge: "challenge",
    postLoginRedirect: "https://app.example/home",
    whenExpires: deadline,
  });
}

function grant(flowId: string, value: string) {
  return create(OidcLoginGrantSchema, {
    lookupDigest: OidcFlowKeys.digest(flowId, value),
    flowId,
    principal: create(AuthenticatedPrincipalSchema, { id: "user" }),
    browserCodeChallenge: "challenge",
    postLoginRedirect: "https://app.example/home",
    whenExpires: deadline,
  });
}

describe("persistent OIDC flow store", () => {
  it("rejects invalid flow placement and non-atomic handles while retaining the factory", async () => {
    class NonAtomicFactory extends InMemoryStorageFactory {
      override createRecordStorage<I, R extends Message>(
        context: StorageContext,
        spec: RecordSpec<I, R>,
        selectedGroup?: StorageGroup,
        options?: RecordStorageOptions,
      ): RecordStorage<I, R> {
        const handle = super.createRecordStorage(context, spec, selectedGroup, options);
        Object.defineProperty(handle, "atomicCompareAndSet", { value: false });
        return handle;
      }
    }
    const factory = new NonAtomicFactory();
    const opened = vi.spyOn(factory, "createRecordStorage");
    await expect(
      PersistentOidcFlowStore.create({ storageFactory: factory, group, flowId: " " }),
    ).rejects.toThrow("flowId");
    expect(opened).not.toHaveBeenCalled();
    await expect(
      PersistentOidcFlowStore.create({ storageFactory: factory, group, flowId: "non-atomic" }),
    ).rejects.toThrow("atomic compare-and-set");
    expect(opened).toHaveBeenCalledTimes(2);
    for (const result of opened.mock.results)
      expect((result.value as RecordStorage<string, ReturnType<typeof transaction>>).isOpen()).toBe(
        false,
      );
    expect(factory.isOpen()).toBe(true);
    await factory.close();
  });

  it("retains preparation and both handle cleanup failures", async () => {
    const factory = new InMemoryStorageFactory();
    const provider = StoragePreparations.for(factory);
    let fail!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, reject) => (fail = reject));
    StoragePreparations.register(factory, {
      supportsRecordIndexes: true,
      prepareRecord: () => pending,
      prepareEntity: provider.prepareEntity.bind(provider),
      prepareAgentHistory: provider.prepareAgentHistory.bind(provider),
      prepareAgentCommit: provider.prepareAgentCommit.bind(provider),
    });
    const opened = vi.spyOn(factory, "createRecordStorage");
    const creating = PersistentOidcFlowStore.create({
      storageFactory: factory,
      group,
      flowId: "fail",
    });
    for (const [index, result] of opened.mock.results.entries())
      vi.spyOn(
        result.value as RecordStorage<string, ReturnType<typeof transaction>>,
        "close",
      ).mockImplementation(() => {
        throw new Error(`close ${String(index)}`);
      });
    fail(new Error("preparation failed"));
    await expect(creating).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: "preparation failed" }),
        expect.objectContaining({ message: "close 0" }),
        expect.objectContaining({ message: "close 1" }),
      ],
    });
    expect(factory.isOpen()).toBe(true);
    await factory.close();
  });

  it("releases the first handle after second acquisition fails", async () => {
    class InterruptedFactory extends InMemoryStorageFactory {
      requests = 0;

      override createRecordStorage<I, R extends Message>(
        context: StorageContext,
        spec: RecordSpec<I, R>,
        selectedGroup?: StorageGroup,
        options?: RecordStorageOptions,
      ): RecordStorage<I, R> {
        this.requests += 1;
        if (this.requests === 2) throw new Error("second handle failed");
        return super.createRecordStorage(context, spec, selectedGroup, options);
      }
    }
    const factory = new InterruptedFactory();
    const opened = vi.spyOn(factory, "createRecordStorage");
    await expect(
      PersistentOidcFlowStore.create({ storageFactory: factory, group, flowId: "interrupted" }),
    ).rejects.toThrow("second handle failed");
    const first = opened.mock.results[0]?.value as RecordStorage<
      string,
      ReturnType<typeof transaction>
    >;
    expect(first.isOpen()).toBe(false);
    expect(factory.isOpen()).toBe(true);
    const next = await PersistentOidcFlowStore.create({
      storageFactory: factory,
      group,
      flowId: "next",
    });
    await next.close();
    await factory.close();
  });

  it("rejects invalid records, future maintenance, cancellation and work after close", async () => {
    const factory = new InMemoryStorageFactory();
    const opened = vi.spyOn(factory, "createRecordStorage");
    const store = await PersistentOidcFlowStore.create({
      storageFactory: factory,
      group,
      flowId: "validated",
      clock: () => create(TimestampSchema, { seconds: 200n }),
    });
    const state = transaction("validated", "state");
    await expect(store.insertTransaction(transaction("different", "state"))).rejects.toThrow(
      "identity",
    );
    await expect(
      store.insertGrant(
        create(OidcLoginGrantSchema, { ...grant("validated", "bad"), lookupDigest: "invalid" }),
      ),
    ).rejects.toThrow("identity");
    const controller = new AbortController();
    const reason = new Error("maintenance cancelled");
    controller.abort(reason);
    await expect(store.purgeExpired(deadline, controller.signal)).rejects.toBe(reason);
    await expect(store.purgeExpired(create(TimestampSchema, { seconds: 201n }))).rejects.toThrow(
      "trusted clock",
    );
    expect(await store.insertTransaction(state)).toBe(true);
    expect(await store.insertTransaction(state)).toBe(false);
    const handles = opened.mock.results.map(
      (result) => result.value as RecordStorage<string, ReturnType<typeof transaction>>,
    );
    const transactions = handles[0];
    const grants = handles[1];
    if (transactions === undefined || grants === undefined)
      throw new Error("expected both handles");
    vi.spyOn(transactions, "close").mockImplementation(() => {
      throw new Error("transaction close failed");
    });
    vi.spyOn(grants, "close").mockImplementation(() => {
      throw new Error("grant close failed");
    });
    await expect(store.close()).rejects.toMatchObject({
      errors: [expect.any(Error), expect.any(Error)],
    });
    await expect(store.close()).rejects.toThrow("handle close failed");
    await expect(store.readTransaction(state.lookupDigest)).rejects.toThrow("closed");
    expect(factory.isOpen()).toBe(true);
    await factory.close();
  });

  it("does not report a cancelled collision as an ordinary false insertion", async () => {
    const factory = new InMemoryStorageFactory();
    const opened = vi.spyOn(factory, "createRecordStorage");
    const store = await PersistentOidcFlowStore.create({
      storageFactory: factory,
      group,
      flowId: "late-collision",
    });
    const handle = opened.mock.results[0]?.value as RecordStorage<
      string,
      ReturnType<typeof transaction>
    >;
    const state = transaction("late-collision", "state");
    const controller = new AbortController();
    const reason = new Error("request cancelled");
    const collision = vi.spyOn(handle, "compareAndSet").mockImplementation(() => {
      controller.abort(reason);
      return Promise.resolve(false);
    });
    await expect(store.insertTransaction(state, controller.signal)).rejects.toBe(reason);
    expect(await store.readTransaction(state.lookupDigest)).toBeUndefined();
    collision.mockRestore();
    expect(await store.insertTransaction(state)).toBe(true);
    await store.close();
    await factory.close();
  });

  it("admits one callback and one session issue across independent flow instances", async () => {
    const factory = new InMemoryStorageFactory();
    const first = await PersistentOidcFlowStore.create({
      storageFactory: factory,
      group,
      flowId: "shared-login",
    });
    const second = await PersistentOidcFlowStore.create({
      storageFactory: factory,
      group,
      flowId: "shared-login",
      createMissingStructures: false,
    });
    const verifier = "v".repeat(43);
    const browserCodeChallenge = createHash("sha256").update(verifier).digest("base64url");
    let exchanges = 0;
    let issues = 0;
    const configure = (store: PersistentOidcFlowStore) =>
      new OidcFlow({
        authorizationEndpoint: "https://issuer.example/authorize",
        callbackUri: "https://app.example/callback",
        clientId: "browser-app",
        scopes: ["openid"],
        allowedPostLoginRedirects: ["https://app.example/home"],
        provider: {
          issuer: "https://issuer.example",
          exchangeAuthorizationCode: () => {
            exchanges += 1;
            return Promise.resolve({ issuer: "https://issuer.example", subject: "person" });
          },
        },
        identityMapping: {
          resolve: (externalIdentity) =>
            Promise.resolve({ externalIdentity, principal: { id: "person" } }),
        },
        sessionIssuer: {
          issue: () => {
            issues += 1;
            return Promise.resolve({
              credential: { kind: "cookie" as const, value: "session" },
              session: { principal: { id: "person" }, expiresAt: deadline },
            });
          },
        },
        store,
        clock: { now: () => 1_000 },
      });
    const flowA = configure(first);
    const flowB = configure(second);
    try {
      const started = await flowA.start({
        browserCodeChallenge,
        postLoginRedirect: "https://app.example/home",
      });
      if (started.kind !== "started") throw new Error("Expected start.");
      const state = new URL(started.authorizationUrl).searchParams.get("state");
      if (state === null) throw new Error("Expected state.");
      const callbacks = await Promise.all([
        flowA.callback({ state, code: "code" }),
        flowB.callback({ state, code: "code" }),
      ]);
      expect(callbacks.filter((result) => result.kind === "granted")).toHaveLength(1);
      expect(exchanges).toBe(1);
      const accepted = callbacks.find((result) => result.kind === "granted");
      if (accepted?.kind !== "granted") throw new Error("Expected grant.");
      const issued = await Promise.all([
        flowA.exchange({ grant: accepted.grant, browserCodeVerifier: verifier }),
        flowB.exchange({ grant: accepted.grant, browserCodeVerifier: verifier }),
      ]);
      expect(issued.filter((result) => result.kind === "issued")).toHaveLength(1);
      expect(issues).toBe(1);
    } finally {
      await flowA.close();
      await flowB.close();
      await first.close();
      await second.close();
      await factory.close();
    }
  });

  it("lets one independent handle consume each complete transaction and grant", async () => {
    const factory = new InMemoryStorageFactory();
    const first = await PersistentOidcFlowStore.create({
      storageFactory: factory,
      group,
      flowId: "employee-login",
    });
    const second = await PersistentOidcFlowStore.create({
      storageFactory: factory,
      group,
      flowId: "employee-login",
      createMissingStructures: false,
    });
    const state = transaction("employee-login", "state");
    const applicationGrant = grant("employee-login", "grant");
    expect(await first.insertTransaction(state)).toBe(true);
    expect(await second.insertTransaction(state)).toBe(false);
    expect(await second.readTransaction(state.lookupDigest)).toEqual(state);
    expect(
      (
        await Promise.all([first.consumeTransaction(state), second.consumeTransaction(state)])
      ).sort(),
    ).toEqual([false, true]);
    expect(await first.readTransaction(state.lookupDigest)).toBeUndefined();
    expect(await second.insertGrant(applicationGrant)).toBe(true);
    expect(
      (
        await Promise.all([
          first.consumeGrant(applicationGrant),
          second.consumeGrant(applicationGrant),
        ])
      ).sort(),
    ).toEqual([false, true]);
    expect(await first.readGrant(applicationGrant.lookupDigest)).toBeUndefined();
    await first.close();
    await second.close();
    expect(factory.isOpen()).toBe(true);
    await factory.close();
  });

  it("qualifies identical browser material by flow and prepares only selected handles", async () => {
    const factory = new InMemoryStorageFactory();
    const provider = StoragePreparations.for(factory);
    let prepares = 0;
    StoragePreparations.register(factory, {
      supportsRecordIndexes: true,
      prepareRecord: async (context, spec, storageGroup, mode) => {
        prepares += 1;
        await provider.prepareRecord(context, spec, storageGroup, mode);
      },
      prepareEntity: provider.prepareEntity.bind(provider),
      prepareAgentHistory: provider.prepareAgentHistory.bind(provider),
      prepareAgentCommit: provider.prepareAgentCommit.bind(provider),
    });
    const skipped = await PersistentOidcFlowStore.create({
      storageFactory: factory,
      group,
      flowId: "other-login",
      createMissingStructures: false,
    });
    expect(prepares).toBe(0);
    const prepared = await PersistentOidcFlowStore.create({
      storageFactory: factory,
      group,
      flowId: "employee-login",
    });
    expect(prepares).toBe(2);
    const other = transaction("other-login", "same-state");
    const employee = transaction("employee-login", "same-state");
    expect(other.lookupDigest).not.toBe(employee.lookupDigest);
    expect(await skipped.insertTransaction(other)).toBe(true);
    expect(await prepared.insertTransaction(employee)).toBe(true);
    expect(await prepared.readTransaction(other.lookupDigest)).toBeUndefined();
    await skipped.close();
    await prepared.close();
    await factory.close();
  });

  it("bounds indexed expiry discovery to one flow despite many other-flow records", async () => {
    const factory = new InMemoryStorageFactory();
    const opened = vi.spyOn(factory, "createRecordStorage");
    const target = await PersistentOidcFlowStore.create({
      storageFactory: factory,
      group,
      flowId: "employee-login",
      clock: () => create(TimestampSchema, { seconds: 200n }),
    });
    const other = await PersistentOidcFlowStore.create({
      storageFactory: factory,
      group,
      flowId: "other-login",
      createMissingStructures: false,
    });
    for (let index = 0; index < 80; index += 1)
      await other.insertTransaction(transaction("other-login", `state-${String(index)}`));
    const selected = transaction("employee-login", "selected-state");
    await target.insertTransaction(selected);
    const handle = opened.mock.results[0]?.value as RecordStorage<
      string,
      ReturnType<typeof transaction>
    >;
    const query = handle.queryPlanEntries.bind(handle);
    const requested = vi.spyOn(handle, "queryPlanEntries").mockImplementation(async (plan) => {
      expect(plan.predicate).toMatchObject({ kind: "all" });
      const found = await query(plan);
      expect(found.every((entry) => entry.record.flowId === "employee-login")).toBe(true);
      return found;
    });
    expect(await target.purgeExpired(deadline)).toEqual({ transactions: 1, grants: 0 });
    expect(requested).toHaveBeenCalledTimes(2);
    expect(
      await other.readTransaction(OidcFlowKeys.digest("other-login", "state-0")),
    ).toBeDefined();
    await target.close();
    await other.close();
    await factory.close();
  });

  it("pages every record at one exact expiry without a new maintenance cap", async () => {
    const factory = new InMemoryStorageFactory();
    const opened = vi.spyOn(factory, "createRecordStorage");
    const store = await PersistentOidcFlowStore.create({
      storageFactory: factory,
      group,
      flowId: "paged-login",
      clock: () => create(TimestampSchema, { seconds: 200n }),
    });
    try {
      for (let index = 0; index < 7; index += 1)
        expect(
          await store.insertTransaction(transaction("paged-login", `state-${String(index)}`)),
        ).toBe(true);
      const handle = opened.mock.results[0]?.value as RecordStorage<
        string,
        ReturnType<typeof transaction>
      >;
      const query = handle.queryEntries.bind(handle);
      const pages: number[] = [];
      vi.spyOn(handle, "queryEntries").mockImplementation(async (request) => {
        const result = await query({ ...request, limit: 2 });
        pages.push(result.length);
        return result;
      });
      expect(await store.purgeExpired(deadline)).toEqual({ transactions: 7, grants: 0 });
      expect(pages.filter((size) => size === 2).length).toBeGreaterThanOrEqual(3);
      expect(
        await store.readTransaction(OidcFlowKeys.digest("paged-login", "state-0")),
      ).toBeUndefined();
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it("stops after a changed expiry row and drains the pending CAS before close", async () => {
    const factory = new InMemoryStorageFactory();
    const opened = vi.spyOn(factory, "createRecordStorage");
    const store = await PersistentOidcFlowStore.create({
      storageFactory: factory,
      group,
      flowId: "racing-login",
      clock: () => create(TimestampSchema, { seconds: 200n }),
    });
    const reader = await PersistentOidcFlowStore.create({
      storageFactory: factory,
      group,
      flowId: "racing-login",
      createMissingStructures: false,
    });
    const original = transaction("racing-login", "state");
    const extended = create(OidcLoginTransactionSchema, {
      ...original,
      whenExpires: create(TimestampSchema, { seconds: 150n }),
    });
    try {
      expect(await store.insertTransaction(original)).toBe(true);
      const handle = opened.mock.results[0]?.value as RecordStorage<
        string,
        ReturnType<typeof transaction>
      >;
      const cas = handle.compareAndSet.bind(handle);
      let entered!: () => void;
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.spyOn(handle, "compareAndSet").mockImplementation(async (id, expected, replacement) => {
        if (id === original.lookupDigest && replacement === undefined) {
          entered();
          await pending;
          expect(await cas(id, expected, extended)).toBe(true);
        }
        return cas(id, expected, replacement);
      });
      const purge = store.purgeExpired(deadline);
      await waiting;
      let closed = false;
      const closing = store.close().then(() => {
        closed = true;
      });
      expect(closed).toBe(false);
      release();
      await expect(purge).resolves.toEqual({ transactions: 0, grants: 0 });
      await closing;
      expect(await reader.readTransaction(original.lookupDigest)).toEqual(extended);
    } finally {
      await store.close();
      await reader.close();
      await factory.close();
    }
  });
});

describe("local OIDC flow records", () => {
  it("rejects invalid local flow capacity configuration", () => {
    expect(() => new MemoryOidcFlowStore("", () => deadline, 1, 1)).toThrow("configuration");
    expect(() => new MemoryOidcFlowStore("valid", () => deadline, 0, 1)).toThrow("configuration");
    expect(() => new MemoryOidcFlowStore("valid", () => deadline, 1, 0)).toThrow("configuration");
  });

  it("keeps absent and explicitly empty principal attributes distinct", () => {
    const absent = grant("local", "absent");
    const empty = create(OidcLoginGrantSchema, {
      ...absent,
      principal: create(AuthenticatedPrincipalSchema, { id: "user", attributes: { values: {} } }),
    });
    expect(OidcFlowKeys.principal(absent)).toEqual({ id: "user" });
    expect(OidcFlowKeys.principal(empty)).toEqual({ id: "user", attributes: {} });
    expect(() =>
      OidcFlowKeys.principal(create(OidcLoginGrantSchema, { ...absent, principal: undefined })),
    ).toThrow("principal");
    expect(() =>
      OidcFlowKeys.expiry(
        create(OidcLoginTransactionSchema, {
          ...transaction("local", "missing"),
          whenExpires: undefined,
        }),
      ),
    ).toThrow("expiry");
    expect(() => OidcFlowKeys.digest("", "state")).toThrow("nonempty");
    expect(() => OidcFlowKeys.digest("local", "")).toThrow("nonempty");
  });

  it("enforces local capacity, complete CAS, flow identity, cutoff and closure", async () => {
    const now = create(TimestampSchema, { seconds: 200n });
    const store = new MemoryOidcFlowStore("local", () => now, 1, 1);
    const state = transaction("local", "state");
    const applicationGrant = grant("local", "grant");
    expect(await store.insertTransaction(state)).toBe(true);
    expect(await store.insertTransaction(state)).toBe(false);
    expect(await store.insertTransaction(transaction("local", "other"))).toBe(false);
    expect(
      await store.consumeTransaction(
        create(OidcLoginTransactionSchema, { ...state, nonce: "changed" }),
      ),
    ).toBe(false);
    expect(await store.consumeTransaction(state)).toBe(true);
    expect(await store.consumeTransaction(state)).toBe(false);
    expect(await store.insertGrant(applicationGrant)).toBe(true);
    expect(await store.insertGrant(applicationGrant)).toBe(false);
    expect(await store.insertGrant(grant("local", "other"))).toBe(false);
    expect(
      await store.consumeGrant(
        create(OidcLoginGrantSchema, { ...applicationGrant, browserCodeChallenge: "changed" }),
      ),
    ).toBe(false);
    expect(await store.consumeGrant(applicationGrant)).toBe(true);
    expect(await store.consumeGrant(applicationGrant)).toBe(false);
    expect(() => store.insertTransaction(transaction("foreign", "state"))).toThrow("identity");
    expect(() => store.purgeExpired(create(TimestampSchema, { seconds: 201n }))).toThrow(
      "trusted clock",
    );
    expect(await store.insertTransaction(state)).toBe(true);
    expect(await store.purgeExpired(create(TimestampSchema, { seconds: 99n }))).toEqual({
      transactions: 0,
      grants: 0,
    });
    expect(await store.purgeExpired(deadline)).toEqual({ transactions: 1, grants: 0 });
    await store.close();
    expect(() => store.readTransaction(state.lookupDigest)).toThrow("closed");
  });
});
