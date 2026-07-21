const maxKeyBytes = 768;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Private canonical binary codec for scopes, tenants, and storage slot IDs. */
export const CanonicalMysqlValue: Readonly<{
  encode(value: unknown, maxBytes?: number): Uint8Array;
  decode(encoded: Uint8Array): unknown;
}> = Object.freeze({
  encode(value: unknown, maxBytes = maxKeyBytes): Uint8Array {
    const encoded = encoder.encode(JSON.stringify(encodeValue(value, new WeakSet<object>())));
    if (encoded.byteLength > maxBytes) {
      throw new Error("MySQL storage identifier is too large.");
    }
    return encoded;
  },

  decode(encoded: Uint8Array): unknown {
    try {
      return decodeValue(JSON.parse(decoder.decode(encoded)));
    } catch {
      throw new Error("MySQL storage has no valid record identifier.");
    }
  },
});

/** Private sortable bytes: bigint < boolean < null < number < string. */
export const SortableMysqlColumnValue: Readonly<{
  encode(value: unknown): { readonly kind: number; readonly data: Uint8Array };
}> = Object.freeze({
  encode(value: unknown): { readonly kind: number; readonly data: Uint8Array } {
    if (typeof value === "bigint") {
      if (value < -(1n << 63n) || value > (1n << 63n) - 1n) throw new Error("unsupported");
      return { kind: 1, data: integerBytes(value + (1n << 63n)) };
    }
    if (typeof value === "boolean") return { kind: 2, data: new Uint8Array([value ? 1 : 0]) };
    if (value === null) return { kind: 3, data: new Uint8Array() };
    if (typeof value === "number" && Number.isFinite(value)) {
      const normalized = Object.is(value, -0) ? 0 : value;
      const bytes = new Uint8Array(8);
      new DataView(bytes.buffer).setFloat64(0, normalized, false);
      if (((bytes[0] ?? 0) & 0x80) !== 0) {
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = ~(bytes[index] ?? 0);
      } else bytes[0] = (bytes[0] ?? 0) ^ 0x80;
      return { kind: 4, data: bytes };
    }
    if (typeof value === "string") {
      const bytes = new Uint8Array(value.length * 3);
      let offset = 0;
      for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index) + 1;
        bytes[offset] = code >>> 16;
        bytes[offset + 1] = code >>> 8;
        bytes[offset + 2] = code;
        offset += 3;
      }
      if (bytes.byteLength > 768) throw new Error("too large");
      return { kind: 5, data: bytes };
    }
    throw new Error("unsupported");
  },
});

function integerBytes(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = Number(value & 255n);
    value >>= 8n;
  }
  return bytes;
}

function encodeValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value === undefined) return ["undefined"];
  if (value === null) return ["null"];
  if (typeof value === "boolean" || typeof value === "string") return [typeof value, value];
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("MySQL storage identifier has an unsupported value.");
    return ["number", String(value)];
  }
  if (typeof value === "bigint") return ["bigint", value.toString()];
  if (value instanceof Uint8Array) return ["bytes", [...value]];
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error("MySQL storage identifier has an unsupported value.");
    ancestors.add(value);
    const encoded = ["array", ...value.map((item) => encodeValue(item, ancestors))];
    ancestors.delete(value);
    return encoded;
  }
  if (typeof value === "object" && isPlainObject(value)) {
    if (ancestors.has(value)) throw new Error("MySQL storage identifier has an unsupported value.");
    ancestors.add(value);
    const encoded = [
      "object",
      ...Object.keys(value)
        .sort()
        .map((key) => [key, encodeValue(Reflect.get(value, key), ancestors)]),
    ];
    ancestors.delete(value);
    return encoded;
  }
  throw new Error("MySQL storage identifier has an unsupported value.");
}

function decodeValue(encoded: unknown): unknown {
  if (!Array.isArray(encoded) || typeof encoded[0] !== "string") throw new Error("invalid");
  const values = encoded as unknown[];
  const [kind, ...payload] = values;
  if (kind === "undefined" && payload.length === 0) return undefined;
  if (kind === "null" && payload.length === 0) return null;
  if (kind === "boolean" && payload.length === 1 && typeof payload[0] === "boolean")
    return payload[0];
  if (kind === "string" && payload.length === 1 && typeof payload[0] === "string")
    return payload[0];
  if (kind === "number" && payload.length === 1 && typeof payload[0] === "string") {
    const value = Number(payload[0]);
    if (Number.isFinite(value) && String(value) === payload[0]) return value;
  }
  if (kind === "bigint" && payload.length === 1 && typeof payload[0] === "string") {
    const value = BigInt(payload[0]);
    if (value.toString() === payload[0]) return value;
  }
  if (kind === "bytes" && payload.length === 1 && Array.isArray(payload[0])) {
    if (
      payload[0].every(
        (item) => typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 255,
      )
    ) {
      return new Uint8Array(payload[0]);
    }
  }
  if (kind === "array") return payload.map(decodeValue);
  if (kind === "object") {
    const result = Object.create(null) as Record<string, unknown>;
    let previousKey: string | undefined;
    for (const entry of payload) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== "string" ||
        (previousKey !== undefined && entry[0] <= previousKey)
      )
        throw new Error("invalid");
      previousKey = entry[0];
      result[entry[0]] = decodeValue(entry[1]);
    }
    return result;
  }
  throw new Error("invalid");
}

function isPlainObject(value: object): boolean {
  const prototype: object | null = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}
