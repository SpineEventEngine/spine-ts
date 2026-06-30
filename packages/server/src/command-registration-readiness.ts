import {
  HandlerMetadataRegistry,
  type CommandAssignmentHandlerMetadata,
  type EntityClass,
  type EntityHandlersMetadata,
  type HandlerMetadata,
  type HandlerMetadataRegistryLookup,
  type RegisteredHandlerMetadata,
} from "./handler-metadata.js";
import type { EntityMetadata } from "./entity-metadata.js";

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

  /** Build readiness from an already validated handler metadata registry lookup. */
  static fromRegistry(registry: HandlerMetadataRegistryLookup): CommandRegistrationReadiness {
    const commandFullTypeNames = [
      ...new Set(
        registry
          .findHandlersByKind("command-assignment")
          .map((entry) => entry.handler.messageFullTypeName),
      ),
    ].sort(compareFullTypeNames);
    const assigneesByCommandFullTypeName = new Map<string, CommandRegistrationAssigneeMetadata>();

    for (const commandFullTypeName of commandFullTypeNames) {
      const assignment = registry.findCommandAssignment(commandFullTypeName);

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

function compareFullTypeNames(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function createAssigneeMetadata(
  commandFullTypeName: string,
  registeredHandler: RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata>,
): CommandRegistrationAssigneeMetadata {
  const clonedHandlers = new Map<HandlerMetadata, HandlerMetadata>();
  const handler = cloneHandlerMetadata(registeredHandler.handler, clonedHandlers);
  const entity = cloneEntityMetadata(registeredHandler.entity);
  const entityHandlers = cloneEntityHandlers(
    registeredHandler.entityHandlers,
    clonedHandlers,
    entity,
  );
  const registeredHandlerCopy: RegisteredHandlerMetadata<CommandAssignmentHandlerMetadata> =
    Object.freeze({
      entityHandlers,
      entityType: registeredHandler.entityType,
      entity,
      handler,
    });

  return Object.freeze({
    commandFullTypeName,
    entityHandlers,
    entityType: registeredHandler.entityType,
    entity,
    handler,
    registeredHandler: registeredHandlerCopy,
  });
}

function copyAssigneeMetadata(
  assignee: CommandRegistrationAssigneeMetadata,
): CommandRegistrationAssigneeMetadata {
  return createAssigneeMetadata(assignee.commandFullTypeName, assignee.registeredHandler);
}

function cloneEntityHandlers(
  entityHandlers: EntityHandlersMetadata,
  clonedHandlers: Map<HandlerMetadata, HandlerMetadata>,
  entity: EntityMetadata,
): EntityHandlersMetadata {
  return Object.freeze({
    entityType: entityHandlers.entityType,
    entity,
    handlers: Object.freeze(
      entityHandlers.handlers.map((handler) => cloneHandlerMetadata(handler, clonedHandlers)),
    ),
    commandAssignments: Object.freeze(
      entityHandlers.commandAssignments.map((handler) =>
        cloneHandlerMetadata(handler, clonedHandlers),
      ),
    ),
    commandReactions: Object.freeze(
      entityHandlers.commandReactions.map((handler) =>
        cloneHandlerMetadata(handler, clonedHandlers),
      ),
    ),
    eventSubscriptions: Object.freeze(
      entityHandlers.eventSubscriptions.map((handler) =>
        cloneHandlerMetadata(handler, clonedHandlers),
      ),
    ),
    eventReactions: Object.freeze(
      entityHandlers.eventReactions.map((handler) => cloneHandlerMetadata(handler, clonedHandlers)),
    ),
    eventApplications: Object.freeze(
      entityHandlers.eventApplications.map((handler) =>
        cloneHandlerMetadata(handler, clonedHandlers),
      ),
    ),
  });
}

function cloneHandlerMetadata<Handler extends HandlerMetadata>(
  handler: Handler,
  clonedHandlers: Map<HandlerMetadata, HandlerMetadata>,
): Handler {
  const existing = clonedHandlers.get(handler);

  if (existing !== undefined) {
    return existing as Handler;
  }

  const clone = Object.freeze({ ...handler }) as unknown as Handler;

  clonedHandlers.set(handler, clone);
  return clone;
}

function cloneEntityMetadata(entity: EntityMetadata): EntityMetadata {
  return Object.freeze({
    ...entity,
    idField: Object.freeze({ ...entity.idField }),
    firstFieldRoutingHint: Object.freeze({
      ...entity.firstFieldRoutingHint,
      field: Object.freeze({ ...entity.firstFieldRoutingHint.field }),
    }),
    columns: Object.freeze(entity.columns.map((field) => Object.freeze({ ...field }))),
    setOnceFields: Object.freeze(entity.setOnceFields.map((field) => Object.freeze({ ...field }))),
    semanticTags: Object.freeze([...entity.semanticTags]),
  });
}
