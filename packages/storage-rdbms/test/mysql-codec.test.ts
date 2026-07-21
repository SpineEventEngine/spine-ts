import { describe, expect, it } from "vitest";

import { CanonicalMysqlValue, SortableMysqlColumnValue } from "../src/mysql/value-codec.js";

describe("CanonicalMysqlValue", () => {
  it("round-trips canonical nested slot IDs without preserving object key order", () => {
    const id = { z: [undefined, new Uint8Array([0, 255]), -4n], a: "case-sensitive" };

    const encoded = CanonicalMysqlValue.encode(id);

    expect(CanonicalMysqlValue.decode(encoded)).toEqual({
      a: "case-sensitive",
      z: [undefined, new Uint8Array([0, 255]), -4n],
    });
    expect(CanonicalMysqlValue.encode({ a: "case-sensitive", z: id.z })).toEqual(encoded);
  });

  it("rejects non-finite, cyclic, and oversized IDs before database work", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(() => CanonicalMysqlValue.encode(Number.NaN)).toThrow("unsupported");
    expect(() => CanonicalMysqlValue.encode(cyclic)).toThrow("unsupported");
    expect(() => CanonicalMysqlValue.encode("x".repeat(769))).toThrow("too large");
  });

  it("rejects malformed and non-canonical aliases instead of decoding another slot", () => {
    expect(() => CanonicalMysqlValue.decode(new TextEncoder().encode('["number","-0"]'))).toThrow(
      "valid record identifier",
    );
    expect(() =>
      CanonicalMysqlValue.decode(
        new TextEncoder().encode('["object",["a",["string","one"]],["a",["string","two"]]]'),
      ),
    ).toThrow("valid record identifier");
    expect(() => CanonicalMysqlValue.decode(new Uint8Array([255, 0, 1]))).toThrow(
      "valid record identifier",
    );
  });

  it("decodes every supported canonical scalar, byte, and collection form", () => {
    const decode = (value: unknown) =>
      CanonicalMysqlValue.decode(new TextEncoder().encode(JSON.stringify(value)));

    expect(decode(["undefined"])).toBeUndefined();
    expect(decode(["null"])).toBeNull();
    expect(decode(["boolean", true])).toBe(true);
    expect(decode(["string", "slot"])).toBe("slot");
    expect(decode(["bigint", "-2"])).toBe(-2n);
    expect(decode(["bytes", [0, 255]])).toEqual(new Uint8Array([0, 255]));
    expect(decode(["array", ["null"], ["number", "2"]])).toEqual([null, 2]);
  });

  it("rejects invalid canonical byte and object payloads", () => {
    const decode = (value: unknown) =>
      CanonicalMysqlValue.decode(new TextEncoder().encode(JSON.stringify(value)));

    expect(() => decode(["bytes", [256]])).toThrow("valid record identifier");
    expect(() => decode(["object", ["z", ["null"]], ["a", ["null"]]])).toThrow(
      "valid record identifier",
    );
  });
});

describe("SortableMysqlColumnValue", () => {
  it("uses MySQL VARBINARY order for every supported value kind", () => {
    const encoded = [
      -10n,
      2n,
      10n,
      -(1n << 63n),
      (1n << 63n) - 1n,
      false,
      true,
      null,
      -Number.MAX_VALUE,
      -0,
      2,
      Number.MAX_SAFE_INTEGER + 1,
      Number.MAX_VALUE,
      "A",
      "a",
      "á",
      "\ud800",
      "\udc00",
    ].map((value) => ({ value, ...SortableMysqlColumnValue.encode(value) }));

    const mysqlOrder = [...encoded].sort(
      (left, right) => left.kind - right.kind || compareBytes(left.data, right.data),
    );

    expect(mysqlOrder.map(({ value }) => value)).toEqual([
      -(1n << 63n),
      -10n,
      2n,
      10n,
      (1n << 63n) - 1n,
      false,
      true,
      null,
      -Number.MAX_VALUE,
      -0,
      2,
      Number.MAX_SAFE_INTEGER + 1,
      Number.MAX_VALUE,
      "A",
      "a",
      "á",
      "\ud800",
      "\udc00",
    ]);
    expect(SortableMysqlColumnValue.encode(-0)).toEqual(SortableMysqlColumnValue.encode(0));
  });

  it("accepts exactly 768 string bytes and rejects the next UTF-16 code unit", () => {
    expect(SortableMysqlColumnValue.encode("x".repeat(256)).data).toHaveLength(768);
    expect(() => SortableMysqlColumnValue.encode("x".repeat(257))).toThrow("too large");
  });

  it("rejects values outside the indexed provider-honest set", () => {
    expect(() => SortableMysqlColumnValue.encode(1n << 63n)).toThrow("unsupported");
    expect(() => SortableMysqlColumnValue.encode(Number.NaN)).toThrow("unsupported");
    expect(() => SortableMysqlColumnValue.encode(undefined)).toThrow("unsupported");
  });
});

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}
