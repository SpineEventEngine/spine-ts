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

import { create, equals } from "@bufbuild/protobuf";
import { TenantIdSchema, type TenantId } from "@spine-event-engine/proto";
import {
  BoundedContext,
  EnvironmentType,
  PersistentTenantIndex,
  ServerEnvironment,
  SINGLE_TENANT,
  TenantUnknownError,
  type TenantIndex,
  type TenantIndexPage,
  type TenantIndexRead,
} from "@spine-event-engine/server";
import { InMemoryStorageFactory, StorageGroup } from "@spine-event-engine/storage";
import {
  TenantBoundary,
  TenantCatalogReads,
  type TenantCatalog,
} from "@spine-event-engine/storage/provider";

/**
 * Demonstrates complete tenant admission without installing an authentication store.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Groups selected tenant assembly examples.
export class TenantScenarios {
  /**
   * Builds the default or explicitly selected single-tenant Bounded Context.
   *
   * @param explicit Whether to supply the marker in environment configuration.
   * @returns The selected marker after the context has closed.
   */
  static async single(explicit: boolean): Promise<typeof SINGLE_TENANT> {
    ServerEnvironment.when(EnvironmentType.Local).use(
      explicit ? { tenantIndex: SINGLE_TENANT } : {},
    );
    await ServerEnvironment.instance().completeSetup();
    const context = await BoundedContext.singleTenant("MessageBoardSingle").build();
    try {
      if (context.tenantIndex !== SINGLE_TENANT) throw new Error("Single-tenant marker was lost.");
      return context.tenantIndex;
    } finally {
      await context.close();
    }
  }

  /**
   * Builds a multitenant Bounded Context with an application-supplied directory.
   *
   * @returns Registered and unknown-tenant admission results after cleanup.
   */
  static async external(): Promise<TenantScenarioResult> {
    const factory = new InMemoryStorageFactory();
    const index = new ApplicationTenantIndex(factory.tenantCatalog());
    try {
      return await this.#runMultitenant(index, factory);
    } finally {
      await factory.close();
    }
  }

  /**
   * Builds a multitenant Bounded Context with the prepared persistent directory.
   *
   * @returns Registered and unknown-tenant admission results after cleanup.
   */
  static async persistent(): Promise<TenantScenarioResult> {
    const factory = new InMemoryStorageFactory();
    let index: PersistentTenantIndex | undefined;
    try {
      index = await PersistentTenantIndex.create({
        storageFactory: factory,
        group: new StorageGroup("message_board_tenants"),
      });
      return await this.#runMultitenant(index, factory);
    } finally {
      try {
        await index?.close();
      } finally {
        await factory.close();
      }
    }
  }

  /**
   * Checks registered and absent tenants through a completed Bounded Context.
   *
   * @param index Selected replaceable directory.
   * @param factory Application-selected business storage facility.
   * @returns Explicit membership and refusal outcomes after context close.
   */
  static async #runMultitenant(
    index: TenantIndex,
    factory: InMemoryStorageFactory,
  ): Promise<TenantScenarioResult> {
    ServerEnvironment.when(EnvironmentType.Local).use({
      tenantIndex: index,
      storageFactory: factory,
    });
    await ServerEnvironment.instance().completeSetup();
    const context = await BoundedContext.multitenant("MessageBoardTenants")
      .withTenantIndex(index)
      .build({ createStorageStructures: false, startSubscriptionMonitoring: false });
    try {
      const registered = this.#tenant("board-team");
      await index.keep(registered);
      const completeIds = await index.all();
      await context.runtime.createStorageStructures(registered);
      let unknownRejected = false;
      try {
        await context.runtime.createStorageStructures(this.#tenant("unknown-team"));
      } catch (error) {
        if (!(error instanceof TenantUnknownError)) throw error;
        unknownRejected = true;
      }
      return {
        registered:
          completeIds.some((id) => equals(TenantIdSchema, id, registered)) &&
          (await index.contains(registered)),
        unknownRejected,
      };
    } finally {
      await context.close();
    }
  }

  /**
   * Creates one complete application tenant identity.
   *
   * @param value Application tenant value.
   * @returns Generated complete tenant ID.
   */
  static #tenant(value: string): TenantId {
    return create(TenantIdSchema, { kind: { case: "value", value } });
  }
}

/**
 * Results of one public multitenant membership demonstration.
 */
export interface TenantScenarioResult {
  /**
   * Whether the registered complete identity is visible.
   */
  readonly registered: boolean;

  /**
   * Whether the Bounded Context refused the unknown complete identity.
   */
  readonly unknownRejected: boolean;
}

/**
 * Converts an application-selected provider catalog to a replaceable tenant index.
 */
class ApplicationTenantIndex implements TenantIndex {
  /**
   * Captures the catalog supplied by the application.
   *
   * @param catalog Membership catalog retained by the application.
   */
  constructor(private readonly catalog: TenantCatalog) {}

  /**
   * Checks the complete tenant boundary.
   *
   * @param id Complete tenant identity.
   * @returns Whether the catalog includes it.
   */
  contains(id: TenantId): Promise<boolean> {
    return this.catalog.contains(TenantBoundary.from(id));
  }

  /**
   * Lists complete tenant identities.
   *
   * @returns The currently registered identities.
   */
  async all(): Promise<readonly TenantId[]> {
    return (await this.catalog.all()).map((boundary) => this.#requiredTenant(boundary));
  }

  /**
   * Reads a finite catalog page.
   *
   * @param request Finite count, cancellation and continuation.
   * @returns Complete tenant identities and catalog continuation.
   */
  async page(request: TenantIndexRead): Promise<TenantIndexPage> {
    TenantCatalogReads.require(request);
    const page = await this.catalog.page(request);
    request.signal.throwIfAborted();
    return {
      ids: page.boundaries.map((boundary) => this.#requiredTenant(boundary)),
      ...(page.after === undefined ? {} : { after: page.after }),
      hasMore: page.hasMore,
    };
  }

  /**
   * Registers the complete tenant boundary.
   *
   * @param id Complete tenant identity.
   * @returns Completion after catalog registration.
   */
  keep(id: TenantId): Promise<void> {
    return this.catalog.keep(TenantBoundary.from(id));
  }

  /**
   * Returns the complete identity from a multitenant catalog entry.
   *
   * @param boundary Catalog entry to inspect.
   * @returns Complete registered tenant identity.
   */
  #requiredTenant(boundary: TenantBoundary): TenantId {
    if (boundary.single || boundary.tenantId === undefined)
      throw new Error("Application catalog returned a single-tenant boundary.");
    return boundary.tenantId;
  }
}
