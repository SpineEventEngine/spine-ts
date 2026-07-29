/** Informational session facts returned by an application gateway; never credentials. */
export interface BrowserSessionContext {
  readonly actor?: string;
  readonly tenant?: string;
  readonly expiresAt?: Date;
}

/** A finite, abortable application-owned reauthentication adapter. */
export type OnBrowserSessionContext = (
  request: Readonly<{ signal: AbortSignal }>,
) => Promise<BrowserSessionContext | undefined>;

/** Shared bounded HTTP configuration for an application-owned browser session. */
export interface BrowserSessionOptions {
  readonly fetch?: typeof globalThis.fetch;
  /** A positive request deadline in milliseconds, capped at one minute. */
  readonly maxRequestMs?: number;
}

/** Construction options for an in-memory bearer session. */
export interface BearerBrowserSessionOptions extends BrowserSessionOptions {
  readonly token: string;
}

/** Browser-managed cookie or memory-only bearer session resource. */
export class BrowserSession {
  readonly #fetch: typeof globalThis.fetch;
  readonly #maxRequestMs: number;
  readonly #credentials: "include" | "omit";
  readonly #controllers = new Set<AbortController>();
  #bearer: string | undefined;
  #closed = false;
  #context: BrowserSessionContext | undefined;
  #reauthenticationGeneration = 0;

  private constructor(
    credentials: "include" | "omit",
    bearer: string | undefined,
    options: BrowserSessionOptions,
  ) {
    this.#credentials = credentials;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    if (typeof this.#fetch !== "function")
      throw new TypeError("Browser session requires a fetch implementation.");
    this.#maxRequestMs = requestDeadline(options.maxRequestMs);
    this.#bearer = bearer;
  }

  /** Browser Fetch credential mode selected by this immutable session. */
  get credentials(): "include" | "omit" {
    return this.#credentials;
  }

  /** Creates a browser-managed cookie session. Cookies never enter JavaScript metadata. */
  static cookie(options: BrowserSessionOptions = {}): BrowserSession {
    return new BrowserSession("include", undefined, options);
  }

  /** Creates a memory-only bearer session. The token is never persisted by this resource. */
  static bearer(options: BearerBrowserSessionOptions): BrowserSession {
    return new BrowserSession("omit", requiredToken(options.token), options);
  }

  /** The latest application gateway facts, which are informational and never credentials. */
  get context(): BrowserSessionContext | undefined {
    return this.#context === undefined ? undefined : copyContext(this.#context);
  }

  /** Returns new metadata for one request without exposing cookie values. */
  requestMetadata(): Headers {
    const headers = new Headers();
    if (this.#bearer !== undefined) headers.set("authorization", `Bearer ${this.#bearer}`);
    return headers;
  }

  /** Atomically replaces the memory-only bearer value. */
  replaceBearer(token: string): void {
    this.#assertOpen();
    if (this.#credentials !== "omit")
      throw new TypeError("Cookie sessions do not accept bearer tokens.");
    this.#bearer = requiredToken(token);
  }

  /** Removes the memory-only bearer value. Cookie sessions remain browser-managed. */
  clearBearer(): void {
    this.#bearer = undefined;
  }

  /**
   * Runs an application-owned HTTP request with session transport behavior and
   * a finite deadline. It does not implement a provider sign-in flow.
   */
  async fetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const bearer = this.#bearer;
    return this.#run(init.signal ?? undefined, async (signal) => {
      const headers = new Headers(init.headers);
      if (bearer === undefined) headers.delete("authorization");
      else headers.set("authorization", `Bearer ${bearer}`);
      try {
        return await this.#fetch(input, {
          ...init,
          credentials: this.#credentials,
          headers,
          signal,
        });
      } catch (error) {
        throw redactedError(error, bearer);
      }
    });
  }

  /** Refreshes informational context before a reconnect without treating it as credentials. */
  async reauthenticate(
    onContext: OnBrowserSessionContext,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<void> {
    if (typeof onContext !== "function")
      throw new TypeError("Browser reauthentication adapter is required.");
    const generation = ++this.#reauthenticationGeneration;
    const context = await this.#run(options.signal, (signal) => onContext({ signal }));
    if (generation !== this.#reauthenticationGeneration || this.#closed) return;
    this.#context = context === undefined ? undefined : freezeContext(context);
  }

  /** Aborts session-owned HTTP or reauthentication work and clears memory-only credentials. */
  close(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    this.#closed = true;
    this.#bearer = undefined;
    this.#context = undefined;
    for (const controller of this.#controllers)
      controller.abort(new Error("Browser session is closed."));
    return Promise.resolve();
  }

  async #run<Result>(
    signal: AbortSignal | undefined,
    work: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result> {
    this.#assertOpen();
    if (signal?.aborted) throw signal.reason;
    const controller = new AbortController();
    const abort = () => {
      controller.abort(signal?.reason);
    };
    const timeout = setTimeout(() => {
      controller.abort(new Error("Browser session request timed out."));
    }, this.#maxRequestMs);
    signal?.addEventListener("abort", abort, { once: true });
    this.#controllers.add(controller);
    try {
      const operation = work(controller.signal);
      void operation.catch(() => undefined);
      const aborted = Promise.withResolvers<never>();
      const rejectAbort = () => {
        aborted.reject(controller.signal.reason ?? new Error("Browser session request aborted."));
      };
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
      const result = await Promise.race([operation, aborted.promise]).finally(() => {
        controller.signal.removeEventListener("abort", rejectAbort);
      });
      this.#assertOpen();
      return result;
    } finally {
      clearTimeout(timeout);
      this.#controllers.delete(controller);
      signal?.removeEventListener("abort", abort);
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Browser session is closed.");
  }
}

function requestDeadline(value: number | undefined): number {
  const deadline = value ?? 10_000;
  if (!Number.isSafeInteger(deadline) || deadline <= 0 || deadline > 60_000)
    throw new RangeError(
      "Browser session request deadline must be a positive safe integer at most 60000.",
    );
  return deadline;
}

function requiredToken(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 16_384)
    throw new TypeError(
      "Browser bearer token must be a non-empty string of at most 16384 characters.",
    );
  return value;
}

function freezeContext(value: BrowserSessionContext): BrowserSessionContext {
  if (
    value.actor !== undefined &&
    (typeof value.actor !== "string" || value.actor.length === 0 || value.actor.length > 4_096)
  )
    throw new TypeError(
      "Browser session actor must be a non-empty string of at most 4096 characters.",
    );
  if (
    value.tenant !== undefined &&
    (typeof value.tenant !== "string" || value.tenant.length === 0 || value.tenant.length > 4_096)
  )
    throw new TypeError(
      "Browser session tenant must be a non-empty string of at most 4096 characters.",
    );
  if (
    value.expiresAt !== undefined &&
    (!(value.expiresAt instanceof Date) || !Number.isFinite(value.expiresAt.getTime()))
  )
    throw new TypeError("Browser session expiry must be a valid Date.");
  return Object.freeze({
    ...(value.actor === undefined ? {} : { actor: value.actor }),
    ...(value.tenant === undefined ? {} : { tenant: value.tenant }),
    ...(value.expiresAt === undefined ? {} : { expiresAt: new Date(value.expiresAt) }),
  });
}

function copyContext(value: BrowserSessionContext): BrowserSessionContext {
  return Object.freeze({
    ...(value.actor === undefined ? {} : { actor: value.actor }),
    ...(value.tenant === undefined ? {} : { tenant: value.tenant }),
    ...(value.expiresAt === undefined ? {} : { expiresAt: new Date(value.expiresAt) }),
  });
}

function redactedError(error: unknown, bearer: string | undefined): Error {
  const source = error instanceof Error ? error.message : String(error);
  const message = bearer === undefined ? source : source.replaceAll(bearer, "[REDACTED]");
  return new Error(message);
}
