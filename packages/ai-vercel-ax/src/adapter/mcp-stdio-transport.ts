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

import { spawn } from "node:child_process";
import { validateJSONRPCMessage, type JSONRPCMessage, type MCPTransport } from "@ai-sdk/mcp";
import type { AiMcpProtocolControl, AiMcpMessageTicket } from "@spine-event-engine/ai/spi/adapter";
import { scheduleBoundedDeadline } from "./deadline.js";

const maximumSetupBytes = 65_536;
const terminationGraceMs = 100;
const forcedExitMs = 1_000;

interface PendingMessage {
  readonly ticket: AiMcpMessageTicket;
  readonly messageId: string | number;
  readonly chunks: Uint8Array[];
  readonly cancelDeadline: () => void;
  received: number;
}

/**
 * MCP custom stdio transport that caps line bytes before SDK JSON parsing.
 */
export class BoundedMcpStdioTransport implements MCPTransport {
  /**
   * Notifies the SDK after child-process closure.
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

  private process: ReturnType<typeof spawn> | undefined;

  private pending: PendingMessage | undefined;

  private closed = false;

  private closing: Promise<void> | undefined;

  private completingReceipt: Promise<void> | undefined;

  private exited: Promise<void> | undefined;

  private childExited = false;

  private callTicket: { readonly id: string; readonly maxOutputBytes: number } | undefined;

  /**
   * Captures only application-configured process settings and scoped environment.
   * @param executable Authorized process executable.
   * @param args Authorized process arguments.
   * @param cwd Authorized working directory, if configured.
   * @param environment Scoped child environment without inheritance.
   * @param control Fenced runtime accounting controls.
   */
  constructor(
    private readonly executable: string,
    private readonly args: readonly string[],
    private readonly cwd: string | undefined,
    private readonly environment: Readonly<Record<string, string>>,
    private readonly control: AiMcpProtocolControl,
  ) {}

  /**
   * Starts the child without a shell or inherited environment.
   * @returns Completion after process spawn without a shell or inherited environment.
   */
  async start(): Promise<void> {
    this.assertActive();
    const child = spawn(this.executable, [...this.args], {
      cwd: this.cwd,
      env: { ...this.environment },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    this.process = child;
    this.exited = new Promise<void>((resolve) => {
      child.once("close", () => {
        this.childExited = true;
        resolve();
      });
    });
    child.stdout.on("data", (chunk: Buffer) => {
      void this.receive(chunk).catch(() =>
        this.fail(new Error("MCP stdio message journal failed")).catch(() => undefined),
      );
    });
    child.on("error", () => {
      void this.fail(new Error("MCP stdio process failed")).catch(() => undefined);
    });
    child.on("close", () => {
      void this.fail(new Error("MCP stdio process closed")).catch(() => undefined);
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", () => {
        reject(new Error("MCP stdio process failed"));
      });
    });
  }

  /**
   * Marks one runtime-journaled call; later SDK sends cannot invent it.
   * @param id Runtime tool-call identity.
   * @param maxOutputBytes Reserved decoded result limit.
   */
  setCallTicket(id: string, maxOutputBytes: number): void {
    if (this.callTicket) throw new Error("MCP call already active");
    this.callTicket = { id, maxOutputBytes };
  }

  /**
   * Clears the call context after SDK completion.
   */
  clearCallTicket(): void {
    this.callTicket = undefined;
  }

  /**
   * Sends one MCP JSON-RPC line after durable reservation.
   * @param message SDK protocol message.
   * @param options Optional SDK cancellation signal.
   * @returns Completion after the line is sent or its notification is journaled.
   */
  async send(message: JSONRPCMessage, options?: { signal?: AbortSignal }): Promise<void> {
    this.assertActive();
    if (this.pending || this.completingReceipt)
      throw new Error("Concurrent MCP stdio requests unsupported");
    const method = "method" in message ? message.method : "response";
    const callTicket = this.callTicket;
    if (method === "tools/call" && !callTicket)
      throw new Error("MCP tool call lacks persisted intent");
    const body = `${JSON.stringify(message)}\n`;
    const ticket = await this.control.reserveMessage({
      phase: method === "tools/call" ? "call" : "setup",
      method,
      inputBytes: Buffer.byteLength(body),
      maxOutputBytes: callTicket?.maxOutputBytes ?? maximumSetupBytes,
      ...(method === "tools/call" && callTicket ? { toolCallId: callTicket.id } : {}),
    });
    await this.writeReserved(message, body, ticket, options?.signal);
  }

  /**
   * Writes only after the runtime reservation is effective.
   * @param message SDK protocol message.
   * @param body Serialized newline-delimited request.
   * @param ticket Durable physical-send reservation.
   * @param signal Optional SDK cancellation signal.
   * @returns Completion after the line is written.
   */
  private async writeReserved(
    message: JSONRPCMessage,
    body: string,
    ticket: AiMcpMessageTicket,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      this.assertActive();
      if (
        ticket.signal.aborted ||
        signal?.aborted ||
        this.control.nowEpochMs() >= ticket.deadlineEpochMs
      )
        throw new Error("MCP stdio send cancelled");
      if ("id" in message && message.id !== undefined)
        this.pending = this.makePending(ticket, message.id);
      await new Promise<void>((resolve, reject) => {
        const stream = this.process?.stdin;
        if (!stream) {
          reject(new Error("MCP stdio unavailable"));
          return;
        }
        stream.write(body, (error) => {
          if (error) reject(new Error("MCP stdio write failed"));
          else resolve();
        });
      });
      if (!("id" in message)) await this.control.finishMessage(ticket.id, 0);
    } catch (error) {
      if (this.pending?.ticket.id === ticket.id) await this.failPending();
      else await this.control.finishMessage(ticket.id);
      throw error;
    }
  }

  /**
   * Attaches cancellation and a bounded deadline to one response.
   * @param ticket Durable physical-send reservation.
   * @param messageId JSON-RPC correlation identifier.
   * @returns Mutable receive state for this response only.
   */
  private makePending(ticket: AiMcpMessageTicket, messageId: string | number): PendingMessage {
    const cancel = () => {
      void this.fail(new Error("MCP stdio deadline or cancellation")).catch(() => undefined);
    };
    const stopTimer = scheduleBoundedDeadline(
      ticket.deadlineEpochMs,
      this.control.nowEpochMs,
      cancel,
    );
    ticket.signal.addEventListener("abort", cancel, { once: true });
    this.control.signal.addEventListener("abort", cancel, { once: true });
    const cancelDeadline = () => {
      stopTimer();
      ticket.signal.removeEventListener("abort", cancel);
      this.control.signal.removeEventListener("abort", cancel);
    };
    return { ticket, messageId, chunks: [], received: 0, cancelDeadline };
  }

  /**
   * Records a raw child chunk before parsing a complete line.
   * @param chunk Raw stdout bytes.
   * @returns Completion after any response journal barrier.
   */
  private async receive(chunk: Buffer): Promise<void> {
    if (this.closed) return;
    const pending = this.pending;
    if (!pending) {
      await this.fail(new Error("Unsolicited MCP stdio output"));
      return;
    }
    pending.received += chunk.byteLength;
    try {
      this.control.onReceived(pending.ticket.id, chunk.byteLength);
    } catch {
      await this.fail(new Error("MCP stdio byte budget exceeded"));
      return;
    }
    if (pending.received > pending.ticket.maxOutputBytes) {
      await this.fail(new Error("MCP stdio response exceeds byte limit"));
      return;
    }
    pending.chunks.push(chunk);
    const bytes = Buffer.concat(pending.chunks);
    const newline = bytes.indexOf(10);
    if (newline < 0) return;
    await this.finishReceived(pending, bytes, newline);
  }

  /**
   * Persists a complete child line before delivering its validated response.
   * @param pending Current physical protocol reservation.
   * @param bytes Collected bounded stdout bytes.
   * @param newline Final line delimiter position.
   * @returns Completion after receipt persistence and SDK notification.
   */
  private async finishReceived(
    pending: PendingMessage,
    bytes: Buffer,
    newline: number,
  ): Promise<void> {
    if (newline !== bytes.length - 1) {
      await this.fail(new Error("MCP stdio returned extra output"));
      return;
    }
    let message: JSONRPCMessage;
    try {
      message = validateJSONRPCMessage(JSON.parse(bytes.subarray(0, newline).toString("utf8")));
      if (!("id" in message) || message.id !== pending.messageId)
        throw new Error("MCP stdio response ID mismatch");
    } catch {
      await this.fail(new Error("MCP stdio response invalid"));
      return;
    }
    this.pending = undefined;
    pending.cancelDeadline();
    const receipt = this.control.finishMessage(pending.ticket.id, pending.received);
    this.completingReceipt = receipt;
    try {
      await receipt;
      if (this.closed) return;
      this.onmessage?.(message);
    } catch {
      await this.fail(new Error("MCP stdio response invalid"));
    } finally {
      this.completingReceipt = undefined;
    }
  }

  /**
   * Records an uncertain receipt for an incomplete or rejected response.
   * @returns Completion after the uncertain receipt is journaled.
   */
  private async failPending(): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    pending.cancelDeadline();
    await this.control.finishMessage(pending.ticket.id, undefined);
  }

  /**
   * Stops the child and reports failure only after the journal barrier.
   * @param error Sanitized transport failure.
   * @returns Completion after process cancellation and receipt recording.
   */
  private fail(error: Error): Promise<void> {
    if (this.closed) return this.closing ?? Promise.resolve();
    this.closed = true;
    if (!this.childExited) this.process?.kill("SIGTERM");
    this.closing = this.finishClose(error);
    return this.closing;
  }

  /**
   * Waits for durable receipt and definitive child exit before SDK notification.
   * @param error Initial sanitized transport failure.
   * @returns Completion after journal and child cleanup.
   */
  private async finishClose(error: Error): Promise<void> {
    const childStop = this.stopChild().then(
      () => undefined,
      () => new Error("MCP stdio process cleanup failed"),
    );
    let cleanupFailure: Error | undefined;
    try {
      await this.failPending();
      await this.completingReceipt;
    } catch {
      cleanupFailure = new Error("MCP stdio message journal failed");
    }
    cleanupFailure = (await childStop) ?? cleanupFailure;
    this.onerror?.(cleanupFailure ?? error);
    this.onclose?.();
    if (cleanupFailure) throw cleanupFailure;
  }

  /**
   * Stops the child cooperatively or forcibly within bounded time.
   * @returns Completion after cooperative or forced child exit.
   */
  private async stopChild(): Promise<void> {
    if (this.childExited || !this.exited) return;
    if (await waitForExit(this.exited, terminationGraceMs)) return;
    this.process?.kill("SIGKILL");
    if (!(await waitForExit(this.exited, forcedExitMs)))
      throw new Error("MCP stdio process cleanup failed");
  }

  /**
   * Rejects sends after cancellation, authority loss, or deadline.
   */
  private assertActive(): void {
    if (this.closed || this.control.signal.aborted || !this.control.hasAuthority())
      throw new Error("MCP stdio connection cancelled");
    if (this.control.nowEpochMs() >= this.control.deadlineEpochMs)
      throw new Error("MCP stdio connection deadline exceeded");
  }

  /**
   * Closes the child after journaling its pending receipt.
   * @returns Completion after the child is stopped and its pending receipt is journaled.
   */
  close(): Promise<void> {
    return this.fail(new Error("MCP stdio closed"));
  }
}

/**
 * Waits a fixed cleanup interval without allowing a child to hold close forever.
 */
const waitForExit = async (exited: Promise<void>, durationMs: number): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, durationMs);
  });
  const settled = await Promise.race([exited.then(() => true), timeout]);
  if (timer) clearTimeout(timer);
  return settled;
};
