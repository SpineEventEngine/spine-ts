import type { FileDescriptorSet } from "@bufbuild/protobuf/wkt";

export function normalizeDescriptorSet(descriptorSet: FileDescriptorSet): Uint8Array;
export function compareNormalizedDescriptorSets(
  expected: FileDescriptorSet,
  actual: FileDescriptorSet,
): { readonly equal: boolean };
export function normalizedDescriptorDigest(descriptorSet: FileDescriptorSet): string;
export function buildDescriptorSet(root?: string): FileDescriptorSet;
export function verifyFrozenDescriptorCompatibility(root?: string): {
  readonly actualDigest: string;
  readonly fileCount: number;
};
