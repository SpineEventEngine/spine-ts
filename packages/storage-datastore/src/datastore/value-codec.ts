type ValueKind =
  "undefined" | "null" | "boolean" | "number" | "string" | "bigint" | "bytes" | "array" | "object";

type EncodedValue = readonly unknown[];

interface CanonicalValueCodec {
  encode(value: unknown): string;
  decode(encoded: string): unknown;
  equal(left: unknown, right: unknown): boolean;
  compare(left: unknown, right: unknown): number;
}

/**
 * Canonical value identity compatible with generic in-memory storage semantics.
 */
export const CanonicalValue: CanonicalValueCodec = Object.freeze({
  encode(value: unknown): string {
    return JSON.stringify(CanonicalValues.encode(value));
  },

  decode(encoded: string): unknown {
    try {
      return CanonicalValues.decode(JSON.parse(encoded));
    } catch {
      throw new Error("Datastore entity has no valid Spine record identifier.");
    }
  },

  equal(left: unknown, right: unknown): boolean {
    return this.encode(left) === this.encode(right);
  },

  compare(left: unknown, right: unknown): number {
    return CanonicalOrder.compare(left, right);
  },
});

/**
 * Encodes and validates the tagged canonical value representation.
 */
const CanonicalValues = Object.freeze({
  // prettier-ignore

  /**
   * Encodes one supported value into its tagged JSON-safe representation.
   */
  encode(value: unknown): EncodedValue {
    const kind = this.kind(value);
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
        return [kind, ...(value as readonly unknown[]).map((item) => this.encode(item))];
      case "object":
        return [
          kind,
          ...Object.keys(value as object)
            .sort()
            .map((key) => [key, this.encode(Reflect.get(value as object, key))]),
        ];
    }
  },

  /**
   * Decodes and validates one tagged canonical value representation.
   */
  decode(value: unknown): unknown {
    if (!Array.isArray(value) || typeof value[0] !== "string") {
      throw new Error("invalid encoded value");
    }
    const [kind, ...payload] = value as readonly unknown[];
    switch (kind) {
      case "undefined":
        this.length(value, 1);
        return undefined;
      case "null":
        this.length(value, 1);
        return null;
      case "boolean":
        this.length(value, 2);
        return this.type(payload[0], "boolean");
      case "number":
        this.length(value, 2);
        return this.number(payload[0]);
      case "string":
        this.length(value, 2);
        return this.type(payload[0], "string");
      case "bigint":
        this.length(value, 2);
        return this.bigint(payload[0]);
      case "bytes":
        this.length(value, 2);
        return new Uint8Array(this.bytes(payload[0]));
      case "array":
        return payload.map((item) => this.decode(item));
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
            value: this.decode(entry[1]),
            enumerable: true,
          });
        }
        return result;
      }
      default:
        throw new Error("invalid encoded value");
    }
  },

  /**
   * Identifies the supported canonical kind of a value.
   */
  kind(value: unknown): ValueKind {
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
  },

  /**
   * Ensures a tagged representation has its required arity.
   */
  length(value: readonly unknown[], length: number): void {
    if (value.length !== length) throw new Error("invalid encoded value");
  },

  /**
   * Ensures a scalar encoded value has its declared primitive type.
   */
  type(value: unknown, type: "boolean" | "string"): boolean | string {
    if (typeof value !== type) throw new Error("invalid encoded value");
    return value as boolean | string;
  },

  /**
   * Ensures a byte payload is a sequence of unsigned octets.
   */
  bytes(value: unknown): number[] {
    if (
      !Array.isArray(value) ||
      !value.every(
        (item) => typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 255,
      )
    ) {
      throw new Error("invalid encoded value");
    }
    return value as number[];
  },

  /**
   * Decodes a canonical numeric string including its non-finite forms.
   */
  number(value: unknown): number {
    if (typeof value !== "string") throw new Error("invalid encoded value");
    if (value === "NaN") return Number.NaN;
    const decoded = Number(value);
    if (String(decoded) !== value) throw new Error("invalid encoded value");
    return decoded;
  },

  /**
   * Decodes a canonical arbitrary-precision integer string.
   */
  bigint(value: unknown): bigint {
    if (typeof value !== "string") throw new Error("invalid encoded value");
    const decoded = BigInt(value);
    if (decoded.toString() !== value) throw new Error("invalid encoded value");
    return decoded;
  },
});

/**
 * Compares supported canonical values using the storage ordering.
 */
const CanonicalOrder = Object.freeze({
  // prettier-ignore

  /**
   * Compares two values, including their canonical kinds.
   */
  compare(left: unknown, right: unknown): number {
    const leftKind = CanonicalValues.kind(left);
    const rightKind = CanonicalValues.kind(right);
    if (leftKind !== rightKind) return this.text(leftKind, rightKind);
    switch (leftKind) {
      case "undefined":
      case "null":
        return 0;
      case "boolean":
        return left === right ? 0 : left === false ? -1 : 1;
      case "number":
        return this.number(left as number, right as number);
      case "string":
        return this.text(left as string, right as string);
      case "bigint":
        return this.bigint(left as bigint, right as bigint);
      case "bytes":
        return this.list(left as Uint8Array, right as Uint8Array);
      case "array":
        return this.list(left as readonly unknown[], right as readonly unknown[]);
      case "object":
        return this.object(left as object, right as object);
    }
  },

  /**
   * Compares object key sets and then their corresponding values.
   */
  object(left: object, right: object): number {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    const keys = this.list(leftKeys, rightKeys);
    if (keys !== 0) return keys;
    for (const key of leftKeys) {
      const comparison = this.compare(Reflect.get(left, key), Reflect.get(right, key));
      if (comparison !== 0) return comparison;
    }
    return 0;
  },

  /**
   * Compares arrays and byte sequences lexicographically.
   */
  list(left: ArrayLike<unknown>, right: ArrayLike<unknown>): number {
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      const comparison = this.compare(left[index], right[index]);
      if (comparison !== 0) return comparison;
    }
    return this.number(left.length, right.length);
  },

  /**
   * Compares JavaScript numbers with a stable NaN ordering.
   */
  number(left: number, right: number): number {
    if (Number.isNaN(left) || Number.isNaN(right)) {
      return Number.isNaN(left) === Number.isNaN(right) ? 0 : Number.isNaN(left) ? 1 : -1;
    }
    return left < right ? -1 : left > right ? 1 : 0;
  },

  /**
   * Compares arbitrary-precision integers.
   */
  bigint(left: bigint, right: bigint): number {
    return left < right ? -1 : left > right ? 1 : 0;
  },

  /**
   * Compares text using code-unit order.
   */
  text(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
  },
});
