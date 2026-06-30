import path from "node:path";

import type * as ZeroMq from "zeromq";

export type ZeroMqNativeModule = typeof ZeroMq;

export type ZeroMqTransportScope = "local-ipc";

export interface ZeroMqAdapterConfigInput {
  readonly ipcDirectory: string;
  readonly adapterIdentity?: string;
}

export interface ZeroMqAdapterConfig {
  readonly transportScope: ZeroMqTransportScope;
  readonly ipcDirectory: string;
  readonly adapterIdentity: string;
  readonly nativePackageName: "zeromq";
}

const defaultAdapterIdentity = "spine-ts-zmq-adapter";
const validAdapterIdentityPattern = /^[A-Za-z0-9._-]+$/u;

export function createZeroMqAdapterConfig(input: ZeroMqAdapterConfigInput): ZeroMqAdapterConfig {
  return Object.freeze({
    transportScope: "local-ipc",
    ipcDirectory: normalizeIpcDirectory(input.ipcDirectory),
    adapterIdentity: normalizeAdapterIdentity(input.adapterIdentity ?? defaultAdapterIdentity),
    nativePackageName: "zeromq",
  });
}

function normalizeIpcDirectory(value: string): string {
  const ipcDirectory = normalizeRequiredText(value, "ipcDirectory");

  if (hasControlCharacter(ipcDirectory)) {
    throw new Error("ZeroMQ adapter ipcDirectory must not contain control characters.");
  }

  if (!path.isAbsolute(ipcDirectory)) {
    throw new Error("ZeroMQ adapter ipcDirectory must be an absolute local filesystem path.");
  }

  return path.normalize(ipcDirectory);
}

function normalizeAdapterIdentity(value: string): string {
  const adapterIdentity = normalizeRequiredText(value, "adapterIdentity");

  if (!validAdapterIdentityPattern.test(adapterIdentity)) {
    throw new Error(
      "ZeroMQ adapter adapterIdentity must contain only letters, numbers, dots, underscores, or hyphens.",
    );
  }

  return adapterIdentity;
}

function normalizeRequiredText(value: string, name: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`ZeroMQ adapter ${name} must not be empty.`);
  }

  return normalized;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit <= 0x1f || codeUnit === 0x7f) {
      return true;
    }
  }

  return false;
}
