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

import type { CredentialCipher } from "./credential-store.js";

interface ElectronSafeStorage {
  /**
   * Checks whether OS-backed encryption is available.
   *
   * @returns The is encryption available result.
   */
  isEncryptionAvailable(): boolean;

  /**
   * Encodes text with Electron safeStorage.
   *
   * @param text The text for this operation.
   * @returns The encrypt string result.
   */
  encryptString(text: string): Buffer;

  /**
   * Decodes bytes with Electron safeStorage.
   *
   * @param bytes The bytes for this operation.
   * @returns The decrypt string result.
   */
  decryptString(bytes: Buffer): string;
}

/**
 * Creates a cipher backed by Electron protected storage.
 *
 * @param storage The Electron safeStorage adapter.
 * @returns A credential cipher that refuses plaintext fallback.
 */
export const electronCipher = (storage: ElectronSafeStorage): CredentialCipher => {
  if (!storage.isEncryptionAvailable())
    throw new Error("Protected credential storage is unavailable.");
  return {
    encrypt: (text) => storage.encryptString(text),
    decrypt: (bytes) => storage.decryptString(Buffer.from(bytes)),
  };
};

interface IpcContext {
  /**
   * The sender id value.
   */
  readonly senderId: number;

  /**
   * The expected sender id value.
   */
  readonly expectedSenderId: number;

  /**
   * The frame url value.
   */
  readonly frameUrl: string;

  /**
   * The expected frame url value.
   */
  readonly expectedFrameUrl: string;
}

const argumentsFor = {
  /**
   * Validates a bounded account and model pair.
   *
   * @param argument The untrusted renderer payload.
   * @returns The validated account and model pair.
   */
  model(argument: unknown): { readonly clientId: string; readonly model: string } {
    if (
      typeof argument !== "object" ||
      argument === null ||
      Array.isArray(argument) ||
      Object.keys(argument).sort().join(",") !== "clientId,model" ||
      !("clientId" in argument) ||
      !("model" in argument) ||
      typeof argument.clientId !== "string" ||
      typeof argument.model !== "string" ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(argument.clientId) ||
      !/^[A-Za-z0-9._-]{1,128}$/.test(argument.model)
    )
      throw new Error("Invalid model selection.");
    return { clientId: argument.clientId, model: argument.model };
  },

  /**
   * Validates a bounded account identifier.
   *
   * @param argument The untrusted renderer payload.
   * @returns The validated account identifier.
   */
  account(argument: unknown): string {
    if (typeof argument !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(argument)) {
      throw new Error("Invalid account reference.");
    }
    return argument;
  },
};

/**
 * Validates the sender and bounded renderer command surface.
 *
 * @param context The sender and expected window identity.
 * @param command The requested command.
 * @param argument The untrusted renderer payload.
 * @returns The validated command argument.
 */
export const validateIpc = (
  context: IpcContext,
  command: string,
  argument: unknown,
): string | { readonly clientId: string; readonly model: string } | null => {
  if (
    context.senderId !== context.expectedSenderId ||
    context.frameUrl !== context.expectedFrameUrl
  ) {
    throw new Error("IPC sender is not the application renderer.");
  }
  if (command === "status" || command === "sign-in" || command === "usage") {
    if (argument !== null) throw new Error("Unexpected IPC argument.");
    return null;
  }
  if (command === "select-model") return argumentsFor.model(argument);
  if (
    command !== "models" &&
    command !== "sign-out" &&
    command !== "select-account" &&
    command !== "reconnect"
  ) {
    throw new Error("Unknown IPC command.");
  }
  return argumentsFor.account(argument);
};
