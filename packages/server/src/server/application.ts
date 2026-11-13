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

import type { TenantId } from "@spine-event-engine/proto";
import { StorageGroup, type StorageFactory } from "@spine-event-engine/storage";
import { TenantBoundary, type StoragePreparationMode } from "@spine-event-engine/storage/provider";

import {
  boundedContextAccess,
  type BoundedContext,
  type BoundedContextBuilder,
} from "../context/bounded-context.js";
import {
  PersistentTenantIndex,
  persistentTenantIndexAccess,
} from "../context/persistent-tenant-index.js";
import {
  SINGLE_TENANT,
  type TenantIndex,
  type TenantIndexPage,
  type TenantIndexRead,
} from "../context/tenant-index.js";
import { RegisteredTargets } from "../services/registered-targets.js";
import { ThirdPartyContext, thirdPartyAccess } from "../integration/third-party-context.js";
import { ServerEnvironment, serverEnvironmentAccess } from "./server-environment.js";
import { managedApplicationCapture } from "./managed-application-capture.js";

const claims = new WeakSet<ServerEnvironment>();
const usedBuilders = new WeakSet<BoundedContextBuilder>();
const constructionToken = Symbol("Application construction");
let constructApplication: (
  environment: ServerEnvironment,
  contexts: readonly BoundedContext[],
  targets: RegisteredTargets,
  index: TenantIndex | undefined,
) => Application;

/**
 * Chooses eager storage preparation and monitoring for Application build.
 */
export interface ApplicationBuildOptions {
  /**
   * Creates declared storage structures before build returns unless false.
   */
  readonly createStorageStructures?: boolean;

  /**
   * Starts subscription monitoring before build returns unless false.
   */
  readonly startSubscriptionMonitoring?: boolean;
}
const applicationParts = new WeakMap<
  Application,
  {
    readonly environment: ServerEnvironment;
    readonly targets: RegisteredTargets;
    readonly endpointStarted: () => void;
    readonly endpointClosed: () => void;
    readonly beginStart: () => () => void;
    readonly retainFailedStart: (onRetry: () => Promise<void>) => void;
    readonly useMode: (mode: "caller" | "server") => void;
    readonly beginManagedStart: () => () => void;
    readonly whenManagedStartsIdle: () => Promise<void>;
    readonly hasEndpoints: () => boolean;
  }
>();

/**
 * A fixed set of Bounded Contexts sharing one environment and tenant index.
 */
export class Application {
  static {
    constructApplication = (environment, contexts, targets, index) =>
      new Application(environment, contexts, targets, index, constructionToken);
  }

  readonly #environment: ServerEnvironment;

  readonly #contexts: readonly BoundedContext[];

  readonly #targets: RegisteredTargets;

  #index: TenantIndex | undefined;

  #indexClosed = false;

  #closed = false;

  #close: Promise<void> | undefined;

  #endpoints = 0;

  #pendingStarts = 0;

  #managedStarts = 0;

  #mode: "caller" | "server" | undefined;

  #startsIdle: PromiseWithResolvers<undefined> | undefined;

  #managedStartsIdle: PromiseWithResolvers<undefined> | undefined;

  readonly #failedStarts = new Set<() => Promise<void>>();

  readonly #administrative = new Set<Promise<void>>();

  /**
   * Captures successfully assembled contexts and their shared routes.
   *
   * @param environment Facilities selected for this Application.
   * @param contexts Contexts in builder order.
   * @param targets Installed query routes.
   * @param index Optional caller-supplied index.
   * @param token Restricts construction to successful builder completion.
   */
  private constructor(
    environment: ServerEnvironment,
    contexts: readonly BoundedContext[],
    targets: RegisteredTargets,
    index: TenantIndex | undefined,
    token: symbol,
  ) {
    if (token !== constructionToken) throw new TypeError("Use Application.newBuilder().build().");
    this.#environment = environment;
    this.#contexts = Object.freeze([...contexts]);
    this.#targets = targets;
    this.#index = index;
    applicationParts.set(this, {
      environment,
      targets,
      endpointStarted: () => {
        this.#endpointStarted();
      },
      endpointClosed: () => {
        this.#endpointClosed();
      },
      beginStart: () => this.#beginStart(),
      retainFailedStart: (onRetry) => {
        this.#retainFailedStart(onRetry);
      },
      useMode: (mode) => {
        this.#useMode(mode);
      },
      beginManagedStart: () => this.#beginManagedStart(),
      whenManagedStartsIdle: () => this.#managedStartsIdle?.promise ?? Promise.resolve(),
      hasEndpoints: () => this.#endpoints > 0,
    });
  }

  /**
   * Starts assembly of a new Application.
   *
   * @returns A builder accepting one environment and Bounded Context builders.
   */
  static newBuilder(): ApplicationBuilder {
    return new ApplicationBuilder();
  }

  /**
   * Lists the Bounded Contexts in build order, including entries later closed.
   *
   * @returns A stable read-only list.
   */
  contexts(): readonly BoundedContext[] {
    return this.#contexts;
  }

  /**
   * Returns the Application tenant index without opening storage.
   *
   * @returns The caller-supplied index or one lazy persistent index handle.
   */
  tenantIndex(): TenantIndex {
    if (this.#closed) throw new Error("Application is closed.");
    return (this.#index ??= new LazyTenantIndex(this.#environment.storageFactory));
  }

  /**
   * Creates declared structures for explicit IDs or current Application tenants.
   *
   * @param tenantIds Complete tenant identities; omission selects current index membership.
   * @returns Completion after the selected Bounded Context structures are ready.
   */
  createStorageStructures(...tenantIds: TenantId[]): Promise<void> {
    return this.#prepare("create", tenantIds);
  }

  /**
   * Checks declared structures even when they were created earlier.
   *
   * @param tenantIds Complete tenant identities; omission selects current index membership.
   * @returns Completion after every selected Bounded Context passes compatibility checks.
   */
  checkStructureCompatibility(...tenantIds: TenantId[]): Promise<void> {
    return this.#prepare("check", tenantIds);
  }

  /**
   * Admits Application-wide structure work and retains it until close.
   *
   * @param mode Creation or compatibility check.
   * @param tenantIds Explicit caller identities, if any.
   * @returns Completion after selected provider operations settle.
   */
  async #prepare(mode: StoragePreparationMode, tenantIds: readonly TenantId[]): Promise<void> {
    if (this.#closed) return Promise.reject(new Error("Application is closed."));
    const ids = [
      ...new Map(
        tenantIds.map((id) => {
          const boundary = TenantBoundary.from(id);
          return [boundary.key, boundary.tenantId] as const;
        }),
      ).values(),
    ];
    const contexts = this.#contexts.filter((context) => !boundedContextAccess.isClosing(context));
    const targets =
      ids.length === 0 ? contexts : contexts.filter((context) => context.isMultitenant);
    if (targets.length === 0)
      return Promise.reject(
        new Error(
          ids.length === 0
            ? "Application has no open Bounded Context."
            : "Explicit tenant preparation requires an open multitenant Bounded Context.",
        ),
      );
    const work = Promise.all(
      targets.map((context) =>
        boundedContextAccess.admitServiceRegistryOperation(context, () =>
          boundedContextAccess.prepareApplication(context, mode, ids),
        ),
      ),
    ).then(() => undefined);
    this.#administrative.add(work);
    void work.finally(() => this.#administrative.delete(work)).catch(() => undefined);
    return work;
  }

  /**
   * Closes contexts in reverse order, then their routes and environment.
   *
   * @returns Completion after shared resources close.
   */
  close(): Promise<void> {
    if (this.#endpoints > 0)
      return Promise.reject(new Error("Close Application endpoints before Application.close()."));
    this.#closed = true;
    this.#close ??= this.#closeAfterStarts().catch((error: unknown) => {
      this.#close = undefined;
      throw error;
    });
    return this.#close;
  }

  /**
   * Records a successfully started endpoint until its listener closes.
   */
  #endpointStarted(): void {
    if (this.#closed) throw new Error("Application is closed.");
    this.#endpoints++;
  }

  /**
   * Clears one endpoint registration after its listener and sessions close.
   */
  #endpointClosed(): void {
    this.#endpoints--;
  }

  /**
   * Admits one pending listener start and returns its completion callback.
   *
   * @returns Callback that releases the start ticket once listener cleanup settles.
   */
  #beginStart(): () => void {
    if (this.#closed) throw new Error("Application is closed.");
    if (this.#pendingStarts++ === 0) this.#startsIdle = Promise.withResolvers<undefined>();
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      if (--this.#pendingStarts === 0) this.#startsIdle?.resolve(undefined);
    };
  }

  /**
   * Fixes one Application to manual or process-managed endpoint lifetime.
   *
   * @param mode Requested endpoint lifetime.
   */
  #useMode(mode: "caller" | "server"): void {
    if (this.#closed) throw new Error("Application is closed.");
    if (this.#mode !== undefined && this.#mode !== mode)
      throw new Error("Application cannot mix manual and run-managed endpoints.");
    this.#mode = mode;
  }

  /**
   * Retains a process-managed start through endpoint registration.
   *
   * @returns Callback releasing the managed start ticket.
   */
  #beginManagedStart(): () => void {
    this.#useMode("server");
    if (this.#managedStarts++ === 0) this.#managedStartsIdle = Promise.withResolvers<undefined>();
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      if (--this.#managedStarts === 0) this.#managedStartsIdle?.resolve(undefined);
    };
  }

  /**
   * Records retryable listener cleanup when startup cannot release every resource.
   *
   * @param onRetry Completes only after listener resources close.
   */
  #retainFailedStart(onRetry: () => Promise<void>): void {
    this.#failedStarts.add(onRetry);
  }

  /**
   * Waits for pending listeners to settle before releasing shared facilities.
   */
  async #closeAfterStarts(): Promise<void> {
    await this.#startsIdle?.promise;
    await this.#managedStartsIdle?.promise;
    await Promise.allSettled(this.#administrative);
    const errors: unknown[] = [];
    for (const onRetry of this.#failedStarts) {
      try {
        await onRetry();
        this.#failedStarts.delete(onRetry);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "Application listener cleanup failed.");
    await this.#closeParts();
  }

  /**
   * Releases shared resources while preserving independent close failures.
   */
  async #closeParts(): Promise<void> {
    const errors: unknown[] = [];
    for (const context of [...this.#contexts].reverse()) {
      try {
        await context.close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "Application context close failed.");
    this.#targets.release();
    if (this.#index !== undefined && !this.#indexClosed) {
      try {
        await this.#index.close();
        this.#indexClosed = true;
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "Application index close failed.");
    try {
      await this.#environment.close();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) throw new AggregateError(errors, "Application close failed.");
  }
}

/**
 * Supplies assembled Application facilities to server listeners.
 *
 * @internal
 */
export const applicationAccess: Readonly<{
  /**
   * Returns the shared environment selected at build time.
   */
  environment(application: Application): ServerEnvironment;

  /**
   * Returns state routes installed before context activation.
   */
  targets(application: Application): RegisteredTargets;

  /**
   * Records an endpoint after listener startup.
   */
  endpointStarted(application: Application): void;

  /**
   * Releases an endpoint after listener cleanup.
   */
  endpointClosed(application: Application): void;

  /**
   * Admits a pending listener before asynchronous startup.
   */
  beginStart(application: Application): () => void;

  /**
   * Retains a failed listener cleanup callback until Application close succeeds.
   */
  retainFailedStart(application: Application, onRetry: () => Promise<void>): void;

  /**
   * Selects one endpoint lifetime mode for this Application.
   */
  useMode(application: Application, mode: "caller" | "server"): void;

  /**
   * Retains managed startup through process registration.
   */
  beginManagedStart(application: Application): () => void;

  /**
   * Waits for pending managed registrations to settle.
   */
  whenManagedStartsIdle(application: Application): Promise<void>;

  /**
   * Reports whether a successful listener still uses this Application.
   */
  hasEndpoints(application: Application): boolean;
}> = Object.freeze({
  /**
   * Returns the shared environment selected at build time.
   */
  environment(application: Application): ServerEnvironment {
    const parts = applicationParts.get(application);
    if (parts === undefined) throw new TypeError("Expected a built Application.");
    return parts.environment;
  },

  /**
   * Returns state routes installed before context activation.
   */
  targets(application: Application): RegisteredTargets {
    const parts = applicationParts.get(application);
    if (parts === undefined) throw new TypeError("Expected a built Application.");
    return parts.targets;
  },

  /**
   * Records an endpoint after listener startup.
   */
  endpointStarted(application: Application): void {
    const parts = applicationParts.get(application);
    if (parts === undefined) throw new TypeError("Expected a built Application.");
    parts.endpointStarted();
  },

  /**
   * Releases an endpoint after listener cleanup.
   */
  endpointClosed(application: Application): void {
    const parts = applicationParts.get(application);
    if (parts === undefined) throw new TypeError("Expected a built Application.");
    parts.endpointClosed();
  },

  /**
   * Admits a pending listener before asynchronous startup.
   */
  beginStart(application: Application): () => void {
    const parts = applicationParts.get(application);
    if (parts === undefined) throw new TypeError("Expected a built Application.");
    return parts.beginStart();
  },

  /**
   * Retains a failed listener cleanup callback until Application close succeeds.
   */
  retainFailedStart(application: Application, onRetry: () => Promise<void>): void {
    const parts = applicationParts.get(application);
    if (parts === undefined) throw new TypeError("Expected a built Application.");
    parts.retainFailedStart(onRetry);
  },

  /**
   * Selects one endpoint lifetime mode for this Application.
   */
  useMode(application: Application, mode: "caller" | "server"): void {
    const parts = applicationParts.get(application);
    if (parts === undefined) throw new TypeError("Expected a built Application.");
    parts.useMode(mode);
  },

  /**
   * Retains managed startup through process registration.
   */
  beginManagedStart(application: Application): () => void {
    const parts = applicationParts.get(application);
    if (parts === undefined) throw new TypeError("Expected a built Application.");
    return parts.beginManagedStart();
  },

  /**
   * Waits for pending managed registrations to settle.
   */
  whenManagedStartsIdle(application: Application): Promise<void> {
    const parts = applicationParts.get(application);
    if (parts === undefined) throw new TypeError("Expected a built Application.");
    return parts.whenManagedStartsIdle();
  },

  /**
   * Reports whether a successful listener still uses this Application.
   */
  hasEndpoints(application: Application): boolean {
    const parts = applicationParts.get(application);
    if (parts === undefined) throw new TypeError("Expected a built Application.");
    return parts.hasEndpoints();
  },
});

/**
 * Collects one environment and a fixed ordered set of Bounded Context builders.
 */
export class ApplicationBuilder {
  #environment: ServerEnvironment | undefined;

  #index: TenantIndex | undefined;

  #defaultIndex: LazyTenantIndex | undefined;

  readonly #builders: BoundedContextBuilder[] = [];

  readonly #thirdParty = new Map<BoundedContextBuilder, ThirdPartyContext>();

  readonly #partial: BoundedContext[] = [];

  #targets: RegisteredTargets | undefined;

  #retired = false;

  #built = false;

  #building = false;

  #claimed = false;

  #closing: Promise<void> | undefined;

  /**
   * Sets the one facility environment shared by every Bounded Context in this Application.
   *
   * @param environment An open, unclaimed server environment.
   * @returns This builder.
   */
  setServerEnvironment(environment: ServerEnvironment): this {
    this.#requireMutable();
    this.#environment = environment;
    return this;
  }

  /**
   * Sets the tenant registration index used by this Application's multitenant contexts.
   *
   * @param index Tenant registration index.
   * @returns This builder.
   */
  setTenantIndex(index: TenantIndex): this {
    this.#requireMutable();
    this.#index = index;
    return this;
  }

  /**
   * Adds a Bounded Context builder to the fixed Application membership.
   *
   * @param entry Context builder or unattached third-party declaration to assemble.
   * @returns This builder.
   */
  add(entry: BoundedContextBuilder | ThirdPartyContext): this {
    this.#requireMutable();
    const builder = entry instanceof ThirdPartyContext ? thirdPartyAccess.builder(entry) : entry;
    if (!boundedContextAccess.isBuilder(builder))
      throw new TypeError("Expected a Bounded Context builder.");
    if (entry instanceof ThirdPartyContext) this.#thirdParty.set(builder, entry);
    this.#builders.push(builder);
    return this;
  }

  /**
   * Validates membership, assembles all contexts, installs routes, and activates them.
   *
   * @param options Eager storage and monitoring choices.
   * @returns The running Application.
   */
  async build(options: ApplicationBuildOptions = {}): Promise<Application> {
    this.#requireMutable();
    managedApplicationCapture.recordBuilder(this);
    this.#retired = true;
    this.#preflight();
    const environment = this.#environment;
    if (environment === undefined) throw new Error("Application requires a ServerEnvironment.");
    claims.add(environment);
    this.#claimed = true;
    this.#building = true;
    for (const builder of this.#builders) usedBuilders.add(builder);
    try {
      const sharedIndex = await this.#assemble(environment, options);
      const targets = this.#targets;
      if (targets === undefined) throw new Error("Application routes were not installed.");
      this.#built = true;
      this.#building = false;
      const application = constructApplication(environment, this.#partial, targets, sharedIndex);
      managedApplicationCapture.recordBuilt(this, application);
      return application;
    } catch (error) {
      this.#building = false;
      return this.#rollbackFailedBuild(error, environment);
    }
  }

  /**
   * Joins required startup cleanup and retains any incomplete builder rollback.
   *
   * @param error Original assembly or activation failure.
   * @param environment Environment selected for this build.
   * @returns Rejection with the complete failure chain.
   */
  async #rollbackFailedBuild(error: unknown, environment: ServerEnvironment): Promise<never> {
    let failure = error;
    if (serverEnvironmentAccess.hasStartupFailure(environment)) {
      try {
        await serverEnvironmentAccess.awaitStartupFailure(environment);
      } catch (startupFailure) {
        failure = startupFailure;
      }
    }
    try {
      await this.close();
    } catch (cleanup) {
      throw new AggregateError([failure, cleanup], "Application build failed and cleanup failed.");
    }
    throw failure;
  }

  /**
   * Opens shared facilities, assembles every context, installs routes, then activates work.
   *
   * @param environment Facilities claimed by this builder.
   * @param options Requested startup preparation.
   * @returns The shared tenant index, opened lazily when needed.
   */
  async #assemble(
    environment: ServerEnvironment,
    options: ApplicationBuildOptions,
  ): Promise<TenantIndex> {
    await serverEnvironmentAccess.setup(environment);
    const index =
      this.#index ?? (this.#defaultIndex ??= new LazyTenantIndex(environment.storageFactory));
    for (const builder of this.#builders) {
      const selected = builder.tenantMode === "multitenant" ? index : SINGLE_TENANT;
      const context = await boundedContextAccess.assemble(builder, environment, selected);
      this.#partial.push(context);
      serverEnvironmentAccess.warnVolatileRegistry(environment, context);
    }
    this.#targets = new RegisteredTargets(this.#partial);
    this.#targets.install(this.#partial);
    for (let i = 0; i < this.#builders.length; i++) {
      const builder = this.#builders[i];
      if (builder === undefined) continue;
      const party = this.#thirdParty.get(builder);
      const context = this.#partial[i];
      if (party !== undefined && context !== undefined)
        thirdPartyAccess.attach(party, context, environment);
    }
    for (const context of this.#partial) boundedContextAccess.integrate(context, environment);
    await Promise.all(
      this.#partial.map((context) => boundedContextAccess.integrationReady(context)),
    );
    for (const context of this.#partial)
      await boundedContextAccess.activate(context, environment, options);
    return index;
  }

  /**
   * Retries cleanup of a failed build without closing caller-supplied facilities.
   *
   * @returns Completion after partial contexts release their resources.
   */
  async close(): Promise<void> {
    if (this.#building) throw new Error("Application build is in progress.");
    if (this.#built) throw new Error("Close the built Application instead.");
    this.#retired = true;
    this.#closing ??= this.#closeOnce().catch((error: unknown) => {
      this.#closing = undefined;
      throw error;
    });
    return this.#closing;
  }

  /**
   * Retries unfinished partial cleanup while one caller coordinates each attempt.
   *
   * @returns Completion after every retained partial resource closes.
   */
  async #closeOnce(): Promise<void> {
    const errors: unknown[] = [];
    for (const context of [...this.#partial].reverse()) {
      try {
        await context.close();
        this.#partial.splice(this.#partial.indexOf(context), 1);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "Application builder cleanup failed.");
    this.#targets?.release();
    await this.#defaultIndex?.close();
    if (this.#claimed && this.#environment !== undefined) {
      if (serverEnvironmentAccess.hasStartupFailure(this.#environment))
        await serverEnvironmentAccess.retryStartupCleanup(this.#environment);
      claims.delete(this.#environment);
      this.#claimed = false;
    }
  }

  /**
   * Rejects reused builders, repeated names, and absent facilities before setup.
   */
  #preflight(): void {
    if (this.#environment === undefined)
      throw new Error("Application requires a ServerEnvironment.");
    serverEnvironmentAccess.requireAvailable(this.#environment);
    if (claims.has(this.#environment)) throw new Error("ServerEnvironment is already claimed.");
    if (this.#builders.length === 0) throw new Error("Application requires a Bounded Context.");
    const names = new Set<string>();
    for (const builder of this.#builders) {
      const party = this.#thirdParty.get(builder);
      if (party !== undefined && thirdPartyAccess.isAttached(party))
        throw new Error("ThirdPartyContext is already attached.");
      if (usedBuilders.has(builder)) throw new Error("Bounded Context builder is already used.");
      if (names.has(builder.name.value))
        throw new Error(`Duplicate Bounded Context name: ${builder.name.value}.`);
      names.add(builder.name.value);
    }
    for (const builder of this.#builders) {
      const systemName = `${builder.name.value}_System`;
      if (names.has(systemName)) throw new Error(`Generated System name collision: ${systemName}.`);
      names.add(systemName);
    }
    const states = new Map<string, string>();
    for (const builder of this.#builders) {
      for (const typeUrl of boundedContextAccess.stateTypes(builder)) {
        const prior = states.get(typeUrl);
        if (prior !== undefined) {
          throw new Error(
            `Entity state ${typeUrl} is registered in both ${prior} and ${builder.name.value}.`,
          );
        }
        states.set(typeUrl, builder.name.value);
      }
    }
  }

  /**
   * Rejects mutations after an Application build has started or failed.
   */
  #requireMutable(): void {
    if (this.#retired || this.#built) throw new Error("Application builder is already used.");
  }
}

/**
 * Defers persistent tenant record creation until the first index operation.
 */
class LazyTenantIndex implements TenantIndex {
  readonly #storage: StorageFactory;

  #opening: Promise<PersistentTenantIndex> | undefined;

  #index: PersistentTenantIndex | undefined;

  #failedOpening: unknown;

  #closed = false;

  #active = 0;

  #drained: (() => void) | undefined;

  #closeAttempt: Promise<void> | undefined;

  /**
   * Captures the Application storage provider without opening a record handle.
   *
   * @param storage Application storage provider.
   */
  constructor(storage: StorageFactory) {
    this.#storage = storage;
  }

  /**
   * Reads current registration from the lazily opened persistent index.
   *
   * @param tenantId Complete tenant identity.
   * @returns Whether registration exists.
   */
  contains(tenantId: TenantId): Promise<boolean> {
    return this.#run((index) => index.contains(tenantId));
  }

  /**
   * Lists registered tenant identities.
   *
   * @returns Complete tenant identities.
   */
  all(): Promise<readonly TenantId[]> {
    return this.#run((index) => index.all());
  }

  /**
   * Reads one finite page from persistent registration.
   *
   * @param request Page size and cancellation signal.
   * @returns One page and its continuation.
   */
  page(request: TenantIndexRead): Promise<TenantIndexPage> {
    return this.#run((index) => index.page(request));
  }

  /**
   * Registers a tenant in persistent storage.
   *
   * @param tenantId Complete tenant identity.
   * @returns Completion after registration becomes visible.
   */
  keep(tenantId: TenantId): Promise<void> {
    return this.#run((index) => index.keep(tenantId));
  }

  /**
   * Closes the opened record handle after admitted initialization settles.
   *
   * @returns Completion after the handle closes, if it opened.
   */
  close(): Promise<void> {
    this.#closed = true;
    this.#closeAttempt ??= this.#closeDrained().catch((error: unknown) => {
      this.#closeAttempt = undefined;
      throw error;
    });
    return this.#closeAttempt;
  }

  /**
   * Waits for accepted calls before releasing the opened record handle.
   *
   * @returns Completion after all accepted calls and retained cleanup settle.
   */
  async #closeDrained(): Promise<void> {
    if (this.#active > 0)
      await new Promise<void>((resolve) => {
        this.#drained = resolve;
      });
    if (this.#failedOpening !== undefined) {
      await persistentTenantIndexAccess.retryFailedCreation(this.#failedOpening);
      this.#failedOpening = undefined;
    }
    await this.#index?.close();
  }

  /**
   * Admits one operation before its asynchronous index initialization.
   *
   * @param operation Work against the opened persistent index.
   * @returns The accepted operation's result.
   * @typeParam T Result returned by the operation.
   */
  #run<T>(operation: (index: PersistentTenantIndex) => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("Tenant index is closed."));
    this.#active++;
    return this.#get()
      .then(operation)
      .finally(() => {
        if (--this.#active === 0) this.#drained?.();
      });
  }

  /**
   * Opens persistent registration once and retains its record handle.
   *
   * @returns The opened tenant index.
   */
  async #get(): Promise<PersistentTenantIndex> {
    if (this.#closed) throw new Error("Tenant index is closed.");
    if (this.#failedOpening !== undefined)
      throw this.#failedOpening instanceof Error
        ? this.#failedOpening
        : new Error("Tenant index opening failed.", { cause: this.#failedOpening });
    this.#opening ??= PersistentTenantIndex.create({
      storageFactory: this.#storage,
      group: new StorageGroup("tenants"),
    })
      .then((index) => (this.#index = index))
      .catch((error: unknown) => {
        this.#opening = undefined;
        if (persistentTenantIndexAccess.hasFailedCreation(error)) this.#failedOpening = error;
        throw error;
      });
    return this.#opening;
  }
}
