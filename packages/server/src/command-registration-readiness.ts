import {
  HandlerMetadataRegistry,
  type CommandAssignmentHandlerMetadata,
  type EntityClass,
  type EntityHandlersMetadata,
  type HandlerMetadataRegistryLookup,
  type RegisteredHandlerMetadata,
} from "./handler-metadata.js";
import type { EntityMetadata } from "./entity-metadata.js";
import {
  compareFullTypeNames,
  copyReadinessMetadataFields,
  createReadinessMetadataFields,
} from "./registration-readiness-metadata.js";

/** Command assignment entry exposed by command registration readiness lookups. */
export interface CommandRegistrationAssigneeMetadata {
  /** Fully qualified command message type name assigned to one entity handler. */
  readonly commandFullTypeName: string;
  /** Entity handler metadata object that declared the command assignment. */
  readonly entityHandlers: EntityHandlersMetadata;
  /** Entity class that owns the assigned command handler method. */
  readonly entityType: EntityClass;
  /** Descriptor-derived entity metadata for the assignee state type. */
  readonly entity: EntityMetadata;
  /** Command assignment handler metadata declared by the entity. */
  readonly handler: CommandAssignmentHandlerMetadata;
  /** Original registered handler entry from the handler metadata registry. */
  readonly registeredHandler: RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata>;
}

/** Read-only command registration readiness lookup surface. */
export interface CommandRegistrationReadinessLookup {
  /** Return registered command message full type names in deterministic order. */
  registeredCommandMessageFullTypeNames(): readonly string[];
  /** Return the unique command assignee metadata for a command message type. */
  findCommandAssignee(commandFullTypeName: string): CommandRegistrationAssigneeMetadata | undefined;
}

/**
 * Metadata-only command registration readiness derived from handler metadata.
 *
 * The surface mirrors the JVM command-dispatcher registration shape only far
 * enough for later runtime slices to ask which command message types have one
 * registered assignee. It does not post, route, dispatch, invoke, store, or
 * acknowledge commands.
 */
export class CommandRegistrationReadiness implements CommandRegistrationReadinessLookup {
  readonly #commandFullTypeNames: readonly string[];
  readonly #assigneesByCommandFullTypeName: ReadonlyMap<
    string,
    CommandRegistrationAssigneeMetadata
  >;

  private constructor(
    commandFullTypeNames: readonly string[],
    assigneesByCommandFullTypeName: ReadonlyMap<string, CommandRegistrationAssigneeMetadata>,
  ) {
    this.#commandFullTypeNames = Object.freeze([...commandFullTypeNames]);
    this.#assigneesByCommandFullTypeName = new Map(assigneesByCommandFullTypeName);
    Object.freeze(this);
  }

  /** Build readiness from a handler metadata registry lookup. */
  static fromRegistry(registry: HandlerMetadataRegistryLookup): CommandRegistrationReadiness {
    const validatedRegistry = new HandlerMetadataRegistry(registry.listEntityHandlers());
    const commandFullTypeNames = [
      ...new Set(
        validatedRegistry
          .findHandlersByKind("command-assignment")
          .map((entry) => entry.handler.messageFullTypeName),
      ),
    ].sort(compareFullTypeNames);
    const assigneesByCommandFullTypeName = new Map<string, CommandRegistrationAssigneeMetadata>();

    for (const commandFullTypeName of commandFullTypeNames) {
      const assignment = validatedRegistry.findCommandAssignment(commandFullTypeName);

      if (assignment !== undefined) {
        assigneesByCommandFullTypeName.set(
          commandFullTypeName,
          createAssigneeMetadata(commandFullTypeName, assignment),
        );
      }
    }

    return new CommandRegistrationReadiness(
      [...assigneesByCommandFullTypeName.keys()].sort(compareFullTypeNames),
      assigneesByCommandFullTypeName,
    );
  }

  /**
   * Build readiness from entity handler metadata.
   *
   * Duplicate command assignment validation is intentionally delegated to
   * `HandlerMetadataRegistry`.
   */
  static fromEntityHandlers(
    entityHandlers: Iterable<EntityHandlersMetadata>,
  ): CommandRegistrationReadiness {
    return CommandRegistrationReadiness.fromRegistry(new HandlerMetadataRegistry(entityHandlers));
  }

  /** Return registered command message full type names in deterministic order. */
  registeredCommandMessageFullTypeNames(): readonly string[] {
    return Object.freeze([...this.#commandFullTypeNames]);
  }

  /** Return the unique command assignee metadata for a command message type. */
  findCommandAssignee(
    commandFullTypeName: string,
  ): CommandRegistrationAssigneeMetadata | undefined {
    const assignee = this.#assigneesByCommandFullTypeName.get(commandFullTypeName);

    return assignee === undefined ? undefined : copyAssigneeMetadata(assignee);
  }
}

function createAssigneeMetadata(
  commandFullTypeName: string,
  registeredHandler: RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata>,
): CommandRegistrationAssigneeMetadata {
  const fields = createReadinessMetadataFields(registeredHandler);

  return Object.freeze({
    commandFullTypeName,
    ...fields,
  });
}

function copyAssigneeMetadata(
  assignee: CommandRegistrationAssigneeMetadata,
): CommandRegistrationAssigneeMetadata {
  const fields = copyReadinessMetadataFields(assignee.registeredHandler);

  return Object.freeze({
    commandFullTypeName: assignee.commandFullTypeName,
    ...fields,
  });
}
