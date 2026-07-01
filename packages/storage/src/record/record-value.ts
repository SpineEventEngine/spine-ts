/** Build a deterministic key for one stored ID or column value. */
export function valueKey(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

/** Compare two stored values deterministically. */
export function valueCompare(left: unknown, right: unknown): number {
  const leftKey = valueKey(left);
  const rightKey = valueKey(right);

  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

/** Read a dotted path from a record value. */
export function readPath(value: unknown, path: string): unknown {
  let current = value;

  for (const segment of path.split(".").filter((part) => part.length > 0)) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }

    current = Reflect.get(current, segment);
  }

  return current;
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return { bigint: value.toString() };
  }

  if (value instanceof Uint8Array) {
    return { bytes: [...value] };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = normalizeValue(Reflect.get(value, key));
      return result;
    }, {});
}
