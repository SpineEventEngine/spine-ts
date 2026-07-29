/** Represents dotted record paths retained by a masked read. */
export type RecordMask = readonly string[];

interface MaskNode {
  readonly children: Map<string, MaskNode>;
}

/** Provides record-mask operations. */
export const RecordMask: Readonly<{
  apply<R>(record: R, mask: RecordMask | undefined): R;
}> = Object.freeze({
  /** Applies a simple field mask to a cloned record.
   * @param record The cloned record to prune.
   * @param mask The paths to retain.
   * @returns The pruned record.
   */
  apply<R>(record: R, mask: RecordMask | undefined): R {
    if (mask === undefined || mask.length === 0) {
      return record;
    }

    const root = MaskTree.create(mask);
    MaskTree.prune(record, root);
    return record;
  },
});

/** Builds and applies the tree used by one record-mask operation. */
const MaskTree = Object.freeze({
  create(mask: RecordMask): MaskNode {
    const root = this.node();

    for (const path of mask) {
      if (path.trim().length === 0) {
        continue;
      }

      let node = root;

      for (const segment of path.split(".").filter((part) => part.length > 0)) {
        let next = node.children.get(segment);

        if (next === undefined) {
          next = this.node();
          node.children.set(segment, next);
        }

        node = next;
      }
    }

    return root;
  },

  node(): MaskNode {
    return { children: new Map<string, MaskNode>() };
  },

  prune(value: unknown, node: MaskNode): void {
    if (typeof value !== "object" || value === null || node.children.size === 0) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        this.prune(item, node);
      }
      return;
    }

    for (const key of Object.keys(value)) {
      if (key === "$typeName") {
        continue;
      }
      const child = node.children.get(key);

      if (child === undefined) {
        Reflect.deleteProperty(value, key);
        continue;
      }

      this.prune(Reflect.get(value, key), child);
    }
  },
});
