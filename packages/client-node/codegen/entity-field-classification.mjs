const scalarBool = 8;
const scalarBytes = 12;
const scalarInt64 = 3;
const scalarUint64 = 4;
const scalarFixed64 = 6;
const scalarSfixed64 = 16;
const scalarSint64 = 18;

/**
 * Classify a Protobuf field for Entity-column generation and registration.
 *
 * This package-owned implementation is deliberately independent of generated
 * Spine descriptors so the protoc plugin can run while those descriptors are
 * themselves being generated.
 */
export function classifyEntityField(field) {
  if (field.fieldKind === "list" || field.fieldKind === "map") {
    return { supported: false, reason: "singular" };
  }
  if (field.oneof !== undefined) {
    return { supported: false, reason: "oneof" };
  }
  if (field.fieldKind === "enum") {
    return { supported: true, valueKind: "enum", comparison: "equality" };
  }
  if (field.fieldKind === "message") {
    const messageType = field.message.typeName;
    return {
      supported: true,
      valueKind: "message",
      messageType,
      comparison:
        messageType === "google.protobuf.Timestamp" || messageType === "spine.core.Version"
          ? "ordering"
          : "equality",
    };
  }
  if (field.scalar === scalarBool) {
    return { supported: true, valueKind: "boolean", comparison: "equality" };
  }
  if (field.scalar === scalarBytes) {
    return { supported: true, valueKind: "bytes", comparison: "equality" };
  }
  if (
    field.scalar === scalarInt64 ||
    field.scalar === scalarUint64 ||
    field.scalar === scalarFixed64 ||
    field.scalar === scalarSfixed64 ||
    field.scalar === scalarSint64
  ) {
    return {
      supported: true,
      valueKind: field.longAsString ? "string" : "bigint",
      comparison: "ordering",
    };
  }
  return {
    supported: true,
    valueKind: field.scalar === 9 ? "string" : "number",
    comparison: "ordering",
  };
}
