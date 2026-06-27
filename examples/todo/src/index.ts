/**
 * Static package metadata for the to-do example while the domain is pending.
 */
export interface ExampleSkeleton {
  /** Current implementation state for this example boundary. */
  readonly implementationStatus: "skeleton";
  /** Published package name reserved for this workspace example. */
  readonly packageName: string;
}

/** Metadata-only export used by TypeDoc and bootstrap verification. */
export const exampleSkeleton: ExampleSkeleton = {
  implementationStatus: "skeleton",
  packageName: "@spine-ts/example-todo",
};
