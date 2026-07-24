import type { DescField } from "@bufbuild/protobuf";

export type EntityFieldClassification =
  | Readonly<{ supported: false; reason: "singular" | "oneof" }>
  | Readonly<{
      supported: true;
      valueKind: "bigint" | "boolean" | "bytes" | "enum" | "message" | "number" | "string";
      messageType?: string;
      comparison: "equality" | "ordering";
    }>;

export function classifyEntityField(field: DescField): EntityFieldClassification;
