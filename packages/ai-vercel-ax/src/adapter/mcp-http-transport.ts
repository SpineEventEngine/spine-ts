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

import { validateJSONRPCMessage, type JSONRPCMessage, type MCPTransport } from "@ai-sdk/mcp";
import type { AiMcpProtocolControl, AiMcpMessageTicket } from "@spine-event-engine/ai/spi/adapter";
import { scheduleBoundedDeadline } from "./deadline.js";

const maximumSetupBytes = 65_536;

/**
 * Restricts every SDK HTTP send to one durable reservation and bounded response.
 */
export class BoundedMcpHttpTransport implements MCPTransport {
  /**
   * Notifies the SDK after transport closure.
   */
  onclose?: () => void;

  /**
   * Notifies the SDK of a bounded transport failure.
   * @param error Bounded transport failure passed to the MCP client.
   */
  onerror?: (error: Error) => void;

  /**
   * Delivers a validated response after receipt persistence.
   * @param message Validated MCP response after receipt persistence.
   */
  onmessage?: (message: JSONRPCMessage) => void;

  /**
   * Negotiated MCP protocol version supplied by the SDK.
   */
  protocolVersion?: string;

  private closed = false;

  private pending: Promise<void> = Promise.resolve();

  private readonly active = new Set<AbortController>();

  private callTicket: { readonly id: string; readonly maxOutputBytes: number } | undefined;

  /**
   * Creates a connection to an application-selected exact URL.
   * @param url Authorized endpoint, including any configured query.
   * @param headers Scoped request headers.
   * @param control Fenced runtime accounting controls.
   * @param platformFetch HTTP implementation used for this connection.
   */
  constructor(
    private readonly url: string,
    private readonly headers: Readonly<Record<string, string>>,
    private readonly control: AiMcpProtocolControl,
    private readonly platformFetch: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  /**
   * Starts the transport without opening a network request.
   * @returns Completion without opening a network request.
   */
  start(): Promise<void> {
    this.assertActive();
    return Promise.resolve();
  }

  /**
   * Sets the already-persisted tool-call identity for one SDK request.
   * @param id Runtime tool-call identity.
   * @param maxOutputBytes Reserved decoded result limit.
   */
  setCallTicket(id: string, maxOutputBytes: number): void {
    if (this.callTicket) throw new Error("MCP call already active");
    this.callTicket = { id, maxOutputBytes };
  }

  /**
   * Clears tool-call context after SDK completion.
   */
  clearCallTicket(): void {
    this.callTicket = undefined;
  }

  /**
   * Sends one reserved JSON-RPC request and delivers only bounded decoded messages.
   * @param message SDK protocol message.
   * @param options Optional SDK cancellation signal.
   * @returns Completion after the response journal barrier and delivery.
   */
  async send(message: JSONRPCMessage, options?: { signal?: AbortSignal }): Promise<void> {
    this.assertActive();
    const next = this.pending.then(() => this.dispatch(message, options?.signal));
    this.pending = next.catch(() => undefined);
    await next;
  }

  /**
   * Sends one physical message after its durable reservation.
   * @param message SDK protocol message.
   * @param signal Optional SDK cancellation signal.
   * @returns Completion after its bounded send.
   */
  private async dispatch(message: JSONRPCMessage, signal?: AbortSignal): Promise<void> {
    const method = "method" in message ? message.method : "response";
    if (method === "tools/call" && !this.callTicket)
      throw new Error("MCP tool call lacks persisted intent");
    const body = JSON.stringify(message);
    const callTicket = this.callTicket;
    const ticket = await this.control.reserveMessage({
      phase: method === "tools/call" ? "call" : "setup",
      method,
      inputBytes: Buffer.byteLength(body),
      maxOutputBytes: callTicket?.maxOutputBytes ?? maximumSetupBytes,
      ...(method === "tools/call" && callTicket ? { toolCallId: callTicket.id } : {}),
    });
    await this.sendReserved(body, ticket, signal, "id" in message ? message.id : undefined);
  }

  /**
   * Completes a reserved message before exposing its response to the SDK.
   * @param body Serialized JSON-RPC request.
   * @param ticket Durable physical-send reservation.
   * @param signal Optional SDK cancellation signal.
   * @param responseId JSON-RPC identity needed to finish an open SSE response.
   * @returns Completion after receipt persistence and response delivery.
   */
  private async sendReserved(
    body: string,
    ticket: AiMcpMessageTicket,
    signal?: AbortSignal,
    responseId?: string | number,
  ) {
    const send = this.beginSend(ticket, signal);
    let received: number | undefined;
    let messages: readonly JSONRPCMessage[] = [];
    let complete = false;
    try {
      const delivery = await this.fetchReserved(
        body,
        ticket,
        send.abort,
        send.cancelled,
        (bytes) => {
          received = bytes;
        },
        responseId,
      );
      if (delivery)
        messages = this.parseDelivery(delivery.response, delivery.text, delivery.messages);
      complete = true;
    } catch (error) {
      send.abort.abort();
      throw error;
    } finally {
      send.dispose();
      await this.control.finishMessage(ticket.id, complete ? received : undefined);
    }
    for (const message of messages) this.onmessage?.(message);
  }

  /**
   * Binds one physical send to ticket, caller and connection cancellation.
   * @param ticket Durable physical-send reservation.
   * @param signal Optional SDK cancellation signal.
   * @returns Active abort control, rejection and listener cleanup.
   */
  private beginSend(ticket: AiMcpMessageTicket, signal?: AbortSignal) {
    const abort = new AbortController();
    this.active.add(abort);
    const cancel = () => {
      abort.abort();
    };
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort.signal.addEventListener(
        "abort",
        () => {
          reject(new Error("MCP send cancelled"));
        },
        { once: true },
      );
    });
    void cancelled.catch(() => undefined);
    for (const source of [this.control.signal, ticket.signal, signal])
      source?.addEventListener("abort", cancel, { once: true });
    if ([this.control.signal, ticket.signal, signal].some((source) => source?.aborted)) cancel();
    const stopDeadline = scheduleBoundedDeadline(
      ticket.deadlineEpochMs,
      this.control.nowEpochMs,
      cancel,
    );
    return {
      abort,
      cancelled,
      dispose: () => {
        stopDeadline();
        this.active.delete(abort);
        for (const source of [this.control.signal, ticket.signal, signal])
          source?.removeEventListener("abort", cancel);
      },
    };
  }

  /**
   * Reads one guarded response without delivering it to the SDK.
   * @param body Serialized JSON-RPC request.
   * @param ticket Durable physical-send reservation.
   * @param abort Per-send abort control.
   * @param cancelled Promise rejecting when the send is cancelled.
   * @param onProgress Reports cumulative decoded bytes for journaling.
   * @param responseId JSON-RPC identity expected from SSE.
   * @returns Bounded response, or absence for accepted notifications.
   */
  private async fetchReserved(
    body: string,
    ticket: AiMcpMessageTicket,
    abort: AbortController,
    cancelled: Promise<never>,
    onProgress: (bytes: number) => void,
    responseId?: string | number,
  ): Promise<{ response: Response; text: string; messages?: unknown[] } | undefined> {
    const response = await this.requestResponse(body, ticket, abort, cancelled);
    onProgress(0);
    const text = await readBoundedBody(
      response,
      ticket,
      this.control,
      cancelled,
      onProgress,
      responseId,
    );
    if (!response.ok && response.status !== 202)
      throw new Error(`MCP HTTP ${String(response.status)}`);
    return response.status === 202
      ? undefined
      : { response, text: text.value, ...(text.messages ? { messages: text.messages } : {}) };
  }

  /**
   * Dispatches one admitted HTTP request and rejects redirected responses.
   * @param body Serialized JSON-RPC request.
   * @param ticket Durable physical-send reservation.
   * @param abort Per-send abort control.
   * @param cancelled Promise rejecting when the send is cancelled.
   * @returns HTTP response before decoded-byte accounting.
   */
  private async requestResponse(
    body: string,
    ticket: AiMcpMessageTicket,
    abort: AbortController,
    cancelled: Promise<never>,
  ): Promise<Response> {
    this.assertActive();
    if (this.control.nowEpochMs() >= ticket.deadlineEpochMs || abort.signal.aborted)
      throw new Error("MCP deadline or cancellation");
    const pending = this.platformFetch(this.url, {
      method: "POST",
      body,
      redirect: "manual",
      signal: abort.signal,
      headers: {
        ...this.headers,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
    });
    void pending.then(
      (response) => {
        if (abort.signal.aborted) void response.body?.cancel().catch(() => undefined);
      },
      () => undefined,
    );
    const response = await Promise.race([pending, cancelled]);
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error("MCP redirect rejected");
    }
    return response;
  }

  /**
   * Validates a complete bounded response before receipt persistence.
   * @param response HTTP response metadata.
   * @param value Bounded decoded response body.
   * @param parsedMessages Incremental SSE frames, when available.
   * @returns Validated JSON-RPC messages to deliver after receipt persistence.
   */
  private parseDelivery(
    response: Response,
    value: string,
    parsedMessages?: unknown[],
  ): readonly JSONRPCMessage[] {
    const type = response.headers.get("content-type") ?? "";
    if (type.includes("text/event-stream") && !parsedMessages)
      throw new Error("MCP SSE frames missing after bounded read");
    const messages = type.includes("text/event-stream")
      ? (parsedMessages ?? [])
      : [JSON.parse(value)];
    if (!type.includes("application/json") && !type.includes("text/event-stream"))
      throw new Error("MCP response content type unsupported");
    return messages.map((message) => validateJSONRPCMessage(message));
  }

  /**
   * Rejects sends after cancellation, authority loss, or deadline.
   */
  private assertActive(): void {
    if (this.closed || this.control.signal.aborted || !this.control.hasAuthority())
      throw new Error("MCP connection cancelled");
    if (this.control.nowEpochMs() >= this.control.deadlineEpochMs)
      throw new Error("MCP connection deadline exceeded");
  }

  /**
   * Closes the transport by aborting active requests without a termination send.
   * @returns Completion after active requests are aborted without a termination send.
   */
  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    for (const request of this.active) request.abort();
    this.onclose?.();
    return Promise.resolve();
  }
}

/**
 * Reads decoded HTTP bytes and counts the crossing chunk before rejection.
 */
const readBoundedBody = async (
  response: Response,
  ticket: AiMcpMessageTicket,
  control: AiMcpProtocolControl,
  cancelled: Promise<never>,
  onProgress: (bytes: number) => void,
  responseId?: string | number,
): Promise<{ readonly value: string; readonly bytes: number; readonly messages?: unknown[] }> => {
  const reader = response.body?.getReader();
  if (!reader) return { value: "", bytes: 0 };
  const chunks: Uint8Array[] = [];
  const sse = response.headers.get("content-type")?.includes("text/event-stream") === true;
  const frames = new SseFrames();
  let total = 0;
  let complete = false;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), cancelled]);
      if (done) {
        complete = true;
        break;
      }
      total = countBoundedChunk(value, total, ticket, control, onProgress);
      chunks.push(value);
      if (sse && frames.append(value, responseId))
        return { value: "", bytes: total, messages: frames.messages };
    }
    return completedBody(chunks, total, sse, frames);
  } finally {
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
};

/**
 * Returns bounded bytes and finalized SSE frames after the response ends.
 * @param chunks Decoded response chunks.
 * @param total Known decoded byte count.
 * @param sse Whether the response is an SSE stream.
 * @param frames Incremental SSE parser.
 * @returns Bounded body or parsed frames.
 */
const completedBody = (
  chunks: readonly Uint8Array[],
  total: number,
  sse: boolean,
  frames: SseFrames,
): { readonly value: string; readonly bytes: number; readonly messages?: unknown[] } => ({
  value: Buffer.concat(chunks).toString("utf8"),
  bytes: total,
  ...(sse ? { messages: frames.finish() } : {}),
});

/**
 * Counts one decoded chunk, including the chunk that crosses the reserved cap.
 * @param value Decoded response chunk.
 * @param prior Previously received byte count.
 * @param ticket Durable response credit.
 * @param control Runtime synchronous chunk accounting.
 * @param onProgress Reports cumulative bytes for receipt persistence.
 * @returns Cumulative decoded bytes within the cap.
 */
const countBoundedChunk = (
  value: Uint8Array,
  prior: number,
  ticket: AiMcpMessageTicket,
  control: AiMcpProtocolControl,
  onProgress: (bytes: number) => void,
): number => {
  const total = prior + value.byteLength;
  onProgress(total);
  control.onReceived(ticket.id, value.byteLength);
  if (total > ticket.maxOutputBytes) throw new Error("MCP response exceeds byte limit");
  return total;
};

/**
 * Holds only bounded SSE text and parsed frames during one physical response.
 */
class SseFrames {
  readonly messages: unknown[] = [];

  private readonly decoder = new TextDecoder();

  private readonly lineCharacters: string[] = [];

  private readonly frameLines: string[] = [];

  private matched = false;

  /**
   * Adds one bounded chunk to the incremental SSE parser.
   * @param value Bounded decoded response chunk.
   * @param responseId JSON-RPC request identity, when a response is expected.
   * @returns Whether the appended bytes complete the expected response.
   */
  append(value: Uint8Array, responseId?: string | number): boolean {
    this.scan(this.decoder.decode(value, { stream: true }), responseId);
    return this.matched;
  }

  /**
   * Returns parsed frames after flushing final decoder text.
   * @returns Parsed frames plus any final decoder text after EOF.
   */
  finish(): unknown[] {
    this.scan(this.decoder.decode());
    if (this.lineCharacters.length) this.completeLine();
    this.completeFrame();
    return this.messages;
  }

  /**
   * Processes each decoded character once, including fragmented delimiters.
   * @param text Newly decoded SSE text.
   * @param responseId JSON-RPC response expected by the physical request.
   */
  private scan(text: string, responseId?: string | number): void {
    for (const character of text) {
      if (character === "\n") this.completeLine(responseId);
      else this.lineCharacters.push(character);
    }
  }

  /**
   * Completes one SSE line without copying an incomplete frame.
   * @param responseId JSON-RPC response expected by the physical request.
   */
  private completeLine(responseId?: string | number): void {
    if (this.lineCharacters.at(-1) === "\r") this.lineCharacters.pop();
    const line = this.lineCharacters.join("");
    this.lineCharacters.length = 0;
    if (line) this.frameLines.push(line);
    else this.completeFrame(responseId);
  }

  /**
   * Parses one complete bounded frame and checks only its new response.
   * @param responseId JSON-RPC response expected by the physical request.
   */
  private completeFrame(responseId?: string | number): void {
    const data = this.frameLines.filter((line) => line.startsWith("data:"));
    this.frameLines.length = 0;
    if (!data.length) return;
    const message: unknown = JSON.parse(data.map((line) => line.slice(5).trimStart()).join("\n"));
    this.messages.push(message);
    if (responseId !== undefined && matchesResponse(message, responseId)) this.matched = true;
  }
}

/**
 * Checks one bounded SSE message against the request's JSON-RPC identity.
 */
const matchesResponse = (message: unknown, responseId: string | number): boolean =>
  typeof message === "object" && message !== null && "id" in message && message.id === responseId;
