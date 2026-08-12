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

import path from "node:path";

import type * as ZeroMq from "zeromq";

/**
 * Defines the native ZeroMQ module surface used by the adapter.
 */
export type ZeroMqNativeModule = typeof ZeroMq;

/**
 * Defines the supported scope for ZeroMQ transport endpoints.
 */
export type ZeroMqTransportScope = "local-ipc";

/**
 * Defines caller-supplied local IPC configuration.
 */
export interface ZeroMqConfigInput {
  // prettier-ignore

  /**
   * Specifies the absolute directory that contains local IPC endpoints.
   */
  readonly ipcDirectory: string;

  /**
   * Specifies an optional identity used to distinguish this adapter.
   */
  readonly adapterIdentity?: string;
}

/**
 * Defines validated configuration for the local ZeroMQ adapter.
 */
export class ZeroMqConfig {
  // prettier-ignore

  /**
   * Identifies the local transport scope.
   */
  readonly transportScope: ZeroMqTransportScope;

  /**
   * Identifies the normalized directory that contains IPC endpoints.
   */
  readonly ipcDirectory: string;

  /**
   * Identifies this adapter instance for local IPC use.
   */
  readonly adapterIdentity: string;

  /**
   * Identifies the required native package.
   */
  readonly nativePackageName = "zeromq" as const;

  private constructor(ipcDirectory: string, adapterIdentity: string) {
    this.transportScope = "local-ipc";
    this.ipcDirectory = ipcDirectory;
    this.adapterIdentity = adapterIdentity;
    Object.freeze(this);
  }

  /**
   * Creates immutable configuration for a local IPC adapter.
   *
   * @param input Specifies the directory and optional adapter identity.
   * @returns Returns validated local IPC configuration.
   */
  static create(input: ZeroMqConfigInput): ZeroMqConfig {
    return new ZeroMqConfig(
      ZeroMqConfig.#normalizeDirectory(input.ipcDirectory),
      ZeroMqConfig.#normalizeIdentity(input.adapterIdentity ?? "spine-ts-zmq-adapter"),
    );
  }

  static #normalizeDirectory(value: string): string {
    const directory = ZeroMqConfig.#requiredText(value, "ipcDirectory");

    if (ZeroMqConfig.#hasControlCharacter(directory)) {
      throw new Error("ZeroMQ adapter ipcDirectory must not contain control characters.");
    }

    if (!path.isAbsolute(directory)) {
      throw new Error("ZeroMQ adapter ipcDirectory must be an absolute local filesystem path.");
    }

    return path.normalize(directory);
  }

  static #normalizeIdentity(value: string): string {
    const identity = ZeroMqConfig.#requiredText(value, "adapterIdentity");

    if (!/^[A-Za-z0-9._-]+$/u.test(identity)) {
      throw new Error(
        "ZeroMQ adapter adapterIdentity must contain only letters, numbers, dots, underscores, or hyphens.",
      );
    }

    return identity;
  }

  static #requiredText(value: string, name: string): string {
    const normalized = value.trim();

    if (normalized.length === 0) {
      throw new Error(`ZeroMQ adapter ${name} must not be empty.`);
    }

    return normalized;
  }

  static #hasControlCharacter(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
      const codeUnit = value.charCodeAt(index);

      if (codeUnit <= 0x1f || codeUnit === 0x7f) {
        return true;
      }
    }

    return false;
  }
}
