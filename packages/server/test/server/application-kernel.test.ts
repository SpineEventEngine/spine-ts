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

import { afterEach, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { InMemoryTransportFactory } from "@spine-event-engine/transport";

import { Application } from "../../src/server/application.js";
import { BoundedContext, boundedContextAccess } from "../../src/context/bounded-context.js";
import { EnvironmentType } from "../../src/server/environment.js";
import { ServerEnvironment } from "../../src/server/server-environment.js";
import { Repository } from "../../src/repository/repository.js";
import { ServerStatusProjection } from "./generated-server-registry-fixture.js";
import { ServerStatusSchema } from "../../test-fixtures/generated/server-lifecycle/states_pb.js";
import { ThirdPartyContext } from "../../src/integration/third-party-context.js";
import { InMemorySubscriptionRegistry } from "../../src/stand/subscription-registry.js";
import { TestTenantIndex } from "../tenant-index-fixture.js";
import { tenant } from "../tenant-fixture.js";
import { TenantIdSchema, TenantSchema } from "@spine-event-engine/proto";
import { StoragePreparations } from "@spine-event-engine/storage/provider";

const applications: Application[] = [];

afterEach(async () => {
  for (const application of applications.splice(0).reverse()) await application.close();
});

it("builds distinct environments synchronously without opening storage", () => {
  const storage = new InMemoryStorageFactory();
  const connection = vi.spyOn(storage, "checkConnection");
  const builder = () =>
    ServerEnvironment.newBuilder()
      .under(EnvironmentType.Local, (setting) => {
        setting.use({ storageFactory: storage });
      })
      .build();
  const first = builder();
  const second = builder();
  expect(first).not.toBe(second);
  expect(first.storageFactory).toBe(storage);
  expect(connection).not.toHaveBeenCalled();
});

it("merges profile settings by field and rejects retained configurator use after build", () => {
  const storage = new InMemoryStorageFactory();
  const replacement = new InMemoryStorageFactory();
  const transport = new InMemoryTransportFactory();
  const settings = { storageFactory: storage };
  let retained: { use(settings: { storageFactory?: InMemoryStorageFactory }): void } | undefined;
  const builder = ServerEnvironment.newBuilder()
    .under(EnvironmentType.Local, (setting) => {
      retained = setting;
      setting.use(settings);
      setting.use({ integrationChannelFactory: transport });
    })
    .under(EnvironmentType.Local, (setting) => {
      setting.use({ subscriptionQueueCapacity: 7 });
    });
  settings.storageFactory = replacement;
  const environment = builder.build();
  expect(environment.storageFactory).toBe(storage);
  expect(environment.integrationChannelFactory).toBe(transport);
  expect(environment.subscriptionQueueCapacity).toBe(7);
  expect(() => retained?.use({ storageFactory: replacement })).toThrow(/already used/i);
});

it("rejects new profile configuration after environment build without invoking its callback", async () => {
  const builder = ServerEnvironment.newBuilder();
  const environment = builder.build();
  const configure = vi.fn();
  expect(() => builder.under(EnvironmentType.Local, configure)).toThrow(/already used/);
  expect(configure).not.toHaveBeenCalled();
  await environment.close();
});

it("rejects asynchronous profile configuration before a late use can change settings", async () => {
  const late = Promise.withResolvers<undefined>();
  const storage = new InMemoryStorageFactory();
  const builder = ServerEnvironment.newBuilder();
  const configure = async (setting: {
    use(settings: { storageFactory: InMemoryStorageFactory }): void;
  }) => {
    await late.promise;
    setting.use({ storageFactory: storage });
  };
  expect(() =>
    builder.under(
      EnvironmentType.Local,
      configure as unknown as (setting: {
        use(settings: { storageFactory: InMemoryStorageFactory }): void;
      }) => void,
    ),
  ).toThrow(/synchronous|async/i);
  late.resolve(undefined);
  await Promise.resolve();
  await expect(late.promise).resolves.toBeUndefined();
  expect(() => builder.build()).toThrow(/already used/i);
});

it("builds two applications with the same Bounded Context name in separate environments", async () => {
  const build = async () => {
    const application = await Application.newBuilder()
      .setServerEnvironment(ServerEnvironment.newBuilder().build())
      .add(BoundedContext.singleTenant("Tasks"))
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    applications.push(application);
    return application;
  };
  const first = await build();
  const second = await build();
  expect(first.contexts().map((context) => context.name.value)).toEqual(["Tasks"]);
  expect(second.contexts().map((context) => context.name.value)).toEqual(["Tasks"]);
});

it("rejects repeated Bounded Context names before connecting storage", async () => {
  const storage = new InMemoryStorageFactory();
  const connection = vi.spyOn(storage, "checkConnection");
  const builder = Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("Tasks"))
    .add(BoundedContext.singleTenant("Tasks"));
  await expect(builder.build()).rejects.toThrow(/duplicate|already|Tasks/i);
  expect(connection).not.toHaveBeenCalled();
});

it("rejects a transport without initialization before checking storage", async () => {
  const storage = new InMemoryStorageFactory();
  const checkConnection = vi.spyOn(storage, "checkConnection");
  const closeStorage = vi.spyOn(storage, "close");
  const closeTransport = vi.fn(() => Promise.resolve());
  const builder = Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({
            storageFactory: storage,
            integrationChannelFactory: { close: closeTransport } as never,
          });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("Tasks"));
  await expect(builder.build()).rejects.toThrow(/TransportFactory.initialize is required/);
  expect(checkConnection).not.toHaveBeenCalled();
  expect(closeTransport).toHaveBeenCalledOnce();
  expect(closeStorage).toHaveBeenCalledOnce();
});

it("rejects an Application without Bounded Contexts before opening storage", async () => {
  const storage = new InMemoryStorageFactory();
  const checkConnection = vi.spyOn(storage, "checkConnection");
  const builder = Application.newBuilder().setServerEnvironment(
    ServerEnvironment.newBuilder()
      .under(EnvironmentType.Local, (setting) => {
        setting.use({ storageFactory: storage });
      })
      .build(),
  );
  await expect(builder.build()).rejects.toThrow(/requires a Bounded Context/);
  expect(checkConnection).not.toHaveBeenCalled();
  await builder.close();
});

it("rejects incomplete remote Delivery ports and closes shared storage", async () => {
  const storage = new InMemoryStorageFactory();
  const closeStorage = vi.spyOn(storage, "close");
  const closeRemote = vi.fn(() => Promise.resolve());
  const builder = Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({
            storageFactory: storage,
            delivery: { open: () => Promise.resolve(), close: closeRemote },
          });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("Tasks"));
  await expect(builder.build()).rejects.toThrow(/requires inbox and workRegistry ports/);
  expect(closeRemote).toHaveBeenCalledOnce();
  expect(closeStorage).toHaveBeenCalledOnce();
});

it("retires an Application builder after preflight failure or unused close", async () => {
  const failed = Application.newBuilder().add(BoundedContext.singleTenant("Tasks"));
  await expect(failed.build()).rejects.toThrow(/ServerEnvironment/);
  expect(() => failed.setServerEnvironment(ServerEnvironment.newBuilder().build())).toThrow(
    /already used/i,
  );
  await failed.close();
  const unused = Application.newBuilder();
  await unused.close();
  expect(() => unused.add(BoundedContext.singleTenant("Later"))).toThrow(/already used/i);
});

it("keeps a built Application active when its retired builder is closed", async () => {
  const builder = Application.newBuilder()
    .setServerEnvironment(ServerEnvironment.newBuilder().build())
    .add(BoundedContext.singleTenant("Tasks"));
  const application = await builder.build({
    createStorageStructures: false,
    startSubscriptionMonitoring: false,
  });
  await expect(builder.close()).rejects.toThrow(/built Application/);
  expect(application.contexts()[0]?.stand()).toBeDefined();
  await application.close();
});

it("does not release an environment claim while its Application build is pending", async () => {
  const storage = new InMemoryStorageFactory();
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  vi.spyOn(storage, "checkConnection").mockImplementation(() => {
    entered.resolve(undefined);
    return release.promise;
  });
  const environment = ServerEnvironment.newBuilder()
    .under(EnvironmentType.Local, (setting) => {
      setting.use({ storageFactory: storage });
    })
    .build();
  const builder = Application.newBuilder()
    .setServerEnvironment(environment)
    .add(BoundedContext.singleTenant("Tasks"));
  const building = builder.build({
    createStorageStructures: false,
    startSubscriptionMonitoring: false,
  });
  await entered.promise;
  await expect(builder.close()).rejects.toThrow(/build.*progress|building/i);
  await expect(
    Application.newBuilder()
      .setServerEnvironment(environment)
      .add(BoundedContext.singleTenant("Other"))
      .build(),
  ).rejects.toThrow(/claimed/i);
  release.resolve(undefined);
  const application = await building;
  await application.close();
});

it("retains every failed partial Bounded Context across concurrent builder cleanup", async () => {
  const storage = new InMemoryStorageFactory();
  const provider = StoragePreparations.for(storage);
  StoragePreparations.register(storage, {
    supportsRecordIndexes: provider.supportsRecordIndexes === true,
    prepareRecord: (context, spec, group, mode) =>
      context.name === "Third"
        ? Promise.reject(new Error("third preparation failed"))
        : provider.prepareRecord(context, spec, group, mode),
    prepareEntity: provider.prepareEntity.bind(provider),
    prepareAgentHistory: provider.prepareAgentHistory.bind(provider),
    prepareAgentCommit: provider.prepareAgentCommit.bind(provider),
  });
  const firstRegistry = new InMemorySubscriptionRegistry();
  const secondRegistry = new InMemorySubscriptionRegistry();
  const firstClose = firstRegistry.close.bind(firstRegistry);
  const secondClose = secondRegistry.close.bind(secondRegistry);
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  let firstCalls = 0;
  let secondCalls = 0;
  vi.spyOn(firstRegistry, "close").mockImplementation(() =>
    ++firstCalls <= 3 ? Promise.reject(new Error("first close failed")) : firstClose(),
  );
  vi.spyOn(secondRegistry, "close").mockImplementation(async () => {
    if (++secondCalls <= 2) throw new Error("second close failed");
    if (secondCalls === 3) {
      entered.resolve(undefined);
      await release.promise;
    }
    await secondClose();
  });
  const builder = Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("First").withSubscriptionRegistry(firstRegistry))
    .add(BoundedContext.singleTenant("Second").withSubscriptionRegistry(secondRegistry))
    .add(BoundedContext.singleTenant("Third"));
  await expect(builder.build()).rejects.toThrow();
  const left = builder.close();
  const right = builder.close();
  const leftResult = left.catch((error: unknown) => error);
  const rightResult = right.catch((error: unknown) => error);
  await entered.promise;
  release.resolve(undefined);
  expect(await leftResult).toBeInstanceOf(AggregateError);
  expect(await rightResult).toBeInstanceOf(AggregateError);
  await builder.close();
  expect(firstCalls).toBe(4);
  expect(secondCalls).toBe(3);
});

it("returns one lazy default tenant index without opening tenant storage", async () => {
  const storage = new InMemoryStorageFactory();
  const records = vi.spyOn(storage, "createRecordStorage");
  const application = await Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("OnlySingle"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  applications.push(application);
  const openedAtBuild = records.mock.calls.length;
  expect(application.tenantIndex()).toBe(application.tenantIndex());
  expect(records).toHaveBeenCalledTimes(openedAtBuild);
});

it("coalesces default tenant index opening and supports keep, all, and finite pages", async () => {
  const storage = new InMemoryStorageFactory();
  const createRecord = vi.spyOn(storage, "createRecordStorage");
  const application = await Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  applications.push(application);
  const index = application.tenantIndex();
  const first = tenant("alpha");
  const second = tenant("beta");
  await Promise.all([index.keep(first), index.keep(second), index.contains(first)]);
  expect(
    (await index.all()).map((id) => (id.kind.case === "value" ? id.kind.value : undefined)),
  ).toEqual(["alpha", "beta"]);
  const page = await index.page({ count: 1, signal: new AbortController().signal });
  expect(page.ids).toHaveLength(1);
  expect(page.hasMore).toBe(true);
  expect(
    createRecord.mock.calls.filter(([, spec]) => spec.recordType === TenantSchema),
  ).toHaveLength(1);
});

it("uses the supplied tenant index without opening a default persistent index", async () => {
  const storage = new InMemoryStorageFactory();
  const createRecord = vi.spyOn(storage, "createRecordStorage");
  const supplied = new TestTenantIndex();
  const closeIndex = vi.spyOn(supplied, "close");
  const application = await Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .setTenantIndex(supplied)
    .add(BoundedContext.multiTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  expect(application.tenantIndex()).toBe(supplied);
  await application.tenantIndex().keep(tenant("custom"));
  await application.close();
  expect(closeIndex).toHaveBeenCalledOnce();
  expect(createRecord.mock.calls.some(([, spec]) => spec.recordType === TenantSchema)).toBe(false);
});

it("rejects a second Application claiming the same environment before setup", async () => {
  const environment = ServerEnvironment.newBuilder().build();
  const first = await Application.newBuilder()
    .setServerEnvironment(environment)
    .add(BoundedContext.singleTenant("First"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  applications.push(first);
  await expect(
    Application.newBuilder()
      .setServerEnvironment(environment)
      .add(BoundedContext.singleTenant("Second"))
      .build(),
  ).rejects.toThrow(/claimed/i);
});

it("does not release another Application claim when an unused builder closes", async () => {
  const environment = ServerEnvironment.newBuilder().build();
  const first = await Application.newBuilder()
    .setServerEnvironment(environment)
    .add(BoundedContext.singleTenant("First"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  applications.push(first);
  await Application.newBuilder().setServerEnvironment(environment).close();
  await expect(
    Application.newBuilder()
      .setServerEnvironment(environment)
      .add(BoundedContext.singleTenant("Second"))
      .build(),
  ).rejects.toThrow(/claimed/i);
});

it("rejects a generated System name collision before connecting storage", async () => {
  const storage = new InMemoryStorageFactory();
  const connection = vi.spyOn(storage, "checkConnection");
  const builder = Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("Tasks"))
    .add(BoundedContext.singleTenant("Tasks_System"));
  await expect(builder.build()).rejects.toThrow(/System|duplicate|collision/i);
  expect(connection).not.toHaveBeenCalled();
});

it("rejects duplicate Entity state types before connecting storage", async () => {
  const storage = new InMemoryStorageFactory();
  const connection = vi.spyOn(storage, "checkConnection");
  const builder = Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(
      BoundedContext.singleTenant("One").add(
        new Repository({
          entityType: ServerStatusProjection,
          schema: ServerStatusSchema,
        }),
      ),
    )
    .add(
      BoundedContext.singleTenant("Two").add(
        new Repository({
          entityType: ServerStatusProjection,
          schema: ServerStatusSchema,
        }),
      ),
    );
  await expect(builder.build()).rejects.toThrow(/Entity|state|registered/i);
  expect(connection).not.toHaveBeenCalled();
});

it("keeps a ThirdPartyContext unattached until its Application succeeds", async () => {
  const external = ThirdPartyContext.singleTenant("Calendar");
  expect(external.isOpen()).toBe(false);
  await external.close();
  const application = await Application.newBuilder()
    .setServerEnvironment(ServerEnvironment.newBuilder().build())
    .add(BoundedContext.singleTenant("Tasks"))
    .add(external)
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  applications.push(application);
  expect(external.isOpen()).toBe(true);
  expect(application.contexts().map((context) => context.name.value)).toEqual([
    "Tasks",
    "Calendar",
  ]);
  await application.close();
  expect(external.isOpen()).toBe(false);
});

it("rejects constructing an Application without a completed builder", () => {
  expect(() => {
    Reflect.construct(Application, [
      ServerEnvironment.newBuilder().build(),
      [],
      undefined,
      undefined,
      Symbol("foreign"),
    ]);
  }).toThrow(/builder/i);
});

it("rejects attaching one ThirdPartyContext to a second Application", async () => {
  const external = ThirdPartyContext.singleTenant("Calendar");
  const first = await Application.newBuilder()
    .setServerEnvironment(ServerEnvironment.newBuilder().build())
    .add(external)
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  applications.push(first);
  await expect(
    Application.newBuilder()
      .setServerEnvironment(ServerEnvironment.newBuilder().build())
      .add(external)
      .build(),
  ).rejects.toThrow(/attached/i);
});

it("retains environment storage when a Bounded Context close fails", async () => {
  const storage = new InMemoryStorageFactory();
  const storageClose = vi.spyOn(storage, "close");
  const registry = new InMemorySubscriptionRegistry();
  vi.spyOn(registry, "close").mockRejectedValueOnce(new Error("registry close failed"));
  const application = await Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("Tasks").withSubscriptionRegistry(registry))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  await expect(application.close()).rejects.toThrow(/close failed/i);
  expect(storageClose).not.toHaveBeenCalled();
});

it("reports two Bounded Context close failures and retries both before shared storage", async () => {
  const storage = new InMemoryStorageFactory();
  const closeStorage = vi.spyOn(storage, "close");
  const firstRegistry = new InMemorySubscriptionRegistry();
  const secondRegistry = new InMemorySubscriptionRegistry();
  const closeFirst = vi
    .spyOn(firstRegistry, "close")
    .mockRejectedValueOnce(new Error("first registry close failed"));
  const closeSecond = vi
    .spyOn(secondRegistry, "close")
    .mockRejectedValueOnce(new Error("second registry close failed"));
  const application = await Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("First").withSubscriptionRegistry(firstRegistry))
    .add(BoundedContext.singleTenant("Second").withSubscriptionRegistry(secondRegistry))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  const failure = await application.close().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors).toHaveLength(2);
  expect(closeStorage).not.toHaveBeenCalled();
  await expect(application.close()).resolves.toBeUndefined();
  expect(closeFirst).toHaveBeenCalledTimes(2);
  expect(closeSecond).toHaveBeenCalledTimes(2);
  expect(closeStorage).toHaveBeenCalledOnce();
});

it("retries required-startup facility cleanup after automatic and builder retries fail", async () => {
  const storage = new InMemoryStorageFactory();
  const provider = StoragePreparations.for(storage);
  const startup = new Error("required startup preparation failed");
  StoragePreparations.register(storage, {
    supportsRecordIndexes: provider.supportsRecordIndexes === true,
    prepareRecord: () => Promise.reject(startup),
    prepareEntity: provider.prepareEntity.bind(provider),
    prepareAgentHistory: provider.prepareAgentHistory.bind(provider),
    prepareAgentCommit: provider.prepareAgentCommit.bind(provider),
  });
  const originalClose = storage.close.bind(storage);
  let closeAttempts = 0;
  const closeStorage = vi.spyOn(storage, "close").mockImplementation(() => {
    if (++closeAttempts < 5) return Promise.reject(new Error("facility close failed"));
    return originalClose();
  });
  const environment = ServerEnvironment.newBuilder()
    .under(EnvironmentType.Local, (setting) => {
      setting.use({ storageFactory: storage });
    })
    .build();
  const builder = Application.newBuilder()
    .setServerEnvironment(environment)
    .add(BoundedContext.singleTenant("Tasks"));
  const buildFailure = await builder.build().catch((error: unknown) => error);
  expect(buildFailure).toBeInstanceOf(AggregateError);
  expect(closeStorage).toHaveBeenCalledTimes(2);
  await expect(builder.close()).rejects.toThrow(/Environment retry cleanup failed/);
  expect(closeStorage).toHaveBeenCalledTimes(3);
  await expect(environment.close()).rejects.toThrow(/required|startup/i);
  expect(closeStorage).toHaveBeenCalledTimes(3);
  const retryFailure = await environment.close().catch((error: unknown) => error);
  expect(retryFailure).toBeInstanceOf(AggregateError);
  expect(closeStorage).toHaveBeenCalledTimes(4);
  await expect(environment.close()).rejects.toBe(startup);
  expect(closeStorage).toHaveBeenCalledTimes(5);
  await builder.close();
  expect(closeStorage).toHaveBeenCalledTimes(5);
});

it("keeps the environment open until a failed tenant index close is retried", async () => {
  const storage = new InMemoryStorageFactory();
  const closeStorage = vi.spyOn(storage, "close");
  const environment = ServerEnvironment.newBuilder()
    .under(EnvironmentType.Local, (setting) => {
      setting.use({ storageFactory: storage });
    })
    .build();
  const index = new TestTenantIndex();
  const closeIndex = vi
    .spyOn(index, "close")
    .mockRejectedValueOnce(new Error("index close failed"));
  const application = await Application.newBuilder()
    .setServerEnvironment(environment)
    .setTenantIndex(index)
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  await expect(application.close()).rejects.toThrow(/close failed/i);
  expect(closeStorage).not.toHaveBeenCalled();
  await expect(application.close()).resolves.toBeUndefined();
  expect(closeIndex).toHaveBeenCalledTimes(2);
  expect(closeStorage).toHaveBeenCalledTimes(1);
});

it("does not reclose an index after environment close fails", async () => {
  const storage = new InMemoryStorageFactory();
  vi.spyOn(storage, "close").mockImplementationOnce(() => {
    throw new Error("environment close failed");
  });
  const environment = ServerEnvironment.newBuilder()
    .under(EnvironmentType.Local, (setting) => {
      setting.use({ storageFactory: storage });
    })
    .build();
  const index = new TestTenantIndex();
  const closeIndex = vi.spyOn(index, "close");
  const application = await Application.newBuilder()
    .setServerEnvironment(environment)
    .setTenantIndex(index)
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  await expect(application.close()).rejects.toThrow(/close failed/i);
  await expect(application.close()).resolves.toBeUndefined();
  expect(closeIndex).toHaveBeenCalledTimes(1);
});

it("retries an opened default tenant record close before closing environment storage", async () => {
  const storage = new InMemoryStorageFactory();
  const closeStorage = vi.spyOn(storage, "close");
  const createRecord = storage.createRecordStorage.bind(storage);
  const closeTenantRecord = vi.fn().mockImplementationOnce(() => {
    throw new Error("tenant record close failed");
  });
  vi.spyOn(storage, "createRecordStorage").mockImplementation((context, spec, group, options) => {
    const record = createRecord(context, spec, group, options);
    if (spec.recordType !== TenantSchema) return record;
    const originalClose = record.close.bind(record);
    return new Proxy(record, {
      get(target, property, receiver) {
        if (property === "close")
          return () => {
            closeTenantRecord();
            originalClose();
          };
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? (value.bind(target) as unknown) : value;
      },
    });
  });
  const application = await Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  await application.tenantIndex().keep(tenant("active"));
  await expect(application.close()).rejects.toThrow(/Application index close failed/);
  expect(closeTenantRecord).toHaveBeenCalledTimes(1);
  expect(closeStorage).not.toHaveBeenCalled();
  await expect(application.close()).resolves.toBeUndefined();
  expect(closeTenantRecord).toHaveBeenCalledTimes(2);
  expect(closeStorage).toHaveBeenCalledTimes(1);
});

it("rejects Application structure operations after close before provider preparation", async () => {
  const storage = new InMemoryStorageFactory();
  const provider = StoragePreparations.for(storage);
  let prepareCalls = 0;
  StoragePreparations.register(storage, {
    supportsRecordIndexes: provider.supportsRecordIndexes === true,
    prepareRecord: async (context, spec, group, mode) => {
      prepareCalls++;
      await provider.prepareRecord(context, spec, group, mode);
    },
    prepareEntity: provider.prepareEntity.bind(provider),
    prepareAgentHistory: provider.prepareAgentHistory.bind(provider),
    prepareAgentCommit: provider.prepareAgentCommit.bind(provider),
  });
  const application = await Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  await application.close();
  const before = prepareCalls;
  await expect(application.createStorageStructures()).rejects.toThrow(/Application is closed/);
  await expect(application.checkStructureCompatibility()).rejects.toThrow(/Application is closed/);
  expect(prepareCalls).toBe(before);
});

it("rejects structure preparation after its final Bounded Context closes", async () => {
  const storage = new InMemoryStorageFactory();
  const createRecord = vi.spyOn(storage, "createRecordStorage");
  const application = await Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  const context = application.contexts()[0];
  if (context === undefined) throw new Error("Expected Tasks Bounded Context.");
  await context.close();
  const opened = createRecord.mock.calls.length;
  await expect(application.checkStructureCompatibility()).rejects.toThrow(
    /no open Bounded Context/,
  );
  expect(createRecord).toHaveBeenCalledTimes(opened);
  await application.close();
});

it("drains a failing administrative preparation before closing shared storage", async () => {
  const storage = new InMemoryStorageFactory();
  const closeStorage = vi.spyOn(storage, "close");
  const provider = StoragePreparations.for(storage);
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const failure = new Error("administrative preparation failed");
  let fail = false;
  StoragePreparations.register(storage, {
    supportsRecordIndexes: provider.supportsRecordIndexes === true,
    prepareRecord: async (context, spec, group, mode) => {
      if (fail) {
        entered.resolve(undefined);
        await release.promise;
        throw failure;
      }
      await provider.prepareRecord(context, spec, group, mode);
    },
    prepareEntity: provider.prepareEntity.bind(provider),
    prepareAgentHistory: provider.prepareAgentHistory.bind(provider),
    prepareAgentCommit: provider.prepareAgentCommit.bind(provider),
  });
  const application = await Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  fail = true;
  const preparing = application.createStorageStructures();
  await entered.promise;
  const closing = application.close();
  expect(closeStorage).not.toHaveBeenCalled();
  release.resolve(undefined);
  await expect(preparing).rejects.toBe(failure);
  await expect(closing).resolves.toBeUndefined();
  expect(closeStorage).toHaveBeenCalledOnce();
});

it("prepares an explicit valid tenant without requiring index membership", async () => {
  const application = await Application.newBuilder()
    .setServerEnvironment(ServerEnvironment.newBuilder().build())
    .setTenantIndex(new TestTenantIndex())
    .add(BoundedContext.multiTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  applications.push(application);
  await expect(
    application.createStorageStructures(tenant("not-registered")),
  ).resolves.toBeUndefined();
});

it("rejects malformed explicit tenant IDs before preparing any structure", async () => {
  const storage = new InMemoryStorageFactory();
  const createRecord = vi.spyOn(storage, "createRecordStorage");
  const application = await Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .setTenantIndex(new TestTenantIndex())
    .add(BoundedContext.multiTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  applications.push(application);
  const before = createRecord.mock.calls.length;
  await expect(
    application.createStorageStructures(tenant("valid"), create(TenantIdSchema)),
  ).rejects.toThrow();
  expect(createRecord.mock.calls.length).toBe(before);
});

it("rejects explicit tenant preparation without a multitenant Bounded Context", async () => {
  const index = new TestTenantIndex();
  const contains = vi.spyOn(index, "contains");
  const all = vi.spyOn(index, "all");
  const application = await Application.newBuilder()
    .setServerEnvironment(ServerEnvironment.newBuilder().build())
    .setTenantIndex(index)
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  applications.push(application);
  await expect(application.checkStructureCompatibility(tenant("external"))).rejects.toThrow(
    /multitenant Bounded Context/,
  );
  expect(contains).not.toHaveBeenCalled();
  expect(all).not.toHaveBeenCalled();
});

it("closes an Application after lazy default index initialization fails", async () => {
  const storage = new InMemoryStorageFactory();
  const createRecord = storage.createRecordStorage.bind(storage);
  vi.spyOn(storage, "createRecordStorage").mockImplementation((context, spec, group, options) => {
    if (spec.recordType === TenantSchema) throw new Error("tenant storage unavailable");
    return createRecord(context, spec, group, options);
  });
  const application = await Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  await expect(application.tenantIndex().contains(tenant("any"))).rejects.toThrow(/unavailable/);
  await expect(application.close()).resolves.toBeUndefined();
});

it("retries a tenant record close that failed during lazy initialization", async () => {
  const storage = new InMemoryStorageFactory();
  const createRecord = storage.createRecordStorage.bind(storage);
  const opening = vi.spyOn(storage, "createRecordStorage");
  const closeStorage = vi.spyOn(storage, "close");
  const closeRecord = vi.fn().mockImplementationOnce(() => {
    throw new Error("first record close failed");
  });
  opening.mockImplementation((context, spec, group, options) => {
    const record = createRecord(context, spec, group, options);
    if (spec.recordType !== TenantSchema) return record;
    const originalClose = record.close.bind(record);
    return new Proxy(record, {
      get(target, property, receiver) {
        if (property === "close")
          return () => {
            closeRecord();
            originalClose();
          };
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
  });
  const provider = StoragePreparations.for(storage);
  StoragePreparations.register(storage, {
    supportsRecordIndexes: provider.supportsRecordIndexes === true,
    prepareRecord: async (context, spec, group, mode) => {
      if (spec.recordType.typeName === TenantSchema.typeName)
        throw new Error("tenant preparation failed");
      await provider.prepareRecord(context, spec, group, mode);
    },
    prepareEntity: provider.prepareEntity.bind(provider),
    prepareAgentHistory: provider.prepareAgentHistory.bind(provider),
    prepareAgentCommit: provider.prepareAgentCommit.bind(provider),
  });
  const application = await Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  const firstFailure = await application
    .tenantIndex()
    .contains(tenant("acme"))
    .catch((error: unknown) => error);
  expect(firstFailure).toBeInstanceOf(AggregateError);
  const opened = opening.mock.calls.filter(([, spec]) => spec.recordType === TenantSchema).length;
  await expect(application.tenantIndex().contains(tenant("again"))).rejects.toBe(firstFailure);
  expect(opening.mock.calls.filter(([, spec]) => spec.recordType === TenantSchema)).toHaveLength(
    opened,
  );
  expect(closeStorage).not.toHaveBeenCalled();
  await expect(application.close()).resolves.toBeUndefined();
  expect(closeRecord).toHaveBeenCalledTimes(2);
  expect(closeStorage).toHaveBeenCalledTimes(1);
});

it("drains an admitted lazy tenant read before closing its record handle", async () => {
  const storage = new InMemoryStorageFactory();
  const provider = StoragePreparations.for(storage);
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  StoragePreparations.register(storage, {
    supportsRecordIndexes: provider.supportsRecordIndexes === true,
    prepareRecord: async (context, spec, group, mode) => {
      if (spec.recordType.typeName === TenantSchema.typeName) {
        entered.resolve(undefined);
        await release.promise;
      }
      await provider.prepareRecord(context, spec, group, mode);
    },
    prepareEntity: provider.prepareEntity.bind(provider),
    prepareAgentHistory: provider.prepareAgentHistory.bind(provider),
    prepareAgentCommit: provider.prepareAgentCommit.bind(provider),
  });
  const application = await Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  const index = application.tenantIndex();
  const read = index.contains(tenant("acme"));
  await entered.promise;
  const close = index.close();
  release.resolve(undefined);
  await expect(read).resolves.toBe(false);
  await expect(close).resolves.toBeUndefined();
  await expect(index.contains(tenant("later"))).rejects.toThrow(/closed/i);
  await application.close();
});

it("checks declared structures after they were created", async () => {
  const storage = new InMemoryStorageFactory();
  const provider = StoragePreparations.for(storage);
  const modes: string[] = [];
  StoragePreparations.register(storage, {
    supportsRecordIndexes: provider.supportsRecordIndexes === true,
    prepareRecord: async (context, spec, group, mode) => {
      modes.push(mode);
      await provider.prepareRecord(context, spec, group, mode);
    },
    prepareEntity: provider.prepareEntity.bind(provider),
    prepareAgentHistory: provider.prepareAgentHistory.bind(provider),
    prepareAgentCommit: provider.prepareAgentCommit.bind(provider),
  });
  const application = await Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  applications.push(application);
  await application.createStorageStructures();
  const created = modes.length;
  await application.checkStructureCompatibility();
  expect(modes.slice(created)).toContain("check");
});

it("runs a queued compatibility check after creation fails", async () => {
  const storage = new InMemoryStorageFactory();
  const provider = StoragePreparations.for(storage);
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const modes: string[] = [];
  let firstCreate = true;
  StoragePreparations.register(storage, {
    supportsRecordIndexes: provider.supportsRecordIndexes === true,
    prepareRecord: async (context, spec, group, mode) => {
      modes.push(mode);
      if (mode === "create" && firstCreate) {
        firstCreate = false;
        entered.resolve(undefined);
        await release.promise;
        throw new Error("creation failed");
      }
      await provider.prepareRecord(context, spec, group, mode);
    },
    prepareEntity: provider.prepareEntity.bind(provider),
    prepareAgentHistory: provider.prepareAgentHistory.bind(provider),
    prepareAgentCommit: provider.prepareAgentCommit.bind(provider),
  });
  const application = await Application.newBuilder()
    .setServerEnvironment(
      ServerEnvironment.newBuilder()
        .under(EnvironmentType.Local, (setting) => {
          setting.use({ storageFactory: storage });
        })
        .build(),
    )
    .add(BoundedContext.singleTenant("Tasks"))
    .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
  applications.push(application);
  const context = application.contexts()[0];
  if (context === undefined) throw new Error("Expected Tasks Bounded Context.");
  const create = boundedContextAccess.prepareApplication(context, "create", []);
  await entered.promise;
  const check = boundedContextAccess.prepareApplication(context, "check", []);
  await new Promise<void>((resolve) => setImmediate(resolve));
  release.resolve(undefined);
  await expect(create).rejects.toThrow(/creation failed/);
  await expect(check).resolves.toBeUndefined();
  expect(modes).toContain("check");
});
