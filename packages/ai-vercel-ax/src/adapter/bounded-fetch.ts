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

/**
 * One physical request already admitted by Ax and the durable execution runtime.
 */
export interface ProviderAttemptTicket {
  /**
   * Persisted attempt identity; the transport never increments a second counter.
   */
  readonly id: string;

  /**
   * Actual materialized request-body byte ceiling.
   */
  readonly maxInputBytes: number;

  /**
   * Reserved per-response allowance, already narrowed by invocation credit.
   */
  readonly maxOutputBytes: number;

  /**
   * Absolute deadline read against the runtime's current Time value.
   */
  readonly deadlineEpochMs: number;

  /**
   * Operation cancellation and execution-fence loss signal.
   */
  readonly signal: AbortSignal;
}

/**
 * Runtime callbacks required to guard one trusted provider connection.
 */
export interface BoundedFetchOptions {
  /**
   * Exact credential-free route URLs approved for this connection identity.
   */
  readonly allowedUrls: readonly string[];

  /**
   * Trusted platform fetch; supplied for protocol fixtures as well.
   */
  readonly platformFetch: typeof globalThis.fetch;

  /**
   * Returns whether the current execution fence still permits work.
   * @returns True while this execution may still dispatch or record bytes.
   */
  readonly hasAuthority: () => boolean;

  /**
   * Reads current epoch milliseconds through the runtime Time abstraction.
   * @returns Current Unix epoch milliseconds.
   */
  readonly nowEpochMs: () => number;

  /**
   * Persists the existing attempt and full output credit before network dispatch.
   * @param ticketId Existing physical attempt identity.
   * @param inputBytes Actual materialized request body bytes.
   * @param outputCredit Maximum response body bytes reserved for this attempt.
   * @returns Completion of the durable reservation barrier.
   */
  readonly reserve: (ticketId: string, inputBytes: number, outputCredit: number) => Promise<void>;

  /**
   * Records actual decoded response-body bytes, including a rejected crossing chunk.
   * @param ticketId Existing physical attempt identity.
   * @param bytes Actual bytes in the received platform chunk.
   */
  readonly onReceived: (ticketId: string, bytes: number) => void;
}

/**
 * Scoped fetch plus the admission and revocation controls used by the adapter.
 */
export interface BoundedProviderFetch {
  /**
   * Install directly as the provider SDK's fetch for this operation.
   */
  readonly fetch: typeof globalThis.fetch;

  /**
   * Admits one existing physical-attempt ticket; rejects overlapping admission.
   * @param ticket Previously admitted physical request and effective limits.
   */
  readonly admit: (ticket: ProviderAttemptTicket) => void;

  /**
   * Closes this connection's gate and cancels active network/body reads.
   */
  readonly revoke: () => void;
}

interface ActiveAttempt {
  readonly ticket: ProviderAttemptTicket;
  readonly controller: AbortController;
  readonly cancelled: Promise<never>;
  rejectCancelled: (error: Error) => void;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
  timer?: ReturnType<typeof setTimeout>;
  onAbort?: () => void;
  claiming: boolean;
  consumed: boolean;
  closed: boolean;
  closeReason?: string;
  received: number;
}

/**
 * Marks a bounded diagnostic produced by this transport module.
 */
class TransportFailure extends Error {
  /**
   * Creates a diagnostic without provider or callback content.
   * @param reason Fixed transport failure description.
   */
  constructor(reason: string) {
    super(`Provider transport ${reason}`);
  }
}

const failure = (reason: string): TransportFailure => new TransportFailure(reason);
const maximumTimerDelay = 2_147_483_647;

/**
 * Holds one operation's provider request gate and active network resources.
 */
class FetchGate implements BoundedProviderFetch {
  private readonly allowed: Set<string>;

  private active?: ActiveAttempt;

  private revoked = false;

  /**
   * Creates a gate for one trusted provider connection.
   * @param options Runtime authority, accounting and route callbacks.
   */
  constructor(private readonly options: BoundedFetchOptions) {
    this.allowed = new Set(options.allowedUrls.map(canonicalUrl));
  }

  private close = (attempt: ActiveAttempt, reason: string): void => {
    if (attempt.closed) return;
    attempt.closed = true;
    attempt.closeReason = reason;
    if (attempt.timer) clearTimeout(attempt.timer);
    if (attempt.onAbort) attempt.ticket.signal.removeEventListener("abort", attempt.onAbort);
    attempt.rejectCancelled(failure(reason));
    attempt.controller.abort();
    void attempt.reader?.cancel().catch(() => undefined);
  };

  private check = (attempt: ActiveAttempt): void => {
    if (attempt.closed) throw failure(attempt.closeReason ?? "cancelled");
    if (this.revoked || attempt.ticket.signal.aborted || !this.hasAuthority()) {
      this.close(attempt, "cancelled");
      throw failure("cancelled");
    }
    const now = this.currentTime();
    if (!Number.isFinite(now)) {
      this.close(attempt, "clock unavailable");
      throw failure("clock unavailable");
    }
    if (now >= attempt.ticket.deadlineEpochMs) {
      this.close(attempt, "deadline exceeded");
      throw failure("deadline exceeded");
    }
  };

  private hasAuthority = (): boolean => {
    try {
      return this.options.hasAuthority();
    } catch {
      return false;
    }
  };

  private currentTime = (): number => {
    try {
      return this.options.nowEpochMs();
    } catch {
      return Number.NaN;
    }
  };

  private scheduleDeadline = (attempt: ActiveAttempt): void => {
    if (attempt.closed) return;
    const remaining = attempt.ticket.deadlineEpochMs - this.currentTime();
    if (!Number.isFinite(remaining)) {
      this.close(attempt, "clock unavailable");
      return;
    }
    if (remaining <= 0) {
      this.close(attempt, "deadline exceeded");
      return;
    }
    attempt.timer = setTimeout(
      () => {
        this.scheduleDeadline(attempt);
      },
      Math.min(remaining, maximumTimerDelay),
    );
  };

  readonly admit = (ticket: ProviderAttemptTicket): void => {
    if (this.revoked || (this.active && !this.active.closed))
      throw failure("attempt already active");
    const accepted = Object.freeze({
      id: ticket.id,
      maxInputBytes: ticket.maxInputBytes,
      maxOutputBytes: ticket.maxOutputBytes,
      deadlineEpochMs: ticket.deadlineEpochMs,
      signal: ticket.signal,
    });
    validateTicket(accepted);
    let rejectCancelled!: (error: Error) => void;
    const cancelled = new Promise<never>((_resolve, reject) => (rejectCancelled = reject));
    void cancelled.catch(() => undefined);
    const attempt: ActiveAttempt = {
      ticket: accepted,
      controller: new AbortController(),
      cancelled,
      rejectCancelled,
      claiming: false,
      consumed: false,
      closed: false,
      received: 0,
    };
    attempt.onAbort = () => {
      this.close(attempt, "cancelled");
    };
    this.active = attempt;
    accepted.signal.addEventListener("abort", attempt.onAbort, { once: true });
    this.scheduleDeadline(attempt);
    this.check(attempt);
  };

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const attempt = this.active;
    if (!attempt || attempt.claiming || attempt.consumed) throw failure("attempt unavailable");
    this.check(attempt);
    if (input instanceof Request) throw failure("route rejected");
    const approvedUrl = canonicalUrl(input);
    if (!this.allowed.has(approvedUrl)) throw failure("route rejected");
    const body = await this.prepareBody(init?.body, attempt);
    attempt.consumed = true;
    try {
      await Promise.race([
        this.options.reserve(attempt.ticket.id, body.byteLength, attempt.ticket.maxOutputBytes),
        attempt.cancelled,
      ]);
      this.check(attempt);
      return await this.dispatch(approvedUrl, init, body, attempt);
    } catch (error) {
      this.close(attempt, "request failed");
      throw error instanceof TransportFailure ? error : failure("request failed");
    }
  };

  /**
   * Prepares one request body while cancellation can still settle fetch.
   * @param body SDK request body, if supplied.
   * @param attempt Active physical request ticket.
   * @returns Materialized bytes within the accepted input ceiling.
   */
  private async prepareBody(
    body: BodyInit | null | undefined,
    attempt: ActiveAttempt,
  ): Promise<Uint8Array> {
    attempt.claiming = true;
    try {
      const bytes = await Promise.race([
        materializeBody(body, attempt.ticket.maxInputBytes),
        attempt.cancelled,
      ]);
      this.check(attempt);
      return bytes;
    } catch (error) {
      throw error instanceof TransportFailure ? error : failure("request body unavailable");
    } finally {
      attempt.claiming = false;
    }
  }

  /**
   * Dispatches the consumed ticket through the platform fetch.
   * @param input Validated provider URL.
   * @param init SDK request settings.
   * @param body Materialized request body within the input ceiling.
   * @param attempt Active physical request ticket.
   * @returns A response guarded before provider parsing.
   */
  private async dispatch(
    input: string,
    init: RequestInit | undefined,
    body: Uint8Array,
    attempt: ActiveAttempt,
  ): Promise<Response> {
    const requestBody = new Uint8Array(body.byteLength);
    requestBody.set(body);
    const request: RequestInit = {
      ...init,
      body: body.byteLength ? requestBody : null,
      redirect: "manual",
      signal: attempt.controller.signal,
    };
    const pending = this.options.platformFetch(input, request);
    void pending.then(
      (response) => {
        if (attempt.closed) void response.body?.cancel().catch(() => undefined);
      },
      () => undefined,
    );
    const response = await Promise.race([pending, attempt.cancelled]);
    this.check(attempt);
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => undefined);
      throw failure("redirect rejected");
    }
    return guardedResponse(response, attempt, this.options, this.check, this.close);
  }

  readonly revoke = (): void => {
    this.revoked = true;
    if (this.active) this.close(this.active, "revoked");
  };
}

/**
 * Creates a one-operation fetch gate; no request is possible before admission.
 * @param options Runtime authority, accounting and approved provider routes.
 * @returns A scoped provider fetch with admission and revocation controls.
 */
export const createBoundedProviderFetch = (options: BoundedFetchOptions): BoundedProviderFetch => {
  return new FetchGate(options);
};

const canonicalUrl = (input: string | URL): string => {
  try {
    const url = new URL(input instanceof URL ? input.href : input);
    if (url.username || url.password || url.hash) throw failure("route rejected");
    return url.href;
  } catch {
    throw failure("route rejected");
  }
};

const validateTicket = (ticket: ProviderAttemptTicket): void => {
  if (
    !ticket.id ||
    !Number.isSafeInteger(ticket.maxInputBytes) ||
    ticket.maxInputBytes < 0 ||
    !Number.isSafeInteger(ticket.maxOutputBytes) ||
    ticket.maxOutputBytes <= 0 ||
    !Number.isFinite(ticket.deadlineEpochMs)
  )
    throw failure("invalid attempt");
};

const materializeBody = async (
  body: BodyInit | null | undefined,
  limit: number,
): Promise<Uint8Array> => {
  if (body == null) return new Uint8Array();
  if (typeof body === "string") {
    if (body.length > limit) throw failure("request body exceeds limit");
    return boundedBytes(new TextEncoder().encode(body), limit);
  }
  if (body instanceof URLSearchParams)
    return boundedBytes(new TextEncoder().encode(serializeParams(body, limit)), limit);
  if (body instanceof ArrayBuffer) return boundedBytes(new Uint8Array(body), limit);
  if (ArrayBuffer.isView(body))
    return boundedBytes(new Uint8Array(body.buffer, body.byteOffset, body.byteLength), limit);
  if (body instanceof Blob && body.size <= limit)
    return boundedBytes(new Uint8Array(await body.arrayBuffer()), limit);
  throw failure("request body unsupported or exceeds limit");
};

const serializeParams = (params: URLSearchParams, limit: number): string => {
  let result = "";
  for (const [key, value] of params) {
    const separator = result ? "&" : "";
    if (key.length + value.length + separator.length > limit - result.length)
      throw failure("request body exceeds limit");
    const part = new URLSearchParams([[key, value]]).toString();
    if (part.length + separator.length > limit - result.length)
      throw failure("request body exceeds limit");
    result += separator + part;
  }
  return result;
};

const boundedBytes = (bytes: Uint8Array, limit: number): Uint8Array => {
  if (bytes.byteLength > limit) throw failure("request body exceeds limit");
  return bytes;
};

const guardedResponse = (
  response: Response,
  attempt: ActiveAttempt,
  options: BoundedFetchOptions,
  onCheck: (attempt: ActiveAttempt) => void,
  onClose: (attempt: ActiveAttempt, reason: string) => void,
): Response => {
  if (!response.body) {
    finish(attempt);
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: safeHeaders(response.headers),
    });
  }
  const reader = response.body.getReader();
  attempt.reader = reader;
  const body = guardedBody(reader, attempt, options, onCheck, onClose);
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: safeHeaders(response.headers),
  });
};

const guardedBody = (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  attempt: ActiveAttempt,
  options: BoundedFetchOptions,
  onCheck: (attempt: ActiveAttempt) => void,
  onClose: (attempt: ActiveAttempt, reason: string) => void,
): ReadableStream<Uint8Array> => {
  return new ReadableStream<Uint8Array>(
    {
      /**
       * Reads one platform chunk when the SDK requests it.
       * @param controller Consumer-facing byte stream controller.
       * @returns Completion of this single bounded pull.
       */
      async pull(controller) {
        await pullChunk(reader, attempt, options, onCheck, onClose, controller);
      },

      /**
       * Cancels the platform reader when the SDK stops consuming.
       */
      cancel() {
        onClose(attempt, "reader cancelled");
      },
    },
    { highWaterMark: 0 },
  );
};

const pullChunk = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  attempt: ActiveAttempt,
  options: BoundedFetchOptions,
  onCheck: (attempt: ActiveAttempt) => void,
  onClose: (attempt: ActiveAttempt, reason: string) => void,
  controller: ReadableStreamDefaultController<Uint8Array>,
): Promise<void> => {
  try {
    onCheck(attempt);
    const result = await Promise.race([reader.read(), attempt.cancelled]);
    onCheck(attempt);
    if (result.done) {
      controller.close();
      finish(attempt);
      return;
    }
    const bytes = result.value.byteLength;
    const remaining = attempt.ticket.maxOutputBytes - attempt.received;
    options.onReceived(attempt.ticket.id, bytes);
    onCheck(attempt);
    if (bytes > remaining) throw failure("response byte limit exceeded");
    attempt.received += bytes;
    controller.enqueue(result.value);
  } catch (error) {
    onClose(attempt, "response byte limit or read failure");
    controller.error(error instanceof TransportFailure ? error : failure("response read failed"));
  }
};

const finish = (attempt: ActiveAttempt): void => {
  attempt.closed = true;
  if (attempt.timer) clearTimeout(attempt.timer);
  if (attempt.onAbort) attempt.ticket.signal.removeEventListener("abort", attempt.onAbort);
  attempt.reader?.releaseLock();
};

const safeHeaders = (source: Headers): Headers => {
  const headers = new Headers();
  for (const name of ["content-type", "retry-after", "x-request-id"]) {
    const value = source.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
};
