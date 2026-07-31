/**
 * Coordinates ordered cleanup of the listener, subscription gateway, and backend for one local Chat topology.
 */
export class LocalChatLifecycle {
  #closing: Promise<void> | undefined;
  #listenerClosing: Promise<void> | undefined;
  #listenerClosed = false;
  #subscriptionsClosed = false;
  #backendClosed = false;

  /**
   * Creates cleanup coordination for resources acquired by the local Chat topology.
   *
   * @param listener Stops gateway intake and releases the bound HTTP listener.
   * @param subscriptions Cancels active subscriptions and releases their bindings.
   * @param backend Stops the native Chat backend after gateway cleanup.
   * @param within Bounds the wait for a listener close without cancelling its in-flight operation.
   */
  constructor(
    private readonly listener: Readonly<{ close(): Promise<void> }>,
    private readonly subscriptions: Readonly<{ close(): Promise<void> }>,
    private readonly backend: Readonly<{ close(): Promise<void> }>,
    private readonly within: (work: Promise<void>, label: string) => Promise<void>,
  ) {}

  /**
   * Closes every unfinished resource phase and shares the in-flight cleanup with concurrent callers.
   *
   * @returns Completes when every cleanup phase succeeds, or rejects with all phase failures.
   */
  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    this.#closing = this.closeOnce().then(
      () => undefined,
      (error: unknown) => {
        this.#closing = undefined;
        throw error;
      },
    );
    return this.#closing;
  }

  /**
   * Acquires topology resources with rollback ownership before an assembly failure.
   *
   * @param assemble Registers each acquired closable resource and returns the assembled result.
   * @returns Returns the assembled result, or rejects after reverse-order rollback.
   */
  static async acquire<Result>(
    assemble: (
      resources: Readonly<{
        acquire<Resource extends { close(): Promise<void> }>(resource: Resource): Resource;
      }>,
    ) => Promise<Result>,
  ): Promise<Result> {
    const resources: Readonly<{ close(): Promise<void> }>[] = [];
    try {
      return await assemble({
        acquire<Resource extends { close(): Promise<void> }>(resource: Resource): Resource {
          resources.push(resource);
          return resource;
        },
      });
    } catch (error) {
      const results = await Promise.allSettled(
        resources.reverse().map((resource) => resource.close()),
      );
      const failures: unknown[] = [];
      for (const result of results) {
        if (result.status === "rejected") failures.push(result.reason);
      }
      if (failures.length > 0)
        throw new AggregateError([error, ...failures], "Local Chat assembly failed.");
      throw error;
    }
  }

  private async closeOnce(): Promise<void> {
    const failures: unknown[] = [];
    const listener = this.#listenerClose();
    if (!this.#subscriptionsClosed) {
      try {
        await this.subscriptions.close();
        this.#subscriptionsClosed = true;
      } catch (error) {
        failures.push(error);
      }
    }
    if (listener !== undefined) {
      try {
        await this.within(listener, "listener");
      } catch (error) {
        failures.push(error);
      }
    }
    if (!this.#backendClosed) {
      try {
        await this.backend.close();
        this.#backendClosed = true;
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, "Local Chat cleanup failed.");
  }

  #listenerClose(): Promise<void> | undefined {
    if (this.#listenerClosed) return undefined;
    if (this.#listenerClosing !== undefined) return this.#listenerClosing;
    this.#listenerClosing = this.listener.close().then(
      () => {
        this.#listenerClosed = true;
        this.#listenerClosing = undefined;
      },
      (error: unknown) => {
        this.#listenerClosing = undefined;
        throw error;
      },
    );
    return this.#listenerClosing;
  }
}
