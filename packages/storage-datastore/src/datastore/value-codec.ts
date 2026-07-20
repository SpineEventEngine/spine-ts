type ValueKind =
  "undefined" | "null" | "boolean" | "number" | "string" | "bigint" | "bytes" | "array" | "object";

type EncodedValue = readonly unknown[];

interface CanonicalValueCodec {
  encode(value: unknown): string;
  decode(encoded: string): unknown;
  equal(left: unknown, right: unknown): boolean;
  compare(left: unknown, right: unknown): number;
}

/** Canonical value identity compatible with generic in-memory storage semantics. */
export const CanonicalValue: CanonicalValueCodec = Object.freeze({
  encode(value: unknown): string {
    return JSON.stringify(encodeValue(value));
  },

  decode(encoded: string): unknown {
    try {
      return decodeValue(JSON.parse(encoded));
    } catch {
      throw new Error("Datastore entity has no valid Spine record identifier.");
    }
  },

  equal(left: unknown, right: unknown): boolean {
    return this.encode(left) === this.encode(right);
  },

  compare(left: unknown, right: unknown): number {
    return compareValues(left, right);
  },
});

function encodeValue(value: unknown): EncodedValue {
  const kind = kindOf(value);
  switch (kind) {
    case "undefined":
    case "null":
      return [kind];
    case "boolean":
    case "string":
      return [kind, value];
    case "number":
      return [kind, String(value)];
    case "bigint":
      return [kind, (value as bigint).toString()];
    case "bytes":
      return [kind, [...(value as Uint8Array)]];
    case "array":
      return [kind, ...(value as readonly unknown[]).map(encodeValue)];
    case "object":
      return [
        kind,
        ...Object.keys(value as object)
          .sort()
          .map((key) => [key, encodeValue(Reflect.get(value as object, key))]),
      ];
  }
}

function decodeValue(value: unknown): unknown {
  if (!Array.isArray(value) || typeof value[0] !== "string") {
    throw new Error("invalid encoded value");
  }
  const [kind, ...payload] = value as readonly unknown[];
  switch (kind) {
    case "undefined":
      expectEncodedLength(value, 1);
      return undefined;
    case "null":
      expectEncodedLength(value, 1);
      return null;
    case "boolean":
      expectEncodedLength(value, 2);
      return expectType(payload[0], "boolean");
    case "number":
      expectEncodedLength(value, 2);
      return decodeNumber(payload[0]);
    case "string":
      expectEncodedLength(value, 2);
      return expectType(payload[0], "string");
    case "bigint":
      expectEncodedLength(value, 2);
      return decodeBigInt(payload[0]);
    case "bytes":
      expectEncodedLength(value, 2);
      return new Uint8Array(expectNumberArray(payload[0]));
    case "array":
      return payload.map(decodeValue);
    case "object": {
      const result = Object.create(null) as Record<string, unknown>;
      let previousKey: string | undefined;
      for (const entry of payload) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") {
          throw new Error("invalid object entry");
        }
        const key = entry[0];
        if (previousKey !== undefined && key <= previousKey) {
          throw new Error("invalid object entry");
        }
        previousKey = key;
        Object.defineProperty(result, key, {
          value: decodeValue(entry[1]),
          enumerable: true,
        });
      }
      return result;
    }
    default:
      throw new Error("invalid encoded value");
  }
}

function compareValues(left: unknown, right: unknown): number {
  const leftKind = kindOf(left);
  const rightKind = kindOf(right);
  if (leftKind !== rightKind) return compareText(leftKind, rightKind);
  switch (leftKind) {
    case "undefined":
    case "null":
      return 0;
    case "boolean":
      return left === right ? 0 : left === false ? -1 : 1;
    case "number":
      return compareNumbers(left as number, right as number);
    case "string":
      return compareText(left as string, right as string);
    case "bigint":
      return compareBigInts(left as bigint, right as bigint);
    case "bytes":
      return compareLists(left as Uint8Array, right as Uint8Array);
    case "array":
      return compareLists(left as readonly unknown[], right as readonly unknown[]);
    case "object":
      return compareObjects(left as object, right as object);
  }
}

function kindOf(value: unknown): ValueKind {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (typeof value === "bigint") return "bigint";
  if (value instanceof Uint8Array) return "bytes";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  throw new Error("Datastore record identifier has an unsupported value type.");
}

function compareObjects(left: object, right: object): number {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  const keys = compareLists(leftKeys, rightKeys);
  if (keys !== 0) return keys;
  for (const key of leftKeys) {
    const comparison = compareValues(Reflect.get(left, key), Reflect.get(right, key));
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function compareLists(left: ArrayLike<unknown>, right: ArrayLike<unknown>): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const comparison = compareValues(left[index], right[index]);
    if (comparison !== 0) return comparison;
  }
  return compareNumbers(left.length, right.length);
}

function compareNumbers(left: number, right: number): number {
  if (Number.isNaN(left) || Number.isNaN(right)) {
    return Number.isNaN(left) === Number.isNaN(right) ? 0 : Number.isNaN(left) ? 1 : -1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareBigInts(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function expectType(value: unknown, type: "boolean" | "string"): boolean | string {
  if (typeof value !== type) throw new Error("invalid encoded value");
  return value as boolean | string;
}

function expectEncodedLength(value: readonly unknown[], length: number): void {
  if (value.length !== length) throw new Error("invalid encoded value");
}

function expectNumberArray(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (item) => typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 255,
    )
  ) {
    throw new Error("invalid encoded value");
  }
  return value as number[];
}

function decodeNumber(value: unknown): number {
  if (typeof value !== "string") throw new Error("invalid encoded value");
  if (value === "NaN") return Number.NaN;
  const decoded = Number(value);
  if (String(decoded) !== value) throw new Error("invalid encoded value");
  return decoded;
}

function decodeBigInt(value: unknown): bigint {
  if (typeof value !== "string") throw new Error("invalid encoded value");
  const decoded = BigInt(value);
  if (decoded.toString() !== value) throw new Error("invalid encoded value");
  return decoded;
}
