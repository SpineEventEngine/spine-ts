import type { DescField } from "@bufbuild/protobuf";

export type EntityFieldClassification =
  | Readonly<{ supported: false; reason: "singular" | "oneof" }>
  | Readonly<{
      supported: true;
      valueKind: "bigint" | "boolean" | "bytes" | "enum" | "message" | "number" | "string";
      messageType?: string;
      comparison: "equality" | "ordering";
    }>;

/** Classifies Protobuf descriptors used by the Entity-column generator. */
export declare const EntityFieldClassification: Readonly<{
  /** Classifies one Protobuf field descriptor.
   *
   * @param field - Field descriptor supplied by the generator.
   * @returns The Entity-column classification.
   */
  classify(field: DescField): EntityFieldClassification;
}>;
