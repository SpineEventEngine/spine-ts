import type { MessageShape } from "@bufbuild/protobuf";
import type { MessageSchema } from "@spine-event-engine/core";
import type { CommandContext } from "@spine-event-engine/proto";

/**
 * Calculates one Entity ID for a Command message.
 *
 * @typeParam Id Entity ID type owned by the receiving repository.
 * @typeParam Schema Generated Command message schema.
 */
export type CommandRoute<Id, Schema extends MessageSchema = MessageSchema> = (
  message: MessageShape<Schema>,
  context: CommandContext,
) => Id;

/**
 * Mutable Command route declarations that repositories snapshot at construction.
 *
 * @typeParam Id Entity ID type owned by the receiving repository.
 */
export class CommandRouting<Id> {
  readonly #exact = new Map<MessageSchema, CommandRoute<Id>>();
  readonly #semantic = new Map<string, CommandRoute<Id>>();
  #default: CommandRoute<Id> | undefined;

  /**
   * Creates empty Command route declarations.
   *
   * @typeParam Id Entity ID type owned by the receiving repository.
   * @returns Mutable Command route declarations.
   */
  static create<Id>(): CommandRouting<Id> {
    return new CommandRouting<Id>();
  }

  /**
   * Registers an exact generated Command schema route.
   *
   * @param schema Generated Command message schema.
   * @param via Route that calculates the target Entity ID.
   * @returns These mutable route declarations.
   */
  route<Schema extends MessageSchema>(schema: Schema, via: CommandRoute<Id, Schema>): this {
    if (typeof via !== "function") throw new TypeError("Command routing requires a route function.");
    if (this.#exact.has(schema)) throw new Error("Command routing has a duplicate exact command route.");
    this.#exact.set(schema, via as CommandRoute<Id>);
    return this;
  }

  /**
   * Registers a descriptor semantic Command route.
   *
   * @param javaType Descriptor `(is)` or `(every_is)` Java type.
   * @param via Route that calculates the target Entity ID.
   * @returns These mutable route declarations.
   */
  routeSemantic(javaType: string, via: CommandRoute<Id>): this {
    if (typeof javaType !== "string" || javaType.trim().length === 0)
      throw new TypeError("Command semantic routing requires a non-empty Java type.");
    if (typeof via !== "function") throw new TypeError("Command routing requires a route function.");
    if (this.#semantic.has(javaType)) throw new Error("Command routing has a duplicate semantic command route.");
    this.#semantic.set(javaType, via);
    return this;
  }

  /**
   * Replaces the declaration-first default Command route.
   *
   * @param via Route that calculates the target Entity ID.
   * @returns These mutable route declarations.
   */
  replaceDefault(via: CommandRoute<Id>): this {
    if (typeof via !== "function") throw new TypeError("Command routing requires a route function.");
    this.#default = via;
    return this;
  }
}
