import { clone } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";

type CloneMethod = (this: object) => unknown;

/** Clone a stored Protobuf message using generated APIs when available. */
export function cloneMessage<R extends Message>(schema: GenMessage<R>, record: R): R {
  const cloneMethod = findCloneMethod(record);

  if (cloneMethod !== undefined) {
    return Reflect.apply(cloneMethod, record, []) as R;
  }

  try {
    return clone(schema, record);
  } catch {
    throw new Error("Storage record could not be cloned.");
  }
}

/** Clone a stored value, preferring generated message clone APIs when possible. */
export function cloneValue<T>(value: T, schema?: GenMessage<Message>): T {
  const cloneMethod = findCloneMethod(value);

  if (cloneMethod !== undefined) {
    return Reflect.apply(cloneMethod, value, []) as T;
  }

  if (schema !== undefined) {
    return cloneMessage(schema, value as Message) as T;
  }

  try {
    return structuredClone(value);
  } catch {
    throw new Error("Storage value could not be cloned.");
  }
}

declare function structuredClone<T>(value: T): T;

function findCloneMethod(value: unknown): CloneMethod | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const candidate: unknown = Reflect.get(value, "clone");

  return typeof candidate === "function" ? (candidate as CloneMethod) : undefined;
}
