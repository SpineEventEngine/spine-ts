import type { StorageContext } from "./storage.js";

/** Internal durable scope encoding shared by in-memory storage adapters. */
export function canonicalStorageScope(context: StorageContext, storageKey: string): string {
  const values = [
    context.name,
    context.multitenant ? multitenantScope(context) : "single-tenant",
    storageKey,
  ];
  return values.map((value) => `${String(utf8Length(value))}:${value}`).join(":");
}

function multitenantScope(context: StorageContext): string {
  if (context.tenantId === undefined || context.tenantId.trim().length === 0) {
    throw new Error(`Multitenant storage "${context.name}" requires context.tenantId.`);
  }
  return `tenant:${context.tenantId}`;
}

function utf8Length(value: string): number {
  let length = 0;
  for (let index = 0; index < value.length; index++) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) continue;
    if (codePoint > 0xffff) index++;
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return length;
}
