export type RecordMask = readonly string[];

interface MaskNode {
  readonly children: Map<string, MaskNode>;
}

export const RecordMask: Readonly<RecordMaskApi> = Object.freeze({
  /** Apply a simple field mask to a cloned record. */
  apply<R>(record: R, mask: RecordMask | undefined): R {
    if (mask === undefined || mask.length === 0) {
      return record;
    }

    const root = createMaskTree(mask);
    prune(record, root);
    return record;
  },
});

interface RecordMaskApi {
  apply<R>(record: R, mask: RecordMask | undefined): R;
}

function createMaskTree(mask: RecordMask): MaskNode {
  const root = createNode();

  for (const path of mask) {
    if (path.trim().length === 0) {
      continue;
    }

    let node = root;

    for (const segment of path.split(".").filter((part) => part.length > 0)) {
      let next = node.children.get(segment);

      if (next === undefined) {
        next = createNode();
        node.children.set(segment, next);
      }

      node = next;
    }
  }

  return root;
}

function createNode(): MaskNode {
  return { children: new Map<string, MaskNode>() };
}

function prune(value: unknown, node: MaskNode): void {
  if (typeof value !== "object" || value === null || node.children.size === 0) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      prune(item, node);
    }
    return;
  }

  for (const key of Object.keys(value)) {
    const child = node.children.get(key);

    if (child === undefined) {
      Reflect.deleteProperty(value, key);
      continue;
    }

    prune(Reflect.get(value, key), child);
  }
}
