import type { DescField } from "@bufbuild/protobuf";

export type ProjectionFieldClassification =
  | Readonly<{ supported: false; reason: "singular" | "oneof" }>
  | Readonly<{
      supported: true;
      valueKind: "bigint" | "boolean" | "bytes" | "enum" | "message" | "number" | "string";
      messageType?: string;
      comparison: "equality" | "ordering";
    }>;

export function classifyProjectionField(field: DescField): ProjectionFieldClassification;
