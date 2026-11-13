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

import { create, toBinary } from "@bufbuild/protobuf";
import { TenantIdSchema, type TenantId } from "@spine-event-engine/proto";
import {
  EnvironmentType,
  PersistentTenantIndex,
  ServerEnvironment,
} from "@spine-event-engine/server";
import { StorageGroup, type StorageFactory } from "@spine-event-engine/storage";
import { OrdersApplicationLifetime } from "./orders-application-lifetime.js";

/**
 * Supplies stable complete tenant identities for the Orders demonstrations.
 */
export const ordersTenants: Readonly<{ northwind: TenantId; contoso: TenantId }> = Object.freeze({
  northwind: create(TenantIdSchema, { kind: { case: "value", value: "northwind" } }),
  contoso: create(TenantIdSchema, { kind: { case: "value", value: "contoso" } }),
});

/**
 * Selects the facilities and registration policy for an Orders launch.
 */
export interface OrdersEnvironmentOptions {
  /**
   * Stores membership and application records.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Lists the only tenant identities configured for this launch.
   */
  readonly tenants: readonly TenantId[];

  /**
   * Chooses explicit registration or validation of an existing directory.
   */
  readonly membership?: "register" | "seed-if-empty" | "existing";
}

/**
 * Gives callers the facilities to close after all Bounded Contexts stop.
 */
export interface OrdersEnvironment {
  /**
   * Reads persistent application membership.
   */
  readonly tenantIndex: PersistentTenantIndex;

  /**
   * Holds the configured process facilities.
   */
  readonly environment: ServerEnvironment;

  /**
   * Closes membership and process facilities in order.
   *
   * @returns Completion after both close attempts.
   */
  close(): Promise<void>;
}

/**
 * Creates an Orders environment before any Bounded Context is assembled.
 *
 * @param options Storage, tenants, and membership policy.
 * @returns Configured facilities for the launch lifetime.
 */
export async function configureOrdersEnvironment(
  options: OrdersEnvironmentOptions,
): Promise<OrdersEnvironment> {
  const tenantIndex = await openTenantIndex(options.storageFactory);
  let environment: ServerEnvironment | undefined;
  try {
    await reconcileMembership(tenantIndex, options);
    environment = ServerEnvironment.newBuilder()
      .under(EnvironmentType.Local, (setting) => {
        setting.use({
          storageFactory: options.storageFactory,
        });
      })
      .build();
  } catch (error) {
    await closeFailedSetup(tenantIndex, environment, options.storageFactory, error);
  }
  if (environment === undefined) throw new Error("Orders environment setup did not complete.");
  const setup: OrdersEnvironment = {
    tenantIndex,
    environment,
    close: () => closeOrdersEnvironment(setup, tenantIndex, environment),
  };
  return setup;
}

/**
 * Opens the directory and releases its factory if opening fails.
 *
 * @param storageFactory Selected storage provider.
 * @returns An open persistent index.
 */
async function openTenantIndex(storageFactory: StorageFactory): Promise<PersistentTenantIndex> {
  try {
    return await PersistentTenantIndex.create({
      storageFactory,
      group: new StorageGroup("orders-tenant-directory"),
    });
  } catch (error) {
    try {
      await storageFactory.close();
    } catch (closeError) {
      throw new AggregateError([error, closeError], "Orders directory setup failed.");
    }
    throw error;
  }
}

/**
 * Reads persisted membership before any optional registration and checks routing.
 *
 * @param index Persistent application directory.
 * @param options Configured storage routing and registration policy.
 * @returns Completion after membership agrees with routing.
 */
async function reconcileMembership(
  index: PersistentTenantIndex,
  options: OrdersEnvironmentOptions,
): Promise<void> {
  const configured = new Set(options.tenants.map(tenantKey));
  if (configured.size !== options.tenants.length || configured.size === 0)
    throw new Error("Orders routing requires distinct configured tenants.");
  const persisted = await index.all();
  if (persisted.some((id) => !configured.has(tenantKey(id))))
    throw new Error("Persisted Orders membership has no configured storage routing.");
  const policy = options.membership ?? "register";
  if (policy === "register" || (policy === "seed-if-empty" && persisted.length === 0))
    for (const tenantId of options.tenants) await index.keep(tenantId);
  const registered = await index.all();
  if (
    registered.length !== configured.size ||
    registered.some((id) => !configured.has(tenantKey(id)))
  )
    throw new Error("Orders membership does not match configured storage routing.");
}

/**
 * Encodes a complete tenant identity for exact set comparison.
 *
 * @param id Complete generated tenant identity.
 * @returns Canonical binary key as text.
 */
function tenantKey(id: TenantId): string {
  return Buffer.from(toBinary(TenantIdSchema, id)).toString("hex");
}

/**
 * Releases the directory before the environment or its storage factory.
 *
 * @param index Directory opened for this setup.
 * @param environment Environment if singleton resolution completed.
 * @param factory Storage factory if resolution did not complete.
 * @param cause Original setup failure.
 * @returns Never; rethrows the cause with any cleanup failures.
 */
async function closeFailedSetup(
  index: PersistentTenantIndex,
  environment: ServerEnvironment | undefined,
  factory: StorageFactory,
  cause: unknown,
): Promise<never> {
  const failures: unknown[] = [];
  try {
    await index.close();
  } catch (error) {
    failures.push(error);
  }
  try {
    await (environment?.close() ?? factory.close());
  } catch (error) {
    failures.push(error);
  }
  throw failures.length === 0
    ? cause
    : new AggregateError([cause, ...failures], "Orders setup failed.");
}

/**
 * Closes the index, then the environment, even if one close rejects.
 *
 * @param setup Explicit launch setup retaining a started Application.
 * @param index Directory opened for this launch.
 * @param environment Process facilities configured for this launch.
 * @returns Completion after both close attempts.
 */
async function closeOrdersEnvironment(
  setup: OrdersEnvironment,
  index: PersistentTenantIndex,
  environment: ServerEnvironment,
): Promise<void> {
  if (await OrdersApplicationLifetime.close(setup)) return;
  const errors: unknown[] = [];
  try {
    await index.close();
  } catch (error) {
    errors.push(error);
  }
  try {
    await environment.close();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) throw new AggregateError(errors, "Orders environment close failed.");
}
