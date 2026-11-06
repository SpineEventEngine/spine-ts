import { create } from "@bufbuild/protobuf";
import { TenantIdSchema, type TenantId } from "@spine-event-engine/proto";
import {
  EnvironmentType,
  PersistentTenantIndex,
  ServerEnvironment,
} from "@spine-event-engine/server";
import { StorageGroup, type StorageFactory } from "@spine-event-engine/storage";

/** Stable complete tenant identities used by the Orders demonstrations. */
export const ordersTenants: Readonly<{ northwind: TenantId; contoso: TenantId }> = Object.freeze({
  northwind: create(TenantIdSchema, { kind: { case: "value", value: "northwind" } }),
  contoso: create(TenantIdSchema, { kind: { case: "value", value: "contoso" } }),
});

/** Facilities selected before assembling any Orders Bounded Context. */
export interface OrdersEnvironmentOptions {
  /** Storage used by both the tenant directory and Orders Bounded Contexts. */
  readonly storageFactory: StorageFactory;

  /** Explicit tenant registrations for this launch. */
  readonly tenants: readonly TenantId[];
}

/** Facilities to close after the server has closed its Bounded Contexts. */
export interface OrdersEnvironment {
  /** Persistent membership directory. */
  readonly tenantIndex: PersistentTenantIndex;

  /** Configured process environment. */
  readonly environment: ServerEnvironment;

  /** Closes the membership handle and environment facilities. */
  close(): Promise<void>;
}

/**
 * Configures one Orders environment before any Bounded Context is assembled.
 *
 * @param options Storage and explicit tenant registrations.
 * @returns Configured facilities for the launch lifetime.
 */
export async function configureOrdersEnvironment(
  options: OrdersEnvironmentOptions,
): Promise<OrdersEnvironment> {
  const tenantIndex = await PersistentTenantIndex.create({
    storageFactory: options.storageFactory,
    group: new StorageGroup("orders-tenant-directory"),
  });
  let environment: ServerEnvironment | undefined;
  try {
    for (const tenantId of options.tenants) await tenantIndex.keep(tenantId);
    ServerEnvironment.when(EnvironmentType.Local).use({
      storageFactory: options.storageFactory,
      tenantIndex,
    });
    environment = ServerEnvironment.instance();
    await environment.completeSetup();
  } catch (error) {
    const cleanup = await Promise.allSettled([
      tenantIndex.close(),
      environment?.close() ?? options.storageFactory.close(),
    ]);
    const failures = cleanup.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    throw failures.length === 0
      ? error
      : new AggregateError([error, ...failures], "Orders setup failed.");
  }
  return {
    tenantIndex,
    environment,
    async close() {
      const errors: unknown[] = [];
      try {
        await tenantIndex.close();
      } catch (error) {
        errors.push(error);
      }
      try {
        await environment.close();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) throw new AggregateError(errors, "Orders environment close failed.");
    },
  };
}
