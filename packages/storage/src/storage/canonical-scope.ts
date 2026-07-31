import type { StorageContext } from "./storage.js";

const storageScopes = {
  // prettier-ignore

  /**
   * Creates a length-delimited storage scope.
   * @param context Supplies the bounded-context and tenant scope.
   * @param storageKey Supplies the physical record layout identity.
   * @returns The canonical storage scope key.
   */
  canonical(context: StorageContext, storageKey: string): string {
    const values = [
      context.name,
      context.multitenant ? storageScopes.tenant(context) : "single-tenant",
      storageKey,
    ];
    return values.map((value) => `${String(storageScopes.utf8Length(value))}:${value}`).join(":");
  },

  /**
   * Returns a required multitenant tenant scope.
   * @param context Supplies the multitenant storage context.
   * @returns The encoded tenant scope.
   */
  tenant(context: StorageContext): string {
    if (context.tenantId === undefined || context.tenantId.trim().length === 0) {
      throw new Error(`Multitenant storage "${context.name}" requires context.tenantId.`);
    }
    return `tenant:${context.tenantId}`;
  },

  /**
   * Returns a UTF-8 byte count without allocating an encoded copy.
   * @param value Supplies the text to measure.
   * @returns The UTF-8 byte length.
   */
  utf8Length(value: string): number {
    let length = 0;
    for (let index = 0; index < value.length; index++) {
      const codePoint = value.codePointAt(index);
      if (codePoint === undefined) continue;
      if (codePoint > 0xffff) index++;
      length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    }
    return length;
  },
};
type StorageScopesOwner = Readonly<typeof storageScopes>;

/**
 * Encodes durable scope identities shared by in-memory storage adapters.
 */
export const StorageScopes: StorageScopesOwner = Object.freeze(storageScopes);
