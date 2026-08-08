import { Buffer } from "node:buffer";
import type { StorageContext } from "@spine-event-engine/storage";

/** Builds the canonical bounded MySQL scope key. @internal */
export function mysqlScopeKey(context: StorageContext): Uint8Array {
  const name = Buffer.from(context.name, "utf8");
  const tenant = context.multitenant ? Buffer.from(context.tenantId ?? "", "utf8") : undefined;
  const size = 4 + name.length + 1 + (tenant === undefined ? 0 : 4 + tenant.length);
  if (size > 224) throw new Error("MySQL storage scope is too large.");
  const result = Buffer.allocUnsafe(size);
  result.writeUInt32BE(name.length, 0);
  name.copy(result, 4);
  result[4 + name.length] = tenant === undefined ? 0 : 1;
  if (tenant !== undefined) {
    result.writeUInt32BE(tenant.length, 5 + name.length);
    tenant.copy(result, 9 + name.length);
  }
  return result;
}
