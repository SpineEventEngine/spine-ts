/**
 * Static package metadata for the testing package while test utilities are pending.
 */
export interface PackageSkeleton {
  /** Current implementation state for this package boundary. */
  readonly implementationStatus: "skeleton";
  /** Published package name reserved for this workspace package. */
  readonly packageName: string;
}

/** Metadata-only export used by TypeDoc and bootstrap verification. */
export const packageSkeleton: PackageSkeleton = {
  implementationStatus: "skeleton",
  packageName: "@spine-ts/testing",
};
