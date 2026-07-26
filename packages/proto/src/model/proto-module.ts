import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";

/** A package-owned contribution of generated Protobuf schemas and direct dependencies. */
export interface ProtoModule {
  /** Stable package or model-module name. */
  readonly name: string;
  /** Generated Protobuf message schemas owned by this module. */
  readonly schemas: readonly GenMessage<Message>[];
  /** Direct module dependencies required by this module's generated schemas. */
  readonly dependencies: readonly ProtoModule[];
}
