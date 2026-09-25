/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";

import type * as Protobuf from "@bufbuild/protobuf";
import type * as ProtobufWkt from "@bufbuild/protobuf/wkt";
import ts from "typescript";

type GeneratedHandlerKind =
  | "command-assignment"
  | "command-substitution"
  | "command-reaction"
  | "event-subscription"
  | "state-subscription"
  | "event-reaction";
type GeneratedHandlerParameterCount = 1 | 2;

/**
 * Build-time analysis result for bare decorated receiver handler methods.
 */
export interface BuildHandlerAnalysis {
  // prettier-ignore

  /**
   * All generated Entity and standalone receiver declarations.
   */
  readonly receivers: readonly BuildReceiverHandlers[];

  /**
   * Deterministic diagnostics for unsupported handler declarations.
   */
  readonly diagnostics: readonly BuildHandlerDiagnostic[];
}

/**
 * Build-time entity group shaped for later generated registry rendering.
 */
export interface BuildEntityHandlers {
  // prettier-ignore

  /**
   * Entity class declaration name.
   */
  readonly className: string;

  /**
   * Whether the class is imported from a default export.
   */
  readonly defaultExport?: boolean;

  /**
   * Marks this declaration as an Entity receiver.
   */
  readonly receiverKind: "entity";

  /**
   * Source file where the entity class is declared.
   */
  readonly sourceFile: string;

  /**
   * Importable generated schema reference for entity state.
   */
  readonly stateSchema: SchemaReference;

  /**
   * Analyzed bare-decorator handler records.
   */
  readonly handlers: readonly BuildHandlerRecord[];
}

/**
 * Build-time standalone receiver declaration.
 */
export interface BuildStandaloneHandlers {
  // prettier-ignore

  /**
   * Marks this declaration as a standalone receiver.
   */
  readonly receiverKind: "standalone";

  /**
   * Standalone receiver class declaration name.
   */
  readonly className: string;

  /**
   * Indicates that the receiver class is a default export.
   */
  readonly defaultExport?: boolean;

  /**
   * Source file that declares the standalone receiver class.
   */
  readonly sourceFile: string;

  /**
   * Analyzed decorated handler records in declaration order.
   */
  readonly handlers: readonly BuildHandlerRecord[];
}

/**
 * One generated receiver declaration.
 */
export type BuildReceiverHandlers = BuildEntityHandlers | BuildStandaloneHandlers;

/**
 * Importable generated schema reference used by later source rendering.
 */
export interface SchemaReference {
  // prettier-ignore

  /**
   * Module specifier exactly as declared by analyzed source.
   */
  readonly moduleSpecifier: string;

  /**
   * Generated schema export name in that module.
   */
  readonly exportName: string;
}

/**
 * Build-time handler record before generated source rendering.
 */
export interface BuildHandlerRecord {
  // prettier-ignore

  /**
   * Handler role inferred from the bare decorator.
   */
  readonly kind: GeneratedHandlerKind;

  /**
   * String method name selected by the generated metadata.
   */
  readonly methodName: string;

  /**
   * Generated schema accepted by the first handler parameter.
   */
  readonly input: BuildHandlerInput;

  /**
   * Generated schemas returned normally or declared as thrown rejections.
   */
  readonly outcomes: BuildHandlerOutcomes;

  /**
   * Public method arity: `handler(signal)` or `handler(signal, context)`.
   */
  readonly parameterCount: GeneratedHandlerParameterCount;
}

/**
 * Input metadata for one generated handler.
 */
export interface BuildHandlerInput {
  // prettier-ignore

  /**
   * Generated schema accepted by the handler.
   */
  readonly schema: SchemaReference;

  /**
   * Origin required for an Event input.
   */
  readonly origin: "domestic" | "external";

  /**
   * Optional generated Event field filter.
   */
  readonly where?: BuildWhereOptions;
}

/**
 * Normal and declared rejection outcomes for one generated handler.
 */
export interface BuildHandlerOutcomes {
  // prettier-ignore

  /**
   * Generated schemas returned normally by the handler.
   */
  readonly returned: readonly SchemaReference[];

  /**
   * Generated rejection schemas that the handler may throw.
   */
  readonly thrown: readonly SchemaReference[];
}

/**
 * Build-time representation of one `@Where` declaration.
 */
export interface BuildWhereOptions {
  // prettier-ignore

  /**
   * Proto source-name path selected by the declaration.
   */
  readonly eventField: string;

  /**
   * Declared field value in Stringifier text form.
   */
  readonly equals: string;
}

interface AnalyzedMethodInput {
  readonly node: ts.MethodDeclaration;
  readonly handler: HandlerDecoratorUse;
  readonly whereUses: readonly DecoratorUse[];
  readonly throwsUses: readonly DecoratorUse[];
  readonly className: string;
  readonly scope: AnalyzerScope;
  readonly method: string | undefined;
}

/**
 * Stable diagnostic codes emitted by build-time handler analysis.
 */
export type BuildHandlerDiagnosticCode =
  | "APPLY_DECORATOR"
  | "FRAMEWORK_ENVELOPE_RETURN"
  | "INVALID_EMITTED_SCHEMA"
  | "INVALID_HANDLER_NAME"
  | "INVALID_HANDLER_CONTEXT"
  | "INVALID_HANDLER_VISIBILITY"
  | "INVALID_PARAMETER_COUNT"
  | "INVALID_SIGNAL_TYPE"
  | "INVALID_EXTERNAL_ORIGIN"
  | "EXTERNAL_COMMAND_RECEIVER"
  | "INVALID_SUBSCRIBE_RETURN"
  | "INVALID_THROWS"
  | "INVALID_WHERE"
  | "MISSING_EMITTED_SCHEMAS"
  | "MISSING_ENTITY_STATE_SCHEMA"
  | "MISSING_RETURN_TYPE"
  | "MISSING_SIGNAL_TYPE"
  | "NON_EXPORTED_RECEIVER_CLASS"
  | "SCHEMA_BEARING_DECORATOR"
  | "TYPESCRIPT_SYNTAX_ERROR"
  | "UNSUPPORTED_ASSIGN_HANDLER"
  | "UNSUPPORTED_COMMAND_HANDLER"
  | "UNSUPPORTED_RETURN_TYPE";

/**
 * One build-time analyzer diagnostic.
 */
export interface BuildHandlerDiagnostic {
  // prettier-ignore

  /**
   * Stable machine-readable diagnostic code.
   */
  readonly code: BuildHandlerDiagnosticCode;

  /**
   * Source file where the diagnostic was found.
   */
  readonly sourceFile: string;

  /**
   * One-based source line.
   */
  readonly line: number;

  /**
   * One-based source column.
   */
  readonly column: number;

  /**
   * Human-readable diagnostic message.
   */
  readonly message: string;

  /**
   * Entity class name when available.
   */
  readonly className?: string;

  /**
   * Handler method name when available.
   */
  readonly methodName?: string;
}

/**
 * Inspects configured TypeScript source files for bare Spine handler decorators.
 */
export interface BuildHandlerAnalyzer {
  // prettier-ignore

  /**
   * Inspects source files and returns receiver handler records with deterministic diagnostics.
   *
   * @param program TypeScript program that owns the source files and diagnostics.
   * @param sourceFiles Application source files to inspect; defaults to program files.
   * @returns Receiver handler records and deterministic diagnostics.
   */
  analyze(program: ts.Program, sourceFiles?: readonly ts.SourceFile[]): BuildHandlerAnalysis;
}

/**
 * Provides build-time analysis for bare Spine handler decorators.
 */
export const BuildHandlerAnalyzer: BuildHandlerAnalyzer = Object.freeze({
  // prettier-ignore

  /**
   * Inspects source files and returns receiver handler records with deterministic diagnostics.
   *
   * @param program TypeScript program that owns the source files and diagnostics.
   * @param sourceFiles Application source files to inspect; defaults to program files.
   * @returns Receiver handler records and deterministic diagnostics.
   */
  analyze(
    program: ts.Program,
    sourceFiles: readonly ts.SourceFile[] = HandlerSources.appSourceFiles(program),
  ): BuildHandlerAnalysis {
    PackageDependencies.load(program);
    const receivers: BuildReceiverHandlers[] = [];
    const diagnostics: BuildHandlerDiagnostic[] = [];

    for (const source of sourceFiles) {
      const syntaxDiagnostics = program.getSyntacticDiagnostics(source);
      if (syntaxDiagnostics.length > 0) {
        diagnostics.push(
          ...syntaxDiagnostics.map((diagnostic) =>
            HandlerTypes.syntaxDiagnostic(source, diagnostic),
          ),
        );
        continue;
      }

      const scope = {
        program,
        source,
        imports: HandlerSources.buildImportState(source, program),
        diagnostics,
      };
      const sourceReceivers = HandlerSources.analyzeSource(scope);
      receivers.push(...sourceReceivers);
    }

    return { receivers, diagnostics };
  },
});

interface AnalyzerScope {
  readonly program: ts.Program;
  readonly source: ts.SourceFile;
  readonly imports: ImportState;
  readonly diagnostics: BuildHandlerDiagnostic[];
}

type ReceiverLineage =
  | {
      readonly receiverKind: "entity";
      readonly base: string;
      readonly stateSchema: SchemaReference | undefined;
    }
  | {
      readonly receiverKind: "standalone";
      readonly base: string;
      readonly stateSchema: undefined;
    };

interface ImportState {
  readonly generatedNamespaces: ReadonlyMap<string, GeneratedNamespace>;
  readonly generatedSymbols: ReadonlyMap<string, GeneratedSymbol>;
  readonly rejectionNamespaces: ReadonlyMap<string, RejectionNamespace>;
  readonly rejectionSymbols: ReadonlyMap<string, SchemaReference>;
  readonly localTypeAliases: ReadonlyMap<string, ts.TypeNode>;
  readonly serverNamespaces: ReadonlySet<string>;
  readonly serverSymbols: ReadonlyMap<string, string>;
  readonly protoNamespaces: ReadonlySet<string>;
  readonly protoSymbols: ReadonlySet<string>;
  readonly protoContextSymbols: ReadonlyMap<string, "CommandContext" | "EventContext">;
}

interface MutableImportState {
  readonly generatedNamespaces: Map<string, GeneratedNamespace>;
  readonly generatedSymbols: Map<string, GeneratedSymbol>;
  readonly rejectionNamespaces: Map<string, RejectionNamespace>;
  readonly rejectionSymbols: Map<string, SchemaReference>;
  readonly localTypeAliases: Map<string, ts.TypeNode>;
  readonly serverNamespaces: Set<string>;
  readonly serverSymbols: Map<string, string>;
  readonly protoNamespaces: Set<string>;
  readonly protoSymbols: Set<string>;
  readonly protoContextSymbols: Map<string, "CommandContext" | "EventContext">;
}

interface GeneratedNamespace {
  readonly exports: GeneratedExports;
  readonly moduleSpecifier: string;
}

interface RejectionNamespace {
  readonly exports: GeneratedExports;
  readonly moduleSpecifier: string;
}

interface GeneratedSymbol extends GeneratedNamespace {
  readonly exportName: string;
  readonly kind: SignalKind | undefined;
  readonly schemaExportName: string | undefined;
  readonly schemaValue: boolean;
}

interface SchemaUse {
  readonly kind: SignalKind | undefined;
  readonly reference: SchemaReference;
}

interface GeneratedExports {
  readonly types: Set<string>;
  readonly values: Set<string>;
  readonly schemaRoles: Map<string, SignalKind | undefined>;
}

interface GeneratedFile {
  readonly sourceFile: string;
  readonly messages: readonly DescriptorMessage[];
}

interface DescriptorMessage {
  readonly name: string;
  readonly isEntityState: boolean;
  readonly nested: readonly DescriptorMessage[];
}

interface DescriptorMessageSelection {
  readonly descriptor: DescriptorMessage;
  readonly exportName: string;
}

interface TypeWalk {
  remaining: number;
  readonly seen: Set<string>;
}

type HandlerDecorator = "Assign" | "Command" | "React" | "Subscribe";
type ServerDecorator = HandlerDecorator | "Apply" | "Where" | "Throws";
type SignalKind = "command" | "event" | "rejection" | "state";

interface DecoratorUse {
  readonly hasArguments: boolean;
  readonly name: ServerDecorator;
  readonly node: ts.Decorator;
}

interface HandlerDecoratorUse extends DecoratorUse {
  readonly name: HandlerDecorator;
}

const handlerDecorators = new Set<HandlerDecorator>(["Assign", "Command", "React", "Subscribe"]);
const entityBaseNames = new Set(["Aggregate", "Projection", "ProcessManager"]);
const standaloneBaseNames = new Set([
  "AbstractAssignee",
  "AbstractCommander",
  "AbstractEventReactor",
  "AbstractEventSubscriber",
]);
const maxAliasDepth = 50;
// `spine.options.entity` in the frozen `spine/options.proto` contract.
const entityOptionFieldNumber = 73903;
let packageDependencies:
  { readonly protobuf: typeof Protobuf; readonly protobufWkt: typeof ProtobufWkt } | undefined;

const HandlerSources = Object.freeze({
  /**
   * Gets non-declaration source files from the program.
   *
   * @param program The TypeScript program supplying source files and type information.
   * @returns The program's source files, excluding declaration files.
   */
  appSourceFiles(program: ts.Program): readonly ts.SourceFile[] {
    return program.getSourceFiles().filter((source) => !source.isDeclarationFile);
  },

  /**
   * Collects supported receiver classes declared in one source file.
   *
   * @param scope The current source, imports, program, and diagnostic collection.
   * @returns The receiver records found in the source file.
   */
  analyzeSource(scope: AnalyzerScope): readonly BuildReceiverHandlers[] {
    const receivers: BuildReceiverHandlers[] = [];

    for (const statement of scope.source.statements) {
      if (
        !ts.isClassDeclaration(statement) ||
        (statement.name === undefined &&
          !HandlerTypes.hasModifier(statement, ts.SyntaxKind.DefaultKeyword))
      ) {
        continue;
      }

      const receiver = HandlerSources.analyzeClass(statement, scope);
      if (receiver !== undefined) {
        receivers.push(receiver);
      }
    }

    return receivers;
  },

  /**
   * Validates a decorated class and assembles its receiver record.
   *
   * @param node The syntax node being inspected.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @returns The receiver record, or undefined when the class is ineligible.
   */
  analyzeClass(node: ts.ClassDeclaration, scope: AnalyzerScope): BuildReceiverHandlers | undefined {
    const className = node.name?.text ?? "DefaultReceiver";
    const exportIssue = HandlerSources.receiverExportIssue(node, scope.source);
    if (HandlerSources.hasDecoratedMethod(node, scope.imports) && exportIssue !== undefined) {
      HandlerTypes.pushDiagnostic(
        scope,
        exportIssue.code,
        node.name ?? node,
        exportIssue.message,
        className,
      );
      return undefined;
    }
    const lineage = HandlerSources.receiverLineage(node, scope);
    const handlers = HandlerSources.analyzeMethods(node, className, lineage, scope);
    if (lineage === undefined || handlers.length === 0) {
      return undefined;
    }
    return HandlerSources.receiverRecord(node, className, lineage, handlers, scope.source.fileName);
  },

  /**
   * Collects valid decorated handler methods from a class.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param lineage The resolved receiver base and state schema, when available.
   * @param node The syntax node being inspected.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @returns The valid handler records found in the class.
   */
  analyzeMethods(
    node: ts.ClassDeclaration,
    className: string,
    lineage: ReceiverLineage | undefined,
    scope: AnalyzerScope,
  ): readonly BuildHandlerRecord[] {
    const handlers: BuildHandlerRecord[] = [];
    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const handler = HandlerSources.analyzeMethod(
        member,
        className,
        lineage?.base,
        lineage?.stateSchema,
        lineage?.receiverKind,
        scope,
      );
      if (handler !== undefined) handlers.push(handler);
    }
    return handlers;
  },

  /**
   * Builds the entity or standalone receiver record from its lineage and handlers.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param handlers The validated handlers found on the receiver.
   * @param lineage The resolved receiver base and state schema, when available.
   * @param node The syntax node being inspected.
   * @param sourceFile The receiver source path.
   * @returns The receiver record, or undefined when entity state is unresolved.
   */
  receiverRecord(
    node: ts.ClassDeclaration,
    className: string,
    lineage: ReceiverLineage,
    handlers: readonly BuildHandlerRecord[],
    sourceFile: string,
  ): BuildReceiverHandlers | undefined {
    return lineage.receiverKind === "entity"
      ? lineage.stateSchema === undefined
        ? undefined
        : {
            receiverKind: "entity",
            className,
            ...(HandlerTypes.hasModifier(node, ts.SyntaxKind.DefaultKeyword)
              ? { defaultExport: true }
              : {}),
            sourceFile,
            stateSchema: lineage.stateSchema,
            handlers,
          }
      : {
          receiverKind: "standalone",
          className,
          ...(HandlerTypes.hasModifier(node, ts.SyntaxKind.DefaultKeyword)
            ? { defaultExport: true }
            : {}),
          sourceFile,
          handlers,
        };
  },

  /**
   * Finds a handler decorator and validates one method.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param entityBase The resolved entity base class, when present.
   * @param node The syntax node being inspected.
   * @param receiverKind The resolved entity or standalone receiver kind, when present.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @param stateSchema The resolved entity state schema, when present.
   * @returns The handler record, or undefined when validation fails.
   */
  analyzeMethod(
    node: ts.MethodDeclaration,
    className: string,
    entityBase: string | undefined,
    stateSchema: SchemaReference | undefined,
    receiverKind: "entity" | "standalone" | undefined,
    scope: AnalyzerScope,
  ): BuildHandlerRecord | undefined {
    const decorators = HandlerSources.methodDecorators(node, scope.imports);
    const apply = decorators.find((decorator) => decorator.name === "Apply");
    const handler = decorators.find(HandlerSources.isHandlerUse);
    const whereUses = decorators.filter((decorator) => decorator.name === "Where");
    const throwsUses = decorators.filter((decorator) => decorator.name === "Throws");
    const method = HandlerTypes.methodName(node);
    const use = {
      node,
      apply,
      handler,
      whereUses,
      throwsUses,
      className,
      entityBase,
      stateSchema,
      receiverKind,
      scope,
      method,
    };
    if (!HandlerSources.validMethodUse(use)) return undefined;
    return HandlerSources.analyzeValidMethod(use);
  },

  /**
   * Resolves a validated method's input, context, outcomes, and declarations.
   *
   * @param input The collected method or validation input.
   * @returns The handler record, or undefined when a declaration is invalid.
   */
  analyzeValidMethod(input: AnalyzedMethodInput): BuildHandlerRecord | undefined {
    const { className, handler, method, node, scope } = input;
    const parameters = node.parameters;
    const origin = HandlerSources.externalOrigin(parameters, scope, className, method);
    if (origin === undefined) return undefined;
    const schemas = HandlerSources.methodSchemaUses(node, handler, origin.type, scope);
    if (schemas === undefined || method === undefined) return undefined;
    const { signal, returnedSchemas } = schemas;
    if (!HandlerSources.validContextParameter(parameters, signal.kind, scope, className, method))
      return undefined;
    const declarations = HandlerSources.methodDeclarations(input, signal.kind, method);
    if (declarations === undefined) return undefined;
    return HandlerSources.buildHandlerRecord(
      node,
      handler,
      signal,
      method,
      returnedSchemas,
      declarations.thrown,
      origin.value,
      declarations.where,
    );
  },

  /**
   * Validates the Where and Throws declarations attached to a handler.
   *
   * @param input The collected method or validation input.
   * @param methodName The handler method name used in diagnostics.
   * @param signalKind The resolved input signal kind.
   * @returns The validated filter and rejection schemas, or undefined on failure.
   */
  methodDeclarations(
    input: AnalyzedMethodInput,
    signalKind: SignalKind | undefined,
    methodName: string,
  ):
    | { readonly where: BuildWhereOptions | undefined; readonly thrown: readonly SchemaReference[] }
    | undefined {
    const { className, handler, scope, throwsUses, whereUses } = input;
    const where = HandlerSources.whereDeclaration(
      whereUses,
      handler,
      signalKind,
      scope,
      className,
      methodName,
    );
    if (whereUses.length > 0 && where === undefined) return undefined;
    const thrown = HandlerSources.throwsDeclaration(
      throwsUses,
      handler,
      signalKind,
      scope,
      className,
      methodName,
    );
    return throwsUses.length > 0 && thrown === undefined
      ? undefined
      : { where, thrown: thrown ?? [] };
  },

  /**
   * Resolves the input signal and emitted message schemas of a handler.
   *
   * @param handler The recognized handler decorator.
   * @param node The syntax node being inspected.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @param signalType The handler's declared input type.
   * @returns The input and output schemas, or undefined when resolution fails.
   */
  methodSchemaUses(
    node: ts.MethodDeclaration,
    handler: HandlerDecoratorUse,
    signalType: ts.TypeNode,
    scope: AnalyzerScope,
  ):
    | { readonly signal: SchemaUse; readonly returnedSchemas: readonly SchemaReference[] }
    | undefined {
    const signal = HandlerSources.schemaUseFromType(signalType, scope.imports);
    const returned = HandlerSources.emittedSchemaUses(
      node.type === undefined ? undefined : HandlerSources.unwrapOuterPromise(node.type, scope),
      handler.name,
      scope,
    );
    return signal === undefined || returned === undefined
      ? undefined
      : { signal, returnedSchemas: returned.map((schema) => schema.reference) };
  },

  /**
   * Builds the generated handler record from resolved method metadata.
   *
   * @param handler The recognized handler decorator.
   * @param method The handler method name.
   * @param node The syntax node being inspected.
   * @param origin Whether the input is domestic or external.
   * @param returnedSchemas The generated schemas emitted by the handler.
   * @param signal The resolved input schema and signal kind.
   * @param thrownSchemas The rejection schemas declared by the handler.
   * @param where The validated event filter, when declared.
   * @returns The generated handler record.
   */
  buildHandlerRecord(
    node: ts.MethodDeclaration,
    handler: HandlerDecoratorUse,
    signal: SchemaUse,
    method: string,
    returnedSchemas: readonly SchemaReference[],
    thrownSchemas: readonly SchemaReference[],
    origin: "domestic" | "external",
    where: BuildWhereOptions | undefined,
  ): BuildHandlerRecord {
    return {
      kind: HandlerSources.handlerKind(handler.name, signal.kind),
      methodName: method,
      input: { schema: signal.reference, origin, ...(where === undefined ? {} : { where }) },
      outcomes: { returned: returnedSchemas, thrown: thrownSchemas },
      parameterCount: node.parameters.length as GeneratedHandlerParameterCount,
    };
  },

  /**
   * Rejects unsupported decorator combinations and receiver placements.
   *
   * @param input The collected method or validation input.
   * @returns Whether the decorator combination and receiver placement are valid.
   */
  validMethodUse(input: {
    readonly node: ts.MethodDeclaration;
    readonly apply: DecoratorUse | undefined;
    readonly handler: HandlerDecoratorUse | undefined;
    readonly whereUses: readonly DecoratorUse[];
    readonly throwsUses: readonly DecoratorUse[];
    readonly className: string;
    readonly entityBase: string | undefined;
    readonly stateSchema: SchemaReference | undefined;
    readonly receiverKind: "entity" | "standalone" | undefined;
    readonly scope: AnalyzerScope;
    readonly method: string | undefined;
  }): input is typeof input & { readonly handler: HandlerDecoratorUse } {
    HandlerSources.reportUnsupportedApply(input);
    if (input.handler === undefined) return HandlerSources.reportMissingHandler(input);
    const { className, handler, method, node, scope } = input;
    if (!HandlerSources.validHandlerKind({ ...input, handler })) return false;
    if (!HandlerSources.validBareHandlerDecorator(handler, scope, className, method)) return false;
    return !HandlerSources.validateHandlerNode(
      node,
      handler.name,
      input.receiverKind === "entity" ? input.stateSchema : undefined,
      input.receiverKind !== "standalone",
      scope,
      className,
      method,
    );
  },

  /**
   * Resolves declared rejection schemas for a handler.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param handler The recognized handler decorator.
   * @param methodName The handler method name used in diagnostics.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @param signalKind The resolved input signal kind.
   * @param uses The decorator uses under inspection.
   * @returns The declared rejection schemas, or undefined on failure.
   */
  throwsDeclaration(
    uses: readonly DecoratorUse[],
    handler: HandlerDecoratorUse,
    signalKind: SignalKind | undefined,
    scope: AnalyzerScope,
    className: string,
    methodName: string,
  ): readonly SchemaReference[] | undefined {
    if (uses.length === 0) return [];
    const expression = HandlerSources.throwsCall(
      uses,
      handler,
      signalKind,
      scope,
      className,
      methodName,
    );
    if (expression === undefined) return undefined;
    return HandlerSources.thrownSchemas(expression, scope, className, methodName);
  },

  /**
   * Reads rejection schema references from a Throws decorator call.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param handler The recognized handler decorator.
   * @param methodName The handler method name used in diagnostics.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @param signalKind The resolved input signal kind.
   * @param uses The decorator uses under inspection.
   * @returns The schema expressions in the decorator call, or undefined when invalid.
   */
  throwsCall(
    uses: readonly DecoratorUse[],
    handler: HandlerDecoratorUse,
    signalKind: SignalKind | undefined,
    scope: AnalyzerScope,
    className: string,
    methodName: string,
  ): ts.CallExpression | undefined {
    const use = uses[0];
    const commandReceptor =
      handler.name === "Assign" || (handler.name === "Command" && signalKind === "command");
    if (uses.length !== 1 || !commandReceptor || use === undefined) {
      HandlerSources.invalidThrows(
        scope,
        use?.node ?? handler.node,
        "@Throws is allowed once on a command-accepting @Assign or @Command handler.",
        className,
        methodName,
      );
      return undefined;
    }
    const expression = use.node.expression;
    if (ts.isCallExpression(expression) && expression.arguments.length > 0) return expression;
    HandlerSources.invalidThrows(
      scope,
      use.node,
      "@Throws requires at least one generated rejection companion.",
      className,
      methodName,
    );
    return undefined;
  },

  /**
   * Resolves rejection schemas named by a Throws declaration.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param expression The expression being inspected.
   * @param methodName The handler method name used in diagnostics.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @returns The resolved rejection schemas, or undefined when invalid.
   */
  thrownSchemas(
    expression: ts.CallExpression,
    scope: AnalyzerScope,
    className: string,
    methodName: string,
  ): readonly SchemaReference[] | undefined {
    const schemas = expression.arguments.map((argument) =>
      HandlerSources.rejectionSchemaFromExpression(argument, scope.imports),
    );
    if (schemas.some((schema) => schema === undefined)) {
      HandlerSources.invalidThrows(
        scope,
        expression,
        "@Throws accepts only generated rejection companions.",
        className,
        methodName,
      );
      return undefined;
    }
    const resolved = schemas as readonly SchemaReference[];
    const keys = resolved.map((schema) => `${schema.moduleSpecifier}\u0000${schema.exportName}`);
    if (new Set(keys).size !== keys.length) {
      HandlerSources.invalidThrows(
        scope,
        expression,
        "@Throws cannot declare the same rejection more than once.",
        className,
        methodName,
      );
      return undefined;
    }
    return resolved;
  },

  /**
   * Records an invalid Throws declaration at its decorator.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param message The descriptor message or diagnostic text being inspected.
   * @param methodName The handler method name used in diagnostics.
   * @param node The syntax node being inspected.
   * @param scope The current source, imports, program, and diagnostic collection.
   */
  invalidThrows(
    scope: AnalyzerScope,
    node: ts.Node,
    message: string,
    className: string,
    methodName: string,
  ): undefined {
    HandlerTypes.pushDiagnostic(scope, "INVALID_THROWS", node, message, className, methodName);
    return undefined;
  },

  /**
   * Resolves a rejection schema referenced by a decorator expression.
   *
   * @param expression The expression being inspected.
   * @param imports The imports indexed for the current source.
   * @returns The imported rejection schema, or undefined when unresolved.
   */
  rejectionSchemaFromExpression(
    expression: ts.Expression,
    imports: ImportState,
  ): SchemaReference | undefined {
    const unwrapped = HandlerSources.unwrapExpression(expression);
    if (ts.isIdentifier(unwrapped)) return imports.rejectionSymbols.get(unwrapped.text);
    if (!ts.isPropertyAccessExpression(unwrapped) || !ts.isIdentifier(unwrapped.expression)) {
      return undefined;
    }
    const namespace = imports.rejectionNamespaces.get(unwrapped.expression.text);
    const schemaName = `${unwrapped.name.text}Schema`;
    return namespace?.exports.schemaRoles.get(schemaName) !== "rejection"
      ? undefined
      : { moduleSpecifier: namespace.moduleSpecifier, exportName: schemaName };
  },

  /**
   * Records an unsupported Apply decorator on a method.
   *
   * @param input The collected method or validation input.
   */
  reportUnsupportedApply(input: {
    readonly apply: DecoratorUse | undefined;
    readonly scope: AnalyzerScope;
    readonly className: string;
    readonly method: string | undefined;
  }): void {
    if (input.apply === undefined) return;
    HandlerTypes.pushDiagnostic(
      input.scope,
      "APPLY_DECORATOR",
      input.apply.node,
      "Generated registries do not support @Apply.",
      input.className,
      input.method,
    );
  },

  /**
   * Records Where or Throws decorators without a handler decorator.
   *
   * @param input The collected method or validation input.
   * @returns False to stop analysis when no handler decorator is present.
   */
  reportMissingHandler(input: {
    readonly whereUses: readonly DecoratorUse[];
    readonly throwsUses: readonly DecoratorUse[];
    readonly node: ts.MethodDeclaration;
    readonly scope: AnalyzerScope;
    readonly className: string;
    readonly method: string | undefined;
  }): false {
    if (input.whereUses.length > 0)
      HandlerTypes.pushDiagnostic(
        input.scope,
        "INVALID_WHERE",
        input.whereUses[0]?.node ?? input.node,
        "@Where requires an Event-consuming @Subscribe, @React, or @Command handler.",
        input.className,
        input.method,
      );
    if (input.throwsUses.length > 0)
      HandlerTypes.pushDiagnostic(
        input.scope,
        "INVALID_THROWS",
        input.throwsUses[0]?.node ?? input.node,
        "@Throws requires an @Assign handler.",
        input.className,
        input.method,
      );
    return false;
  },

  /**
   * Checks that a handler decorator has no arguments.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param handler The recognized handler decorator.
   * @param method The handler method name.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @returns Whether the handler decorator is bare.
   */
  validBareHandlerDecorator(
    handler: HandlerDecoratorUse,
    scope: AnalyzerScope,
    className: string,
    method: string | undefined,
  ): boolean {
    if (!handler.hasArguments) return true;
    HandlerTypes.pushDiagnostic(
      scope,
      "SCHEMA_BEARING_DECORATOR",
      handler.node,
      `@${handler.name}(...) is not supported in analyzed app source.`,
      className,
      method,
    );
    return false;
  },

  /**
   * Checks that a handler decorator fits the receiver kind.
   *
   * @param input The collected method or validation input.
   * @returns Whether the decorator fits the receiver kind.
   */
  validHandlerKind(input: {
    readonly handler: HandlerDecoratorUse;
    readonly entityBase: string | undefined;
    readonly receiverKind: "entity" | "standalone" | undefined;
    readonly scope: AnalyzerScope;
    readonly className: string;
    readonly method: string | undefined;
  }): boolean {
    return (
      HandlerSources.validEntityHandlerKind(input) &&
      HandlerSources.validStandaloneHandlerKind(input)
    );
  },

  /**
   * Checks an entity handler against its aggregate, projection, or process manager base.
   *
   * @param input The collected method or validation input.
   * @returns Whether the entity base supports this handler kind.
   */
  validEntityHandlerKind(input: {
    readonly handler: HandlerDecoratorUse;
    readonly entityBase: string | undefined;
    readonly scope: AnalyzerScope;
    readonly className: string;
    readonly method: string | undefined;
  }): boolean {
    const { className, entityBase, handler, method, scope } = input;
    if (entityBase === "Projection" && handler.name === "Assign")
      return HandlerSources.unsupported(
        scope,
        "UNSUPPORTED_ASSIGN_HANDLER",
        handler.node,
        "Projection handlers cannot use @Assign.",
        className,
        method,
      );
    return (
      (entityBase !== "Aggregate" && entityBase !== "Projection") ||
      handler.name !== "Command" ||
      HandlerSources.unsupported(
        scope,
        "UNSUPPORTED_COMMAND_HANDLER",
        handler.node,
        "Only Process Managers support @Command handlers.",
        className,
        method,
      )
    );
  },

  /**
   * Checks a standalone handler against its receiver base.
   *
   * @param input The collected method or validation input.
   * @returns Whether the standalone base supports this handler kind.
   */
  validStandaloneHandlerKind(input: {
    readonly handler: HandlerDecoratorUse;
    readonly entityBase: string | undefined;
    readonly receiverKind: "entity" | "standalone" | undefined;
    readonly scope: AnalyzerScope;
    readonly className: string;
    readonly method: string | undefined;
  }): boolean {
    const { className, entityBase, handler, method, receiverKind, scope } = input;
    return (
      receiverKind !== "standalone" ||
      HandlerSources.allowsStandaloneDecorator(entityBase, handler.name) ||
      HandlerSources.unsupported(
        scope,
        "UNSUPPORTED_COMMAND_HANDLER",
        handler.node,
        `@${handler.name} is not legal for standalone ${entityBase ?? "receiver"}.`,
        className,
        method,
      )
    );
  },

  /**
   * Records an unsupported handler configuration.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param code The diagnostic code to report.
   * @param message The descriptor message or diagnostic text being inspected.
   * @param method The handler method name.
   * @param node The syntax node being inspected.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @returns False after recording the unsupported configuration.
   */
  unsupported(
    scope: AnalyzerScope,
    code: BuildHandlerDiagnosticCode,
    node: ts.Node,
    message: string,
    className: string,
    method: string | undefined,
  ): false {
    HandlerTypes.pushDiagnostic(scope, code, node, message, className, method);
    return false;
  },

  /**
   * Validates and reads the event filter declared by Where.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param handler The recognized handler decorator.
   * @param methodName The handler method name used in diagnostics.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @param signalKind The resolved input signal kind.
   * @param uses The decorator uses under inspection.
   * @returns The validated event filter, or undefined when absent or invalid.
   */
  whereDeclaration(
    uses: readonly DecoratorUse[],
    handler: HandlerDecoratorUse,
    signalKind: SignalKind | undefined,
    scope: AnalyzerScope,
    className: string,
    methodName: string,
  ): BuildWhereOptions | undefined {
    if (uses.length === 0) return undefined;
    const use = uses[0];
    if (
      uses.length !== 1 ||
      (handler.name !== "Subscribe" && handler.name !== "React" && handler.name !== "Command") ||
      (signalKind !== "event" && signalKind !== "rejection") ||
      use === undefined
    ) {
      HandlerTypes.pushDiagnostic(
        scope,
        "INVALID_WHERE",
        use?.node ?? handler.node,
        "@Where is allowed once on an Event-consuming @Subscribe, @React, or @Command handler.",
        className,
        methodName,
      );
      return undefined;
    }
    const expression = use.node.expression;
    if (!ts.isCallExpression(expression) || expression.arguments.length !== 1) {
      HandlerTypes.pushDiagnostic(
        scope,
        "INVALID_WHERE",
        use.node,
        "@Where requires one object literal.",
        className,
        methodName,
      );
      return undefined;
    }
    const options = expression.arguments[0];
    if (options === undefined || !ts.isObjectLiteralExpression(options)) {
      HandlerTypes.pushDiagnostic(
        scope,
        "INVALID_WHERE",
        expression,
        "@Where options must be an object literal.",
        className,
        methodName,
      );
      return undefined;
    }
    const values = new Map<string, string>();
    for (const property of options.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        (property.name.kind !== ts.SyntaxKind.Identifier &&
          !ts.isStringLiteralLike(property.name)) ||
        !ts.isStringLiteralLike(property.initializer)
      ) {
        HandlerTypes.pushDiagnostic(
          scope,
          "INVALID_WHERE",
          property,
          "@Where accepts only eventField and equals string literals.",
          className,
          methodName,
        );
        return undefined;
      }
      const name = property.name.text;
      if ((name !== "eventField" && name !== "equals") || values.has(name)) {
        HandlerTypes.pushDiagnostic(
          scope,
          "INVALID_WHERE",
          property,
          "@Where accepts each of eventField and equals exactly once.",
          className,
          methodName,
        );
        return undefined;
      }
      values.set(name, property.initializer.text);
    }
    const eventField = values.get("eventField");
    const equals = values.get("equals");
    if (eventField === undefined || eventField.trim().length === 0 || equals === undefined) {
      HandlerTypes.pushDiagnostic(
        scope,
        "INVALID_WHERE",
        options,
        "@Where requires non-empty eventField and string equals.",
        className,
        methodName,
      );
      return undefined;
    }
    return Object.freeze({ eventField, equals });
  },

  /**
   * Checks whether a class has a recognized method decorator.
   *
   * @param imports The imports indexed for the current source.
   * @param node The syntax node being inspected.
   * @returns Whether the class has a recognized decorated method.
   */
  hasDecoratedMethod(node: ts.ClassDeclaration, imports: ImportState): boolean {
    return node.members.some(
      (member) =>
        ts.isMethodDeclaration(member) &&
        HandlerSources.methodDecorators(member, imports).length > 0,
    );
  },

  /**
   * Finds the export problem that prevents generated receiver imports.
   *
   * @param node The syntax node being inspected.
   * @param source The source file being inspected.
   * @returns Whether the source exports the class by name.
   */
  receiverExportIssue(
    node: ts.ClassDeclaration,
    source: ts.SourceFile,
  ): { readonly code: BuildHandlerDiagnosticCode; readonly message: string } | undefined {
    if (HandlerTypes.hasModifier(node, ts.SyntaxKind.DefaultKeyword)) return undefined;
    if (HandlerTypes.hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
      return undefined;
    }
    if (node.name !== undefined && HandlerSources.hasNamedClassExport(node.name.text, source)) {
      return undefined;
    }

    return {
      code: "NON_EXPORTED_RECEIVER_CLASS",
      message: "Decorated receiver classes must be exported for generated registry imports.",
    };
  },

  /**
   * Checks whether a class is exported by name from its source.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param source The source file being inspected.
   * @returns Whether the export clause includes the class name.
   */
  hasNamedClassExport(className: string, source: ts.SourceFile): boolean {
    return source.statements.some(
      (statement) =>
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier === undefined &&
        statement.exportClause !== undefined &&
        HandlerSources.namedExportIncludes(statement.exportClause, className),
    );
  },

  /**
   * Checks whether an export clause names a class.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param clause The named export clause to inspect.
   * @returns Whether the named export clause includes the class.
   */
  namedExportIncludes(clause: ts.NamedExportBindings, className: string): boolean {
    return (
      ts.isNamedExports(clause) &&
      clause.elements.some(
        (element) =>
          element.name.text === className &&
          (element.propertyName === undefined || element.propertyName.text === className),
      )
    );
  },

  /**
   * Checks the method declaration and its decorator before schema analysis.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param decorator The decorator under inspection.
   * @param method The handler method name.
   * @param node The syntax node being inspected.
   * @param requiresEntityState Whether the receiver requires a generated entity state schema.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @param stateSchema The resolved entity state schema, when present.
   * @returns Whether the method can be analyzed.
   */
  validateHandlerNode(
    node: ts.MethodDeclaration,
    decorator: HandlerDecorator,
    stateSchema: SchemaReference | undefined,
    requiresEntityState: boolean,
    scope: AnalyzerScope,
    className: string,
    method: string | undefined,
  ): boolean {
    return [
      HandlerSources.validateEntityState(
        node,
        stateSchema,
        requiresEntityState,
        scope,
        className,
        method,
      ),
      HandlerSources.validateName(node, scope, className),
      HandlerSources.validateVisibility(node, scope, className, method),
      HandlerSources.validateParameters(node, decorator, scope, className, method),
      HandlerSources.validateReturn(node, decorator, scope, className, method),
    ].some(Boolean);
  },

  /**
   * Checks that an entity receiver declares a generated state schema.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param method The handler method name.
   * @param node The syntax node being inspected.
   * @param requiresEntityState Whether the receiver requires a generated entity state schema.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @param stateSchema The resolved entity state schema, when present.
   * @returns Whether the entity state schema is valid.
   */
  validateEntityState(
    node: ts.MethodDeclaration,
    stateSchema: SchemaReference | undefined,
    requiresEntityState: boolean,
    scope: AnalyzerScope,
    className: string,
    method: string | undefined,
  ): boolean {
    if (!requiresEntityState || stateSchema !== undefined) {
      return false;
    }

    HandlerTypes.pushDiagnostic(
      scope,
      "MISSING_ENTITY_STATE_SCHEMA",
      node,
      "Decorated handlers must be declared on an entity class with an inferred state schema.",
      className,
      method,
    );
    return true;
  },

  /**
   * Checks that a handler method has an importable name.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param node The syntax node being inspected.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @returns Whether the method name is importable.
   */
  validateName(node: ts.MethodDeclaration, scope: AnalyzerScope, className: string): boolean {
    if (HandlerTypes.methodName(node) !== undefined) {
      return false;
    }

    HandlerTypes.pushDiagnostic(
      scope,
      "INVALID_HANDLER_NAME",
      node.name,
      "Decorated handlers must use a string method name.",
      className,
    );
    return true;
  },

  /**
   * Checks that a handler method is publicly callable.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param method The handler method name.
   * @param node The syntax node being inspected.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @returns Whether the handler method is public.
   */
  validateVisibility(
    node: ts.MethodDeclaration,
    scope: AnalyzerScope,
    className: string,
    method: string | undefined,
  ): boolean {
    if (
      !HandlerTypes.hasModifier(node, ts.SyntaxKind.StaticKeyword) &&
      !HandlerTypes.hasModifier(node, ts.SyntaxKind.PrivateKeyword) &&
      !HandlerTypes.hasModifier(node, ts.SyntaxKind.ProtectedKeyword)
    ) {
      return false;
    }

    HandlerTypes.pushDiagnostic(
      scope,
      "INVALID_HANDLER_VISIBILITY",
      node.name,
      "Decorated handlers must be public instance methods.",
      className,
      method,
    );
    return true;
  },

  /**
   * Checks the parameter count and required input declaration.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param decorator The decorator under inspection.
   * @param method The handler method name.
   * @param node The syntax node being inspected.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @returns Whether the input and context parameters are valid.
   */
  validateParameters(
    node: ts.MethodDeclaration,
    decorator: HandlerDecorator,
    scope: AnalyzerScope,
    className: string,
    method: string | undefined,
  ): boolean {
    if (node.parameters.length !== 1 && node.parameters.length !== 2) {
      HandlerTypes.pushDiagnostic(
        scope,
        "INVALID_PARAMETER_COUNT",
        node,
        "Decorated handlers must declare one or two public parameters.",
        className,
        method,
      );
      return true;
    }
    if (node.parameters[0]?.type === undefined) {
      HandlerTypes.pushDiagnostic(
        scope,
        "MISSING_SIGNAL_TYPE",
        node,
        `@${decorator} handlers require an explicit first parameter type.`,
        className,
        method,
      );
      return true;
    }

    const origin = HandlerSources.externalOrigin(node.parameters, scope, className, method);
    if (origin === undefined) return true;
    const signal = HandlerSources.schemaUseFromType(origin.type, scope.imports);
    if (signal !== undefined && HandlerSources.acceptsSignalKind(decorator, signal.kind)) {
      if (origin.value === "external" && signal.kind === "command") {
        HandlerTypes.pushDiagnostic(
          scope,
          "EXTERNAL_COMMAND_RECEIVER",
          node.parameters[0].type,
          "Command receivers cannot declare External<Command>.",
          className,
          method,
        );
        return true;
      }
      return false;
    }

    HandlerTypes.pushDiagnostic(
      scope,
      "INVALID_SIGNAL_TYPE",
      node.parameters[0].type,
      `@${decorator} first parameter must be ${HandlerSources.signalMessage(decorator)}.`,
      className,
      method,
    );
    return true;
  },

  /**
   * Checks the explicit return shape required by a handler decorator.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param decorator The decorator under inspection.
   * @param method The handler method name.
   * @param node The syntax node being inspected.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @returns Whether the return declaration meets the handler contract.
   */
  validateReturn(
    node: ts.MethodDeclaration,
    decorator: HandlerDecorator,
    scope: AnalyzerScope,
    className: string,
    method: string | undefined,
  ): boolean {
    if (decorator === "Subscribe") {
      return HandlerSources.validateSubscribeReturn(node, scope, className, method);
    }
    if (node.type === undefined) {
      HandlerTypes.pushDiagnostic(
        scope,
        "MISSING_RETURN_TYPE",
        node,
        `@${decorator} handlers require an explicit return type.`,
        className,
        method,
      );
      return true;
    }

    const returnType = HandlerSources.unwrapOuterPromise(node.type, scope);
    const envelope = HandlerSources.frameworkEnvelope(returnType, scope.imports);
    if (envelope !== undefined) {
      HandlerTypes.pushDiagnostic(
        scope,
        "FRAMEWORK_ENVELOPE_RETURN",
        node.type,
        `Handler return type must not be framework ${envelope}.`,
        className,
        method,
      );
      return true;
    }

    return HandlerSources.validateEmittedReturn(
      node,
      decorator,
      scope,
      className,
      method,
      returnType,
    );
  },

  /**
   * Checks that a subscription handler explicitly returns void.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param method The handler method name.
   * @param node The syntax node being inspected.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @returns Whether the return type is explicitly void.
   */
  validateSubscribeReturn(
    node: ts.MethodDeclaration,
    scope: AnalyzerScope,
    className: string,
    method: string | undefined,
  ): boolean {
    if (
      node.type !== undefined &&
      HandlerSources.isExplicitVoidType(HandlerSources.unwrapOuterPromise(node.type, scope))
    ) {
      return false;
    }

    HandlerTypes.pushDiagnostic(
      scope,
      "INVALID_SUBSCRIBE_RETURN",
      node,
      "@Subscribe handlers must return explicit void.",
      className,
      method,
    );
    return true;
  },

  /**
   * Checks the generated messages emitted by a handler.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param decorator The decorator under inspection.
   * @param method The handler method name.
   * @param node The syntax node being inspected.
   * @param returnType The declared handler return type.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @returns Whether emitted schemas meet the handler contract.
   */
  validateEmittedReturn(
    node: ts.MethodDeclaration,
    decorator: HandlerDecorator,
    scope: AnalyzerScope,
    className: string,
    method: string | undefined,
    returnType = node.type,
  ): boolean {
    const schemas = HandlerSources.emittedSchemaUses(returnType, decorator, scope);
    const issue = HandlerSources.emittedIssue(schemas, decorator, returnType, scope);
    return issue === undefined
      ? false
      : HandlerSources.returnDiagnostic(
          scope,
          issue.code,
          returnType ?? node,
          issue.message,
          className,
          method,
        );
  },

  /**
   * Finds the first invalid emitted return shape.
   *
   * @param decorator The decorator under inspection.
   * @param returnType The declared handler return type.
   * @param schemas The generated schemas under inspection.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @returns The first invalid return condition, or undefined when valid.
   */
  emittedIssue(
    schemas: readonly SchemaUse[] | undefined,
    decorator: HandlerDecorator,
    returnType: ts.TypeNode | undefined,
    scope: AnalyzerScope,
  ): { readonly code: BuildHandlerDiagnostic["code"]; readonly message: string } | undefined {
    if (schemas === undefined)
      return {
        code: "UNSUPPORTED_RETURN_TYPE",
        message: `@${decorator} return type must resolve to generated schema references.`,
      };
    const expected = HandlerSources.emittedSignalKind(decorator);
    if (expected !== undefined && schemas.some((schema) => schema.kind !== expected))
      return {
        code: "INVALID_EMITTED_SCHEMA",
        message: `@${decorator} return type must emit generated ${expected} schemas.`,
      };
    if (
      (decorator === "Assign" || decorator === "Command") &&
      (schemas.length === 0 || HandlerSources.optionalOnlyTuple(returnType, scope))
    )
      return {
        code: "MISSING_EMITTED_SCHEMAS",
        message: `@${decorator} handlers must emit at least one schema.`,
      };
    const emptyReaction = decorator === "React" && schemas.length === 0;
    if (emptyReaction && !HandlerSources.isExplicitVoidType(returnType))
      return {
        code: "MISSING_EMITTED_SCHEMAS",
        message: "@React handlers must emit at least one schema unless they return explicit void.",
      };
    return undefined;
  },

  /**
   * Checks a result tuple whose members can all be absent.
   *
   * @param scope The current source, imports, program, and diagnostic collection.
   * @param typeNode The declared type node under inspection.
   * @returns Whether every tuple member may be absent.
   */
  optionalOnlyTuple(typeNode: ts.TypeNode | undefined, scope: AnalyzerScope): boolean {
    if (typeNode === undefined) return false;
    const type = scope.program.getTypeChecker().getTypeFromTypeNode(typeNode);
    return (
      scope.program.getTypeChecker().isTupleType(type) &&
      (type as ts.TupleTypeReference).target.minLength === 0
    );
  },

  /**
   * Records an invalid handler return shape.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param code The diagnostic code to report.
   * @param message The descriptor message or diagnostic text being inspected.
   * @param method The handler method name.
   * @param node The syntax node being inspected.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @returns True after adding the return diagnostic.
   */
  returnDiagnostic(
    scope: AnalyzerScope,
    code: BuildHandlerDiagnostic["code"],
    node: ts.Node,
    message: string,
    className: string,
    method: string | undefined,
  ): true {
    HandlerTypes.pushDiagnostic(scope, code, node, message, className, method);
    return true;
  },

  /**
   * Collects recognized Spine decorators attached to a method.
   *
   * @param imports The imports indexed for the current source.
   * @param node The syntax node being inspected.
   * @returns The recognized decorators attached to the method.
   */
  methodDecorators(node: ts.MethodDeclaration, imports: ImportState): readonly DecoratorUse[] {
    return (ts.getDecorators(node) ?? []).flatMap((decorator) => {
      const expression = ts.isCallExpression(decorator.expression)
        ? decorator.expression.expression
        : decorator.expression;
      const name = HandlerSources.serverDecoratorName(expression, imports);

      return name === undefined
        ? []
        : [{ hasArguments: ts.isCallExpression(decorator.expression), name, node: decorator }];
    });
  },

  /**
   * Resolves a decorator expression to its imported Spine name.
   *
   * @param expression The expression being inspected.
   * @param imports The imports indexed for the current source.
   * @returns The imported Spine decorator name, or undefined when unrecognized.
   */
  serverDecoratorName(
    expression: ts.Expression,
    imports: ImportState,
  ): ServerDecorator | undefined {
    if (ts.isIdentifier(expression)) {
      return HandlerTypes.serverDecorator(imports.serverSymbols.get(expression.text));
    }
    if (ts.isPropertyAccessExpression(expression)) {
      const namespace = HandlerTypes.expressionName(expression.expression);
      if (namespace !== undefined && imports.serverNamespaces.has(namespace)) {
        return HandlerTypes.serverDecorator(expression.name.text);
      }
    }

    return undefined;
  },

  /**
   * Checks a recognized decorator to a handler decorator.
   *
   * @param decorator The decorator under inspection.
   * @returns Whether the decorator is a handler decorator.
   */
  isHandlerUse(decorator: DecoratorUse): decorator is HandlerDecoratorUse {
    return handlerDecorators.has(decorator.name as HandlerDecorator);
  },

  /**
   * Checks whether a standalone receiver base permits a handler decorator.
   *
   * @param base The resolved framework receiver base, when present.
   * @param decorator The decorator under inspection.
   * @returns Whether the base permits this handler decorator.
   */
  allowsStandaloneDecorator(base: string | undefined, decorator: HandlerDecorator): boolean {
    return (
      (base === "AbstractAssignee" && decorator === "Assign") ||
      (base === "AbstractCommander" && decorator === "Command") ||
      (base === "AbstractEventReactor" && decorator === "React") ||
      (base === "AbstractEventSubscriber" && decorator === "Subscribe")
    );
  },

  /**
   * Resolves a class to its entity or standalone receiver ancestry.
   *
   * @param node The syntax node being inspected.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @param seen The declarations already visited during traversal.
   * @returns The resolved receiver ancestry, or undefined when unsupported.
   */
  receiverLineage(
    node: ts.ClassDeclaration,
    scope: AnalyzerScope,
    seen: ReadonlySet<ts.ClassDeclaration> = new Set(),
  ):
    | {
        readonly receiverKind: "entity";
        readonly base: string;
        readonly stateSchema: SchemaReference | undefined;
      }
    | {
        readonly receiverKind: "standalone";
        readonly base: string;
        readonly stateSchema: undefined;
      }
    | undefined {
    if (seen.has(node)) return undefined;
    const nextSeen = new Set(seen);
    nextSeen.add(node);

    for (const clause of node.heritageClauses ?? []) {
      for (const type of clause.types) {
        const direct = HandlerSources.directReceiverLineage(type, scope);
        if (direct !== undefined) return direct;
        const inherited = HandlerSources.inheritedReceiverLineage(type.expression, scope, nextSeen);
        if (inherited !== undefined) return inherited;
      }
    }

    return undefined;
  },

  /**
   * Resolves a class's direct framework receiver base.
   *
   * @param scope The current source, imports, program, and diagnostic collection.
   * @param type The checked or declared type under inspection.
   * @returns The direct receiver ancestry, or undefined when absent.
   */
  directReceiverLineage(
    type: ts.ExpressionWithTypeArguments,
    scope: AnalyzerScope,
  ):
    | {
        readonly receiverKind: "entity";
        readonly base: string;
        readonly stateSchema: SchemaReference | undefined;
      }
    | {
        readonly receiverKind: "standalone";
        readonly base: string;
        readonly stateSchema: undefined;
      }
    | undefined {
    const base = HandlerSources.directEntityBaseName(type.expression, scope.imports);
    if (base !== undefined) {
      const stateType = type.typeArguments?.[1];
      const stateSchema =
        stateType === undefined
          ? undefined
          : HandlerSources.schemaFromTypeQuery(
              stateType,
              scope.imports,
              HandlerSources.newTypeWalk(),
            );
      return { receiverKind: "entity", base, stateSchema };
    }
    const standalone = HandlerSources.directStandaloneBaseName(type.expression, scope.imports);
    if (standalone !== undefined)
      return { receiverKind: "standalone", base: standalone, stateSchema: undefined };
  },

  /**
   * Resolves receiver ancestry through a local base class.
   *
   * @param expression The expression being inspected.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @param seen The declarations already visited during traversal.
   * @returns The inherited receiver ancestry, or undefined when unresolved.
   */
  inheritedReceiverLineage(
    expression: ts.Expression,
    scope: AnalyzerScope,
    seen: ReadonlySet<ts.ClassDeclaration>,
  ):
    | {
        readonly receiverKind: "entity";
        readonly base: string;
        readonly stateSchema: SchemaReference | undefined;
      }
    | {
        readonly receiverKind: "standalone";
        readonly base: string;
        readonly stateSchema: undefined;
      }
    | undefined {
    const parent = HandlerSources.classDeclarationFor(expression, scope);
    if (parent === undefined) return undefined;
    const source = parent.getSourceFile();
    return HandlerSources.receiverLineage(
      parent,
      { ...scope, source, imports: HandlerSources.buildImportState(source, scope.program) },
      seen,
    );
  },

  /**
   * Finds the framework entity base named by an extends expression.
   *
   * @param expression The expression being inspected.
   * @param imports The imports indexed for the current source.
   * @returns The entity base name, or undefined when absent.
   */
  directEntityBaseName(expression: ts.Expression, imports: ImportState): string | undefined {
    if (ts.isIdentifier(expression)) {
      const base = imports.serverSymbols.get(expression.text);
      return base !== undefined && entityBaseNames.has(base) ? base : undefined;
    }
    if (ts.isPropertyAccessExpression(expression)) {
      const namespace = HandlerTypes.expressionName(expression.expression);
      return namespace !== undefined &&
        imports.serverNamespaces.has(namespace) &&
        entityBaseNames.has(expression.name.text)
        ? expression.name.text
        : undefined;
    }
    return undefined;
  },

  /**
   * Finds the framework standalone base named by an extends expression.
   *
   * @param expression The expression being inspected.
   * @param imports The imports indexed for the current source.
   * @returns The standalone base name, or undefined when absent.
   */
  directStandaloneBaseName(expression: ts.Expression, imports: ImportState): string | undefined {
    if (ts.isIdentifier(expression)) {
      const base = imports.serverSymbols.get(expression.text);
      return base !== undefined && standaloneBaseNames.has(base) ? base : undefined;
    }
    if (ts.isPropertyAccessExpression(expression)) {
      const namespace = HandlerTypes.expressionName(expression.expression);
      return namespace !== undefined &&
        imports.serverNamespaces.has(namespace) &&
        standaloneBaseNames.has(expression.name.text)
        ? expression.name.text
        : undefined;
    }
    return undefined;
  },

  /**
   * Finds the local class declaration referenced by an extends expression.
   *
   * @param expression The expression being inspected.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @returns The local base class declaration, or undefined when absent.
   */
  classDeclarationFor(
    expression: ts.Expression,
    scope: AnalyzerScope,
  ): ts.ClassDeclaration | undefined {
    const checker = scope.program.getTypeChecker();
    const location = ts.isPropertyAccessExpression(expression) ? expression.name : expression;
    let symbol = checker.getSymbolAtLocation(location);
    if (symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
      symbol = checker.getAliasedSymbol(symbol);
    }
    const declaration = symbol?.declarations?.find(ts.isClassDeclaration);
    if (declaration !== undefined) return declaration;
    const declarations = checker.getTypeAtLocation(expression).getSymbol()?.declarations;
    return declarations === undefined ? undefined : declarations.find(ts.isClassDeclaration);
  },

  /**
   * Checks whether an extends expression names an entity base.
   *
   * @param expression The expression being inspected.
   * @param imports The imports indexed for the current source.
   * @returns Whether the expression names a framework entity base.
   */
  isEntityBase(expression: ts.Expression, imports: ImportState): boolean {
    return HandlerSources.directEntityBaseName(expression, imports) !== undefined;
  },

  /**
   * Resolves an entity state schema referenced by a type query.
   *
   * @param imports The imports indexed for the current source.
   * @param typeNode The declared type node under inspection.
   * @param walk The bounded alias traversal state.
   * @returns The referenced generated schema, or undefined when unresolved.
   */
  schemaFromTypeQuery(
    typeNode: ts.TypeNode,
    imports: ImportState,
    walk: TypeWalk,
  ): SchemaReference | undefined {
    if (!HandlerSources.consumeTypeWalk(walk)) {
      return undefined;
    }
    if (ts.isParenthesizedTypeNode(typeNode)) {
      return HandlerSources.schemaFromTypeQuery(typeNode.type, imports, walk);
    }
    if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
      const alias = imports.localTypeAliases.get(typeNode.typeName.text);
      return alias === undefined
        ? undefined
        : HandlerSources.resolveAlias(typeNode.typeName.text, alias, walk, (resolved) =>
            HandlerSources.schemaFromTypeQuery(resolved, imports, walk),
          );
    }
    if (!ts.isTypeQueryNode(typeNode)) {
      return undefined;
    }

    return HandlerSources.schemaFromEntityName(typeNode.exprName, imports);
  },

  /**
   * Collects generated schemas allowed by a handler's return type.
   *
   * @param decorator The decorator under inspection.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @param typeNode The declared type node under inspection.
   * @returns The emitted schema uses, or undefined when the return type is invalid.
   */
  emittedSchemaUses(
    typeNode: ts.TypeNode | undefined,
    decorator: HandlerDecorator,
    scope: AnalyzerScope,
  ): readonly SchemaUse[] | undefined {
    if (decorator === "Subscribe") {
      return typeNode?.kind === ts.SyntaxKind.VoidKeyword ? [] : undefined;
    }
    if (typeNode?.kind === ts.SyntaxKind.VoidKeyword) {
      return [];
    }
    if (typeNode === undefined) {
      return undefined;
    }

    const direct = HandlerSources.schemaListFromType(
      typeNode,
      scope.imports,
      HandlerSources.newTypeWalk(),
    );
    if (direct !== undefined) return direct;
    const unwrapped = HandlerSources.unwrapReadonly(typeNode);
    return ts.isTupleTypeNode(unwrapped) || ts.isArrayTypeNode(unwrapped)
      ? undefined
      : HandlerSources.checkedSchemas(typeNode, scope);
  },

  /**
   * Resolves concrete generated schemas from a checked TypeScript type.
   *
   * @param scope The current source, imports, program, and diagnostic collection.
   * @param typeNode The declared type node under inspection.
   * @returns The generated schema uses, or undefined when expansion fails.
   */
  checkedSchemas(typeNode: ts.TypeNode, scope: AnalyzerScope): readonly SchemaUse[] | undefined {
    const checker = scope.program.getTypeChecker();
    return HandlerSources.fromCheckedType(
      checker.getTypeFromTypeNode(typeNode),
      checker,
      scope,
      HandlerSources.newTypeWalk(),
    );
  },

  /**
   * Collects generated schemas from checked union, array, or tuple types.
   *
   * @param checker The TypeScript type checker for the program.
   * @param optional Whether this checked branch may be absent.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @param type The checked or declared type under inspection.
   * @param walk The bounded alias traversal state.
   * @returns The schema uses, or undefined when a checked type is unsupported.
   */
  fromCheckedType(
    type: ts.Type,
    checker: ts.TypeChecker,
    scope: AnalyzerScope,
    walk: TypeWalk,
    optional = false,
  ): readonly SchemaUse[] | undefined {
    if (!HandlerSources.consumeTypeWalk(walk)) return undefined;
    if (optional && (type.flags & ts.TypeFlags.Undefined) !== 0) return [];
    if (type.isUnion()) {
      return HandlerSources.checkedBranches(type.types, checker, scope, walk, optional);
    }
    if (checker.isTupleType(type)) {
      const tuple = type as ts.TupleTypeReference;
      if (tuple.target.combinedFlags & ts.ElementFlags.Variable) return undefined;
      return HandlerSources.checkedBranches(
        checker.getTypeArguments(tuple),
        checker,
        scope,
        walk,
        true,
      );
    }
    if (checker.isArrayType(type)) {
      const member = checker.getTypeArguments(type as ts.TypeReference)[0];
      return member === undefined
        ? undefined
        : HandlerSources.fromCheckedType(member, checker, scope, walk);
    }
    const schema = HandlerSources.checkedMessage(type, scope);
    return schema === undefined ? undefined : [schema];
  },

  /**
   * Collects schemas across checked alternatives and optional branches.
   *
   * @param checker The TypeScript type checker for the program.
   * @param optional Whether this checked branch may be absent.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @param types The checked type alternatives to inspect.
   * @param walk The bounded alias traversal state.
   * @returns The schema uses across all branches, or undefined when one cannot resolve.
   */
  checkedBranches(
    types: readonly ts.Type[],
    checker: ts.TypeChecker,
    scope: AnalyzerScope,
    walk: TypeWalk,
    optional: boolean,
  ): readonly SchemaUse[] | undefined {
    const branches = types.map((type) =>
      HandlerSources.fromCheckedType(type, checker, scope, walk, optional),
    );
    return branches.some((branch) => branch === undefined)
      ? undefined
      : branches.flatMap((branch) => branch ?? []);
  },

  /**
   * Maps a checked generated message type to its schema reference.
   *
   * @param scope The current source, imports, program, and diagnostic collection.
   * @param type The checked or declared type under inspection.
   * @returns The generated message schema, or undefined when unresolved.
   */
  checkedMessage(type: ts.Type, scope: AnalyzerScope): SchemaUse | undefined {
    const declaration = type.getSymbol()?.declarations?.find(ts.isInterfaceDeclaration);
    if (declaration === undefined) return undefined;
    const source = declaration.getSourceFile();
    if (!/(^|\/)generated\/.+_pb\.ts$/u.test(source.fileName)) return undefined;
    const schemaName = `${declaration.name.text}Schema`;
    const exports = HandlerSources.exportedNames(source);
    if (!exports.types.has(declaration.name.text) || !exports.values.has(schemaName))
      return undefined;
    const path = relative(dirname(scope.source.fileName), source.fileName).replace(/\.ts$/u, ".js");
    return {
      kind: exports.schemaRoles.get(schemaName),
      reference: {
        moduleSpecifier: path.startsWith(".") ? path : `./${path}`,
        exportName: schemaName,
      },
    };
  },

  /**
   * Collects generated schemas from a declared return type.
   *
   * @param imports The imports indexed for the current source.
   * @param typeNode The declared type node under inspection.
   * @param walk The bounded alias traversal state.
   * @returns The emitted schemas, or undefined when the declared type is unsupported.
   */
  schemaListFromType(
    typeNode: ts.TypeNode,
    imports: ImportState,
    walk: TypeWalk,
  ): readonly SchemaUse[] | undefined {
    if (!HandlerSources.consumeTypeWalk(walk)) {
      return undefined;
    }
    const unwrapped = HandlerSources.unwrapReadonly(typeNode);
    if (ts.isUnionTypeNode(unwrapped)) {
      const branches = unwrapped.types.map((branch) =>
        HandlerSources.schemaListFromType(branch, imports, walk),
      );
      return branches.some((branch) => branch === undefined)
        ? undefined
        : branches.flatMap((branch) => branch ?? []);
    }
    if (ts.isArrayTypeNode(unwrapped)) {
      const item = HandlerSources.schemaUseFromType(unwrapped.elementType, imports, walk);
      return item === undefined ? undefined : [item];
    }
    if (ts.isTupleTypeNode(unwrapped)) {
      return HandlerSources.schemaListFromTuple(unwrapped, imports, walk);
    }
    if (ts.isTypeReferenceNode(unwrapped) && HandlerSources.isArrayReferenceType(unwrapped)) {
      const item = HandlerSources.schemaUseFromType(unwrapped.typeArguments?.[0], imports, walk);
      return item === undefined ? undefined : [item];
    }

    const schema = HandlerSources.schemaUseFromType(unwrapped, imports, walk);
    return schema === undefined ? undefined : [schema];
  },

  /**
   * Collects generated schemas from a tuple return type.
   *
   * @param imports The imports indexed for the current source.
   * @param typeNode The declared type node under inspection.
   * @param walk The bounded alias traversal state.
   * @returns The tuple's emitted schemas, or undefined when a member is invalid.
   */
  schemaListFromTuple(
    typeNode: ts.TupleTypeNode,
    imports: ImportState,
    walk: TypeWalk,
  ): readonly SchemaUse[] | undefined {
    const schemas: SchemaUse[] = [];

    for (const element of typeNode.elements) {
      const member = HandlerSources.schemaFromTupleElement(element, imports, walk);
      if (member === undefined) {
        return undefined;
      }
      schemas.push(...member);
    }

    return schemas;
  },

  /**
   * Resolves a generated schema from one tuple member.
   *
   * @param imports The imports indexed for the current source.
   * @param typeNode The declared type node under inspection.
   * @param walk The bounded alias traversal state.
   * @returns The member's schema use, or undefined when it cannot resolve.
   */
  schemaFromTupleElement(
    typeNode: ts.TypeNode | ts.NamedTupleMember,
    imports: ImportState,
    walk: TypeWalk,
  ): readonly SchemaUse[] | undefined {
    const member = ts.isNamedTupleMember(typeNode) ? typeNode.type : typeNode;
    if (ts.isUnionTypeNode(member)) {
      const branches = member.types.map((branch) =>
        HandlerSources.schemaUseFromType(branch, imports, walk),
      );
      return branches.some((branch) => branch === undefined)
        ? undefined
        : branches.flatMap((branch) => (branch === undefined ? [] : [branch]));
    }
    if (ts.isNamedTupleMember(typeNode)) {
      return typeNode.dotDotDotToken === undefined
        ? HandlerSources.singleSchema(typeNode.type, imports, walk)
        : undefined;
    }
    if (ts.isRestTypeNode(typeNode)) return undefined;
    if (ts.isOptionalTypeNode(typeNode))
      return HandlerSources.singleSchema(typeNode.type, imports, walk);

    return HandlerSources.singleSchema(typeNode, imports, walk);
  },

  /**
   * Wraps one resolved tuple schema as a schema list.
   *
   * @param imports The imports indexed for the current source.
   * @param typeNode The declared type node under inspection.
   * @param walk The bounded alias traversal state.
   * @returns The single schema as a list, or undefined when it is unresolved.
   */
  singleSchema(
    typeNode: ts.TypeNode,
    imports: ImportState,
    walk: TypeWalk,
  ): readonly SchemaUse[] | undefined {
    const schema = HandlerSources.schemaUseFromType(typeNode, imports, walk);
    return schema === undefined ? undefined : [schema];
  },

  /**
   * Resolves a generated signal schema from a type node.
   *
   * @param imports The imports indexed for the current source.
   * @param typeNode The declared type node under inspection.
   * @param walk The bounded alias traversal state.
   * @returns The generated schema use, or undefined when unresolved.
   */
  schemaUseFromType(
    typeNode: ts.TypeNode | undefined,
    imports: ImportState,
    walk: TypeWalk = HandlerSources.newTypeWalk(),
  ): SchemaUse | undefined {
    if (typeNode === undefined) {
      return undefined;
    }
    if (!HandlerSources.consumeTypeWalk(walk)) {
      return undefined;
    }
    const unwrapped = HandlerSources.unwrapReadonly(typeNode);
    if (!ts.isTypeReferenceNode(unwrapped)) {
      return undefined;
    }
    if (ts.isIdentifier(unwrapped.typeName)) {
      const alias = imports.localTypeAliases.get(unwrapped.typeName.text);
      if (alias !== undefined) {
        return HandlerSources.resolveAlias(unwrapped.typeName.text, alias, walk, (resolved) =>
          HandlerSources.schemaUseFromType(resolved, imports, walk),
        );
      }

      return HandlerSources.schemaUseFromSymbol(unwrapped.typeName.text, imports);
    }
    if (ts.isQualifiedName(unwrapped.typeName)) {
      return HandlerSources.schemaUseFromName(unwrapped.typeName, imports);
    }

    return undefined;
  },

  /**
   * Resolves an imported generated symbol to its schema.
   *
   * @param imports The imports indexed for the current source.
   * @param name The symbol, class, or member name to resolve.
   * @returns The generated schema use, or undefined when unresolved.
   */
  schemaUseFromSymbol(name: string, imports: ImportState): SchemaUse | undefined {
    const symbol = imports.generatedSymbols.get(name);
    if (symbol?.schemaExportName === undefined) {
      return undefined;
    }

    return {
      kind: symbol.kind,
      reference: { moduleSpecifier: symbol.moduleSpecifier, exportName: symbol.schemaExportName },
    };
  },

  /**
   * Resolves a qualified generated type name to its schema.
   *
   * @param imports The imports indexed for the current source.
   * @param name The symbol, class, or member name to resolve.
   * @returns The generated schema use, or undefined when unresolved.
   */
  schemaUseFromName(name: ts.QualifiedName, imports: ImportState): SchemaUse | undefined {
    if (!ts.isIdentifier(name.left)) {
      return undefined;
    }
    const namespace = imports.generatedNamespaces.get(name.left.text);
    const schemaName = `${name.right.text}Schema`;

    return namespace === undefined ||
      !HandlerTypes.hasGeneratedType(namespace.exports, name.right.text) ||
      !namespace.exports.values.has(schemaName)
      ? undefined
      : {
          kind: namespace.exports.schemaRoles.get(schemaName),
          reference: { moduleSpecifier: namespace.moduleSpecifier, exportName: schemaName },
        };
  },

  /**
   * Resolves a generated entity name to its schema reference.
   *
   * @param imports The imports indexed for the current source.
   * @param name The symbol, class, or member name to resolve.
   * @returns The generated schema reference, or undefined when unresolved.
   */
  schemaFromEntityName(name: ts.EntityName, imports: ImportState): SchemaReference | undefined {
    if (ts.isIdentifier(name)) {
      const symbol = imports.generatedSymbols.get(name.text);
      return symbol?.schemaValue !== true
        ? undefined
        : { moduleSpecifier: symbol.moduleSpecifier, exportName: symbol.exportName };
    }
    if (ts.isQualifiedName(name) && ts.isIdentifier(name.left)) {
      const namespace = imports.generatedNamespaces.get(name.left.text);
      return namespace?.exports.values.has(name.right.text) !== true
        ? undefined
        : { moduleSpecifier: namespace.moduleSpecifier, exportName: name.right.text };
    }

    return undefined;
  },

  /**
   * Checks a framework Command or Event envelope return type.
   *
   * @param imports The imports indexed for the current source.
   * @param typeNode The declared type node under inspection.
   * @param walk The bounded alias traversal state.
   * @returns Whether the type is a framework Command or Event envelope.
   */
  frameworkEnvelope(
    typeNode: ts.TypeNode,
    imports: ImportState,
    walk: TypeWalk = HandlerSources.newTypeWalk(),
  ): string | undefined {
    if (!HandlerSources.consumeTypeWalk(walk)) {
      return undefined;
    }
    const unwrapped = HandlerSources.unwrapReadonly(typeNode);
    if (!ts.isTypeReferenceNode(unwrapped)) {
      return undefined;
    }
    if (ts.isIdentifier(unwrapped.typeName)) {
      const alias = imports.localTypeAliases.get(unwrapped.typeName.text);
      if (alias !== undefined) {
        return HandlerSources.resolveAlias(unwrapped.typeName.text, alias, walk, (resolved) =>
          HandlerSources.frameworkEnvelope(resolved, imports, walk),
        );
      }

      return imports.protoSymbols.has(unwrapped.typeName.text)
        ? unwrapped.typeName.text
        : undefined;
    }
    if (ts.isQualifiedName(unwrapped.typeName) && ts.isIdentifier(unwrapped.typeName.left)) {
      const namespace = unwrapped.typeName.left.text;
      const name = unwrapped.typeName.right.text;
      return imports.protoNamespaces.has(namespace) && (name === "Event" || name === "Command")
        ? `${namespace}.${name}`
        : undefined;
    }

    return undefined;
  },

  /**
   * Removes a Readonly wrapper from a declared type.
   *
   * @param typeNode The declared type node under inspection.
   * @returns The inner type when wrapped in Readonly, otherwise the original type.
   */
  unwrapReadonly(typeNode: ts.TypeNode): ts.TypeNode {
    if (ts.isParenthesizedTypeNode(typeNode)) {
      return HandlerSources.unwrapReadonly(typeNode.type);
    }
    if (ts.isTypeOperatorNode(typeNode) && typeNode.operator === ts.SyntaxKind.ReadonlyKeyword) {
      return HandlerSources.unwrapReadonly(typeNode.type);
    }

    return typeNode;
  },

  /**
   * Removes a top-level Promise wrapper from a declared return type.
   *
   * @param scope The current source, imports, program, and diagnostic collection.
   * @param typeNode The declared type node under inspection.
   * @param walk The bounded alias traversal state.
   * @returns The inner type when wrapped in Promise, otherwise the original type.
   */
  unwrapOuterPromise(
    typeNode: ts.TypeNode,
    scope: AnalyzerScope,
    walk: TypeWalk = HandlerSources.newTypeWalk(),
  ): ts.TypeNode {
    if (!HandlerSources.consumeTypeWalk(walk)) {
      return typeNode;
    }
    const unwrapped = HandlerSources.unwrapReadonly(typeNode);
    if (!ts.isTypeReferenceNode(unwrapped) || !ts.isIdentifier(unwrapped.typeName)) {
      return typeNode;
    }
    const alias = scope.imports.localTypeAliases.get(unwrapped.typeName.text);
    if (alias !== undefined) {
      return (
        HandlerSources.resolveAlias(unwrapped.typeName.text, alias, walk, (resolved) =>
          HandlerSources.unwrapOuterPromise(resolved, scope, walk),
        ) ?? typeNode
      );
    }
    if (
      unwrapped.typeName.text !== "Promise" ||
      unwrapped.typeArguments?.length !== 1 ||
      !HandlerSources.isBuiltInPromise(unwrapped, scope.program)
    ) {
      return typeNode;
    }

    return unwrapped.typeArguments[0] ?? typeNode;
  },

  /**
   * Checks whether a type reference resolves to the built-in Promise.
   *
   * @param program The TypeScript program supplying source files and type information.
   * @param typeNode The declared type node under inspection.
   * @returns Whether the type is the built-in Promise.
   */
  isBuiltInPromise(typeNode: ts.TypeReferenceNode, program: ts.Program): boolean {
    const symbol = program.getTypeChecker().getTypeFromTypeNode(typeNode).getSymbol();
    return (
      symbol?.getName() === "Promise" &&
      symbol.declarations?.some((declaration) =>
        program.isSourceFileDefaultLibrary(declaration.getSourceFile()),
      ) === true
    );
  },

  /**
   * Checks whether a declared type is explicitly void.
   *
   * @param typeNode The declared type node under inspection.
   * @returns Whether the declared type is explicitly void.
   */
  isExplicitVoidType(typeNode: ts.TypeNode | undefined): boolean {
    if (typeNode === undefined) {
      return false;
    }
    if (ts.isParenthesizedTypeNode(typeNode)) {
      return HandlerSources.isExplicitVoidType(typeNode.type);
    }

    return typeNode.kind === ts.SyntaxKind.VoidKeyword;
  },

  /**
   * Checks whether a type reference names an array.
   *
   * @param typeNode The declared type node under inspection.
   * @returns Whether the type reference names an array.
   */
  isArrayReferenceType(typeNode: ts.TypeReferenceNode): boolean {
    return (
      ts.isIdentifier(typeNode.typeName) &&
      (typeNode.typeName.text === "Array" || typeNode.typeName.text === "ReadonlyArray")
    );
  },

  /**
   * Maps a handler decorator and input signal to the generated handler kind.
   *
   * @param decorator The decorator under inspection.
   * @param signalKind The resolved input signal kind.
   * @returns The generated handler kind for the decorator and input signal.
   */
  handlerKind(
    decorator: HandlerDecorator,
    signalKind: SignalKind | undefined,
  ): GeneratedHandlerKind {
    switch (decorator) {
      case "Assign":
        return "command-assignment";
      case "Command":
        return signalKind === "command" ? "command-substitution" : "command-reaction";
      case "React":
        return "event-reaction";
      case "Subscribe":
        return signalKind === "state" ? "state-subscription" : "event-subscription";
    }
  },

  /**
   * Checks whether a decorator accepts the resolved input signal kind.
   *
   * @param decorator The decorator under inspection.
   * @param kind The signal, modifier, or syntax kind being checked.
   * @returns Whether the decorator accepts the input signal kind.
   */
  acceptsSignalKind(decorator: HandlerDecorator, kind: SignalKind | undefined): boolean {
    if (decorator === "Command") {
      return kind === "command" || kind === "event" || kind === "rejection";
    }
    if (decorator === "Assign") {
      return kind === "command";
    }

    return (
      kind === "event" || kind === "rejection" || (decorator === "Subscribe" && kind === "state")
    );
  },

  /**
   * Describes the input signal expected by a handler decorator.
   *
   * @param decorator The decorator under inspection.
   * @returns The diagnostic description of the expected input signal.
   */
  signalMessage(decorator: HandlerDecorator): string {
    if (decorator === "Command") {
      return "a generated command, event, or rejection type";
    }
    if (decorator === "Assign") {
      return "a generated command type";
    }

    return decorator === "Subscribe"
      ? "a generated event, rejection, or Entity state type"
      : "a generated event or rejection type";
  },

  /**
   * Determines the generated signal kind emitted by a handler decorator.
   *
   * @param decorator The decorator under inspection.
   * @returns The emitted signal kind, or undefined for no emission.
   */
  emittedSignalKind(decorator: HandlerDecorator): SignalKind | undefined {
    if (decorator === "Command") {
      return "command";
    }
    if (decorator === "Assign" || decorator === "React") {
      return "event";
    }

    return undefined;
  },

  /**
   * Finds the handler input type and domestic or external origin.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param method The handler method name.
   * @param parameters The handler parameter declarations.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @returns The input type and domestic or external origin, or undefined when invalid.
   */
  externalOrigin(
    parameters: readonly ts.ParameterDeclaration[],
    scope: AnalyzerScope,
    className: string,
    method: string | undefined,
  ): { readonly value: "domestic" | "external"; readonly type: ts.TypeNode } | undefined {
    const first = parameters[0]?.type;
    if (first === undefined) return undefined;
    const marker = HandlerSources.externalMarker(first, scope);
    const laterMarker = parameters
      .slice(1)
      .some((parameter) =>
        parameter.type === undefined
          ? false
          : HandlerSources.containsExternalMarker(parameter.type, scope),
      );
    const nestedMarker =
      marker === undefined && HandlerSources.containsExternalMarker(first, scope);
    if (laterMarker || nestedMarker || (marker !== undefined && !marker.direct)) {
      HandlerTypes.pushDiagnostic(
        scope,
        "INVALID_EXTERNAL_ORIGIN",
        laterMarker ? (parameters[1]?.type ?? first) : first,
        "External<T> is valid only as the direct first receptor parameter type.",
        className,
        method,
      );
      return undefined;
    }
    if (marker?.direct === true && marker.type !== undefined) {
      return { value: "external", type: marker.type };
    }
    return { value: "domestic", type: first };
  },

  /**
   * Checks the optional context parameter for the input signal kind.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param method The handler method name.
   * @param parameters The handler parameter declarations.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @param signalKind The resolved input signal kind.
   * @returns Whether the context parameter matches the signal kind.
   */
  validContextParameter(
    parameters: readonly ts.ParameterDeclaration[],
    signalKind: SignalKind | undefined,
    scope: AnalyzerScope,
    className: string,
    method: string,
  ): boolean {
    if (parameters.length !== 2) return true;
    const context = parameters[1]?.type;
    const expected = signalKind === "command" ? "CommandContext" : "EventContext";
    if (context !== undefined && HandlerSources.isCanonicalContext(context, expected, scope)) {
      return true;
    }
    HandlerTypes.pushDiagnostic(
      scope,
      "INVALID_HANDLER_CONTEXT",
      context ?? parameters[1] ?? scope.source,
      `Two-argument handlers receiving ${
        signalKind === "command" ? "Commands" : "Events, rejections, or Entity states"
      } must declare ${expected} as their second parameter.`,
      className,
      method,
    );
    return false;
  },

  /**
   * Checks that a context type references the framework declaration.
   *
   * @param expected The canonical framework context type expected for this signal.
   * @param scope The current source, imports, program, and diagnostic collection.
   * @param type The checked or declared type under inspection.
   * @returns Whether the type is the framework context declaration.
   */
  isCanonicalContext(
    type: ts.TypeNode,
    expected: "CommandContext" | "EventContext",
    scope: AnalyzerScope,
  ): boolean {
    if (!ts.isTypeReferenceNode(type)) return false;
    if (ts.isIdentifier(type.typeName)) {
      return scope.imports.protoContextSymbols.get(type.typeName.text) === expected;
    }
    return (
      ts.isIdentifier(type.typeName.left) &&
      scope.imports.protoNamespaces.has(type.typeName.left.text) &&
      type.typeName.right.text === expected
    );
  },

  /**
   * Finds an External marker in a handler parameter type.
   *
   * @param scope The current source, imports, program, and diagnostic collection.
   * @param type The checked or declared type under inspection.
   * @returns The type wrapped by External, or undefined when absent or invalid.
   */
  externalMarker(
    type: ts.TypeNode,
    scope: AnalyzerScope,
  ): { readonly direct: boolean; readonly type?: ts.TypeNode } | undefined {
    if (!ts.isTypeReferenceNode(type)) return undefined;
    const canonical =
      (ts.isIdentifier(type.typeName) &&
        scope.imports.serverSymbols.get(type.typeName.text) === "External") ||
      (ts.isQualifiedName(type.typeName) &&
        ts.isIdentifier(type.typeName.left) &&
        type.typeName.right.text === "External" &&
        scope.imports.serverNamespaces.has(type.typeName.left.text));
    if (!canonical || !HandlerSources.isCanonicalExternal(type.typeName, scope.program))
      return undefined;
    const argument = type.typeArguments?.[0];
    return argument === undefined
      ? { direct: false }
      : { direct: type.typeArguments?.length === 1, type: argument };
  },

  /**
   * Finds nested type nodes for an External marker.
   *
   * @param scope The current source, imports, program, and diagnostic collection.
   * @param seen The declarations already visited during traversal.
   * @param type The checked or declared type under inspection.
   * @returns Whether a nested type contains the External marker.
   */
  containsExternalMarker(
    type: ts.TypeNode,
    scope: AnalyzerScope,
    seen: ReadonlySet<string> = new Set(),
  ): boolean {
    if (HandlerSources.externalMarker(type, scope) !== undefined) return true;
    if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
      const alias = scope.imports.localTypeAliases.get(type.typeName.text);
      if (alias !== undefined && !seen.has(type.typeName.text)) {
        const next = new Set(seen);
        next.add(type.typeName.text);
        if (HandlerSources.containsExternalMarker(alias, scope, next)) return true;
      }
    }
    let found = false;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (ts.isTypeNode(node) && HandlerSources.externalMarker(node, scope) !== undefined) {
        found = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(type, visit);
    return found;
  },

  /**
   * Checks that an External type names the framework declaration.
   *
   * @param name The symbol, class, or member name to resolve.
   * @param program The TypeScript program supplying source files and type information.
   * @returns Whether the type is the framework External declaration.
   */
  isCanonicalExternal(name: ts.EntityName, program: ts.Program): boolean {
    const checker = program.getTypeChecker();
    const location = ts.isQualifiedName(name) ? name.right : name;
    let symbol = checker.getSymbolAtLocation(location);
    if (symbol === undefined) return false;
    if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
      symbol = checker.getAliasedSymbol(symbol);
    }
    return (symbol.declarations ?? []).some(
      (declaration) =>
        ts.isTypeAliasDeclaration(declaration) &&
        declaration.name.text === "External" &&
        PackageIdentity.nameFor(declaration.getSourceFile().fileName) ===
          "@spine-event-engine/server" &&
        /^external(?:\.d)?\.ts$/u.test(
          declaration.getSourceFile().fileName.split(/[\\/]/u).at(-1) ?? "",
        ),
    );
  },

  /**
   * Creates a bounded traversal state for recursive type aliases.
   *
   * @returns A fresh bounded alias traversal state.
   */
  newTypeWalk(): TypeWalk {
    return { remaining: maxAliasDepth, seen: new Set() };
  },

  /**
   * Checks one alias traversal step and rejects repeated or excessive recursion.
   *
   * @param walk The bounded alias traversal state.
   * @returns Whether alias traversal can continue.
   */
  consumeTypeWalk(walk: TypeWalk): boolean {
    walk.remaining -= 1;

    return walk.remaining >= 0;
  },

  /**
   * Resolves a local type alias while guarding against recursive expansion.
   *
   * @param name The symbol, class, or member name to resolve.
   * @param resolveType The callback that inspects the expanded alias type.
   * @param typeNode The declared type node under inspection.
   * @param walk The bounded alias traversal state.
   * @typeParam T The result type produced by the alias callback.
   * @returns The callback result, or undefined when alias expansion cannot continue.
   */
  resolveAlias<T>(
    name: string,
    typeNode: ts.TypeNode,
    walk: TypeWalk,
    resolveType: (resolved: ts.TypeNode) => T | undefined,
  ): T | undefined {
    if (walk.seen.has(name)) {
      return undefined;
    }

    walk.seen.add(name);
    const resolved = resolveType(typeNode);
    walk.seen.delete(name);

    return resolved;
  },

  /**
   * Records framework and generated imports used by a source file.
   *
   * @param program The TypeScript program supplying source files and type information.
   * @param source The source file being inspected.
   * @returns The indexed imports and local aliases.
   */
  buildImportState(source: ts.SourceFile, program: ts.Program): ImportState {
    const state: MutableImportState = {
      generatedNamespaces: new Map(),
      generatedSymbols: new Map(),
      rejectionNamespaces: new Map(),
      rejectionSymbols: new Map(),
      localTypeAliases: new Map(),
      serverNamespaces: new Set(),
      serverSymbols: new Map(),
      protoNamespaces: new Set(),
      protoSymbols: new Set(),
      protoContextSymbols: new Map(),
    };

    for (const statement of source.statements) {
      HandlerSources.recordImportStatement(statement, source, program, state);
    }

    return state;
  },

  /**
   * Records one source import or local type alias.
   *
   * @param program The TypeScript program supplying source files and type information.
   * @param source The source file being inspected.
   * @param state The mutable import index receiving declarations.
   * @param statement The declaration or import statement being indexed.
   */
  recordImportStatement(
    statement: ts.Statement,
    source: ts.SourceFile,
    program: ts.Program,
    state: MutableImportState,
  ): void {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      HandlerSources.recordImportDeclaration(
        statement,
        statement.moduleSpecifier.text,
        source,
        program,
        state,
      );
    }
    if (ts.isTypeAliasDeclaration(statement)) {
      state.localTypeAliases.set(statement.name.text, statement.type);
    }
  },

  /**
   * Records the named bindings of an import declaration.
   *
   * @param moduleSpecifier The imported module path to resolve.
   * @param program The TypeScript program supplying source files and type information.
   * @param source The source file being inspected.
   * @param state The mutable import index receiving declarations.
   * @param statement The declaration or import statement being indexed.
   */
  recordImportDeclaration(
    statement: ts.ImportDeclaration,
    moduleSpecifier: string,
    source: ts.SourceFile,
    program: ts.Program,
    state: MutableImportState,
  ): void {
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined) return;
    HandlerSources.recordFrameworkImport(bindings, moduleSpecifier, state);
    if (HandlerSources.isGeneratedModule(moduleSpecifier)) {
      HandlerSources.recordGeneratedImport(
        bindings,
        moduleSpecifier,
        statement.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword,
        source,
        program,
        state,
      );
    }
    if (!HandlerSources.isRejectionCompanion(moduleSpecifier)) return;
    HandlerSources.recordRejectionCompanionImport(
      bindings,
      moduleSpecifier,
      source,
      program,
      state,
    );
  },

  /**
   * Records declarations imported from a framework module.
   *
   * @param bindings The named import bindings being indexed.
   * @param moduleSpecifier The imported module path to resolve.
   * @param state The mutable import index receiving declarations.
   */
  recordFrameworkImport(
    bindings: ts.NamedImportBindings,
    moduleSpecifier: string,
    state: MutableImportState,
  ): void {
    if (moduleSpecifier === "@spine-event-engine/server") {
      HandlerSources.recordServerImport(bindings, state);
    }
    if (moduleSpecifier === "@spine-event-engine/proto") {
      HandlerSources.recordProtoImport(bindings, state);
    }
  },

  /**
   * Records rejection schemas from a generated companion module.
   *
   * @param bindings The named import bindings being indexed.
   * @param moduleSpecifier The imported module path to resolve.
   * @param program The TypeScript program supplying source files and type information.
   * @param source The source file being inspected.
   * @param state The mutable import index receiving declarations.
   */
  recordRejectionCompanionImport(
    bindings: ts.NamedImportBindings,
    moduleSpecifier: string,
    source: ts.SourceFile,
    program: ts.Program,
    state: MutableImportState,
  ): void {
    const schemaModule = HandlerSources.rejectionSchemaModule(moduleSpecifier);
    const companion = HandlerSources.generatedModuleSource(source, moduleSpecifier, program);
    const companionSchemaModule =
      companion === undefined ? undefined : HandlerSources.rejectionSchemaImport(companion);
    const exported = HandlerSources.generatedModuleExports(
      companion ?? source,
      companionSchemaModule ?? schemaModule,
      program,
    );
    if (exported === undefined) return;
    if (ts.isNamespaceImport(bindings)) {
      state.rejectionNamespaces.set(bindings.name.text, {
        exports: exported,
        moduleSpecifier: schemaModule,
      });
      return;
    }
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const exportName = element.propertyName?.text ?? element.name.text;
      const schemaName = `${exportName}Schema`;
      if (exported.schemaRoles.get(schemaName) !== "rejection") continue;
      state.rejectionSymbols.set(element.name.text, {
        moduleSpecifier: schemaModule,
        exportName: schemaName,
      });
    }
  },

  /**
   * Finds the generated message module paired with a rejection companion.
   *
   * @param source The source file being inspected.
   * @returns The paired generated message module, or undefined when absent.
   */
  rejectionSchemaImport(source: ts.SourceFile): string | undefined {
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }
      const bindings = statement.importClause?.namedBindings;
      if (
        bindings !== undefined &&
        !ts.isNamespaceImport(bindings) &&
        bindings.elements.some((element) =>
          (element.propertyName?.text ?? element.name.text).endsWith("Schema"),
        )
      ) {
        return statement.moduleSpecifier.text;
      }
    }
    return undefined;
  },

  /**
   * Records server decorators and receiver bases from an import.
   *
   * @param bindings The named import bindings being indexed.
   * @param state The mutable import index receiving declarations.
   */
  recordServerImport(bindings: ts.NamedImportBindings, state: MutableImportState): void {
    if (ts.isNamespaceImport(bindings)) {
      state.serverNamespaces.add(bindings.name.text);
      return;
    }

    for (const element of bindings.elements) {
      state.serverSymbols.set(element.name.text, element.propertyName?.text ?? element.name.text);
    }
  },

  /**
   * Records framework context and External types from an import.
   *
   * @param bindings The named import bindings being indexed.
   * @param state The mutable import index receiving declarations.
   */
  recordProtoImport(bindings: ts.NamedImportBindings, state: MutableImportState): void {
    if (ts.isNamespaceImport(bindings)) {
      state.protoNamespaces.add(bindings.name.text);
      return;
    }

    for (const element of bindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported === "Event" || imported === "Command") {
        state.protoSymbols.add(element.name.text);
      }
      if (imported === "CommandContext" || imported === "EventContext") {
        state.protoContextSymbols.set(element.name.text, imported);
      }
    }
  },

  /**
   * Records generated message types and schema values from an import.
   *
   * @param bindings The named import bindings being indexed.
   * @param moduleSpecifier The imported module path to resolve.
   * @param program The TypeScript program supplying source files and type information.
   * @param source The source file being inspected.
   * @param state The mutable import index receiving declarations.
   * @param valueImport Whether the import includes a runtime value.
   */
  recordGeneratedImport(
    bindings: ts.NamedImportBindings,
    moduleSpecifier: string,
    valueImport: boolean,
    source: ts.SourceFile,
    program: ts.Program,
    state: MutableImportState,
  ): void {
    const exported = HandlerSources.generatedModuleExports(source, moduleSpecifier, program);
    if (exported === undefined) {
      return;
    }

    if (ts.isNamespaceImport(bindings)) {
      state.generatedNamespaces.set(bindings.name.text, { exports: exported, moduleSpecifier });
      return;
    }

    for (const element of bindings.elements) {
      const exportName = element.propertyName?.text ?? element.name.text;
      if (!HandlerTypes.hasGeneratedType(exported, exportName)) {
        continue;
      }

      const schemaExportName = `${exportName}Schema`;
      state.generatedSymbols.set(element.name.text, {
        exports: exported,
        moduleSpecifier,
        exportName,
        kind: exported.schemaRoles.get(schemaExportName),
        schemaExportName: exported.values.has(schemaExportName) ? schemaExportName : undefined,
        schemaValue: valueImport && !element.isTypeOnly && exported.values.has(exportName),
      });
    }
  },

  /**
   * Checks whether a module path denotes generated code.
   *
   * @param moduleSpecifier The imported module path to resolve.
   * @returns Whether the module path denotes generated code.
   */
  isGeneratedModule(moduleSpecifier: string): boolean {
    return /(^|\/)generated\/.+_pb(\.js)?$/.test(moduleSpecifier);
  },

  /**
   * Checks whether a module path denotes a rejection companion.
   *
   * @param moduleSpecifier The imported module path to resolve.
   * @returns Whether the module path denotes a rejection companion.
   */
  isRejectionCompanion(moduleSpecifier: string): boolean {
    return /(^|\/)generated\/(?:.+\/)?(?:[^/]+_)?rejections(\.js)?$/u.test(moduleSpecifier);
  },

  /**
   * Finds the message module paired with a rejection companion.
   *
   * @param moduleSpecifier The imported module path to resolve.
   * @returns The paired generated message module path.
   */
  rejectionSchemaModule(moduleSpecifier: string): string {
    return moduleSpecifier.endsWith(".js")
      ? moduleSpecifier.replace(/\.js$/u, "_pb.js")
      : `${moduleSpecifier}_pb`;
  },

  /**
   * Reads generated type, value, and schema exports from a module.
   *
   * @param moduleSpecifier The imported module path to resolve.
   * @param program The TypeScript program supplying source files and type information.
   * @param source The source file being inspected.
   * @returns The generated module's indexed exports, or undefined when unresolved.
   */
  generatedModuleExports(
    source: ts.SourceFile,
    moduleSpecifier: string,
    program: ts.Program,
  ): GeneratedExports | undefined {
    const module = HandlerSources.generatedModuleSource(source, moduleSpecifier, program);

    if (module === undefined) return undefined;
    const declarations = HandlerSources.exportedNames(module);
    const runtime = HandlerSources.pairedRuntimeExports(module);
    if (runtime === undefined) return declarations;
    return {
      types: declarations.types,
      values: runtime.values,
      schemaRoles: runtime.schemaRoles,
    };
  },

  /**
   * Finds runtime exports paired with generated type declarations.
   *
   * @param declarations The generated declaration source file.
   * @returns The paired runtime export index, or undefined when absent.
   */
  pairedRuntimeExports(declarations: ts.SourceFile): GeneratedExports | undefined {
    if (!declarations.isDeclarationFile) return undefined;
    const runtimePath = declarations.fileName.replace(/\.d\.ts$/u, ".js");
    try {
      return HandlerSources.exportedNames(
        ts.createSourceFile(runtimePath, readFileSync(runtimePath, "utf8"), ts.ScriptTarget.Latest),
      );
    } catch {
      return undefined;
    }
  },

  /**
   * Resolves the source file for a generated module.
   *
   * @param moduleSpecifier The imported module path to resolve.
   * @param program The TypeScript program supplying source files and type information.
   * @param source The source file being inspected.
   * @returns The generated module source file, or undefined when unresolved.
   */
  generatedModuleSource(
    source: ts.SourceFile,
    moduleSpecifier: string,
    program: ts.Program,
  ): ts.SourceFile | undefined {
    const imported = HandlerSources.importedModuleSource(source, moduleSpecifier, program);
    if (imported !== undefined) {
      return imported;
    }
    const resolved = ts.resolveModuleName(
      moduleSpecifier,
      source.fileName,
      program.getCompilerOptions(),
      ts.sys,
    ).resolvedModule?.resolvedFileName;
    const base = resolve(dirname(source.fileName), moduleSpecifier);
    const candidates = HandlerSources.uniqueStrings([
      ...(resolved === undefined ? [] : [resolved]),
      base.replace(/\.js$/, ".ts"),
      `${base}.ts`,
      base,
      base.replace(/\.js$/, ".d.ts"),
      `${base}.d.ts`,
    ]);
    const sourceFiles = new Map(
      program.getSourceFiles().map((candidate) => [resolve(candidate.fileName), candidate]),
    );

    for (const candidate of candidates) {
      const sourceFile = sourceFiles.get(candidate);
      if (sourceFile !== undefined) {
        return sourceFile;
      }
    }

    return undefined;
  },

  /**
   * Resolves a module import to a source file in the program.
   *
   * @param moduleSpecifier The imported module path to resolve.
   * @param program The TypeScript program supplying source files and type information.
   * @param source The source file being inspected.
   * @returns The imported source file, or undefined when unresolved.
   */
  importedModuleSource(
    source: ts.SourceFile,
    moduleSpecifier: string,
    program: ts.Program,
  ): ts.SourceFile | undefined {
    const declaration = source.statements.find(
      (statement): statement is ts.ImportDeclaration =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === moduleSpecifier,
    );
    if (declaration === undefined) return undefined;

    const symbol = program.getTypeChecker().getSymbolAtLocation(declaration.moduleSpecifier);
    const imported = symbol?.declarations
      ?.map((candidate) => candidate.getSourceFile())
      .find((candidate) => candidate !== source);
    return imported;
  },

  /**
   * Returns strings while preserving their first occurrence.
   *
   * @param values The strings to deduplicate.
   * @returns The distinct strings in first-seen order.
   */
  uniqueStrings(values: readonly string[]): readonly string[] {
    return [...new Set(values)];
  },

  /**
   * Records generated type, value, and schema exports in a source file.
   *
   * @param source The source file being inspected.
   * @returns The indexed type, value, and schema exports.
   */
  exportedNames(source: ts.SourceFile): GeneratedExports {
    const files = HandlerSources.generatedFiles(source);
    const schemaRoles = new Map<string, SignalKind | undefined>();
    const exports = { types: new Set<string>(), values: new Set<string>(), schemaRoles };

    for (const statement of source.statements) {
      HandlerSources.recordExportedNames(statement, exports, files);
    }

    return exports;
  },

  /**
   * Records file descriptors declared by generated code.
   *
   * @param source The source file being inspected.
   * @returns The generated file descriptors indexed by declaration.
   */
  generatedFiles(source: ts.SourceFile): ReadonlyMap<string, GeneratedFile> {
    const files = new Map<string, GeneratedFile>();

    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) {
        continue;
      }
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          continue;
        }
        const descriptor = HandlerSources.fileDescriptor(declaration.initializer);
        if (descriptor !== undefined) {
          files.set(declaration.name.text, descriptor);
        }
      }
    }

    return files;
  },

  /**
   * Records an exported declaration and its schema role.
   *
   * @param exports The generated export index to update or inspect.
   * @param files The generated file descriptors indexed for this source.
   * @param statement The declaration or import statement being indexed.
   */
  recordExportedNames(
    statement: ts.Statement,
    exports: GeneratedExports,
    files: ReadonlyMap<string, GeneratedFile>,
  ): void {
    if (
      ts.isVariableStatement(statement) &&
      HandlerTypes.hasModifier(statement, ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          exports.values.add(declaration.name.text);
          const schemaRole = HandlerSources.schemaRoleFromInitializer(
            declaration.name.text,
            declaration.initializer,
            files,
          );
          if (schemaRole.found) {
            exports.schemaRoles.set(declaration.name.text, schemaRole.kind);
          }
        }
      }
    }

    if (HandlerTypes.hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      HandlerTypes.recordNamedExport(statement, exports);
    }
  },

  /**
   * Determines a generated schema's signal role from its initializer.
   *
   * @param files The generated file descriptors indexed for this source.
   * @param initializer The generated declaration initializer to inspect.
   * @param schemaExportName The generated schema export name being classified.
   * @returns The schema's signal kind, or undefined when unknown.
   */
  schemaRoleFromInitializer(
    schemaExportName: string,
    initializer: ts.Expression | undefined,
    files: ReadonlyMap<string, GeneratedFile>,
  ): { readonly found: boolean; readonly kind: SignalKind | undefined } {
    const call = HandlerSources.callExpression(initializer, "messageDesc");
    if (call === undefined) {
      return { found: false, kind: undefined };
    }
    const fileName = call.arguments[0];
    if (fileName === undefined || !ts.isIdentifier(fileName)) {
      return { found: false, kind: undefined };
    }
    const file = files.get(fileName.text);
    if (file === undefined) {
      return { found: true, kind: undefined };
    }
    const indexes = HandlerSources.messageDescIndexes(call);
    const message = HandlerSources.descriptorMessageAt(file, indexes);
    const messageName = message?.exportName;
    const expectedName = schemaExportName.replace(/Schema$/, "");
    if (messageName === undefined || messageName !== expectedName) {
      return { found: true, kind: undefined };
    }

    return {
      found: true,
      kind: message?.descriptor.isEntityState
        ? "state"
        : HandlerSources.signalKindFromProto(file.sourceFile, indexes),
    };
  },

  /**
   * Finds descriptor message indexes in a generated declaration call.
   *
   * @param call The call expression being inspected.
   * @returns The descriptor index path, or undefined when absent.
   */
  messageDescIndexes(call: ts.CallExpression): readonly number[] | undefined {
    const indexes: number[] = [];
    for (const argument of call.arguments.slice(1)) {
      if (!ts.isNumericLiteral(argument)) {
        return undefined;
      }
      const index = Number(argument.text);
      if (!Number.isInteger(index) || index < 0) {
        return undefined;
      }
      indexes.push(index);
    }

    return indexes.length === 0 ? undefined : indexes;
  },

  /**
   * Gets a nested message descriptor by index path.
   *
   * @param file The generated file descriptor or source path under inspection.
   * @param indexes The nested descriptor index path.
   * @returns The selected nested descriptor, or undefined for invalid indexes.
   */
  descriptorMessageAt(
    file: GeneratedFile,
    indexes: readonly number[] | undefined,
  ): DescriptorMessageSelection | undefined {
    if (indexes === undefined) {
      return undefined;
    }
    let messages = file.messages;
    let message: DescriptorMessage | undefined;
    const path: string[] = [];

    for (const index of indexes) {
      message = messages[index];
      if (message === undefined) {
        return undefined;
      }
      path.push(message.name);
      messages = message.nested;
    }

    return message === undefined ? undefined : { descriptor: message, exportName: path.join("_") };
  },

  /**
   * Reads a file descriptor from a generated initializer.
   *
   * @param initializer The generated declaration initializer to inspect.
   * @returns The decoded file descriptor, or undefined when invalid.
   */
  fileDescriptor(initializer: ts.Expression | undefined): GeneratedFile | undefined {
    const call = HandlerSources.callExpression(initializer, "fileDesc");
    const descriptor = call?.arguments[0];
    if (descriptor === undefined || !ts.isStringLiteralLike(descriptor)) {
      return undefined;
    }

    try {
      const { protobuf, protobufWkt } = PackageDependencies.current();
      const file = protobuf.fromBinary(
        protobufWkt.FileDescriptorProtoSchema,
        Buffer.from(descriptor.text, "base64"),
      );
      return file.name === ""
        ? undefined
        : {
            sourceFile: file.name,
            messages: file.messageType.map(HandlerSources.descriptorMessage),
          };
    } catch {
      return undefined;
    }
  },

  /**
   * Removes an expression when it calls a named function.
   *
   * @param expression The expression being inspected.
   * @param functionName The expected called function name.
   * @returns The matching call expression, or undefined when the function differs.
   */
  callExpression(
    expression: ts.Expression | undefined,
    functionName: string,
  ): ts.CallExpression | undefined {
    if (expression === undefined) {
      return undefined;
    }
    const unwrapped = HandlerSources.unwrapExpression(expression);
    if (!ts.isCallExpression(unwrapped) || !ts.isIdentifier(unwrapped.expression)) {
      return undefined;
    }

    return unwrapped.expression.text === functionName ? unwrapped : undefined;
  },

  /**
   * Removes syntactic wrappers from an expression.
   *
   * @param expression The expression being inspected.
   * @returns The expression after removing syntactic wrappers.
   */
  unwrapExpression(expression: ts.Expression): ts.Expression {
    if (ts.isParenthesizedExpression(expression)) {
      return HandlerSources.unwrapExpression(expression.expression);
    }
    if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
      return HandlerSources.unwrapExpression(expression.expression);
    }

    return expression;
  },

  /**
   * Determines a generated message's signal kind from its descriptor.
   *
   * @param messageIndexes The nested message indexes within the file descriptor.
   * @param sourceFile The receiver source path.
   * @returns The message's signal kind, or undefined when unresolved.
   */
  signalKindFromProto(
    sourceFile: string,
    messageIndexes: readonly number[] | undefined,
  ): SignalKind | undefined {
    const sourceName = sourceFile.split(/[\\/]/u).at(-1);
    if (sourceName === "rejections.proto" || sourceName?.endsWith("_rejections.proto") === true) {
      return messageIndexes?.length === 1 ? "rejection" : undefined;
    }
    if (sourceName === "commands.proto" || sourceName?.endsWith("_commands.proto") === true) {
      return "command";
    }
    if (sourceName === "events.proto" || sourceName?.endsWith("_events.proto") === true) {
      return "event";
    }

    return undefined;
  },

  /**
   * Reads a message name, entity option, and nested descriptors.
   *
   * @param message The descriptor message or diagnostic text being inspected.
   * @returns The message descriptor summary including nested messages.
   */
  descriptorMessage(message: ProtobufWkt.DescriptorProto): DescriptorMessage {
    return {
      name: message.name,
      isEntityState:
        message.options?.$unknown?.some((field) => field.no === entityOptionFieldNumber) === true,
      nested: message.nestedType.map(HandlerSources.descriptorMessage),
    };
  },
});

/**
 * Finds the package identity that owns an analyzed source file.
 */
export const PackageIdentity: Readonly<{ nameFor(sourceFile: string): string | undefined }> =
  Object.freeze({
    nameFor(sourceFile: string): string | undefined {
      let directory = resolve(dirname(sourceFile));
      let manifest = join(directory, "package.json");
      while (!existsSync(manifest)) {
        const parent = dirname(directory);
        if (parent === directory) return undefined;
        directory = parent;
        manifest = join(directory, "package.json");
      }
      try {
        const { name } = JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown };
        return typeof name === "string" ? name : undefined;
      } catch {
        return undefined;
      }
    },
  });

const PackageDependencies = Object.freeze({
  /**
   * Loads Protobuf dependencies for the analyzed program.
   *
   * @param program The TypeScript program supplying source files and type information.
   */
  load(program: ts.Program): void {
    packageDependencies ??= {
      protobuf: PackageDependencies.require("@bufbuild/protobuf", program) as typeof Protobuf,
      protobufWkt: PackageDependencies.require(
        "@bufbuild/protobuf/wkt",
        program,
      ) as typeof ProtobufWkt,
    };
  },

  /**
   * Returns the Protobuf dependencies loaded for analysis.
   *
   * @returns The loaded Protobuf runtime modules.
   */
  current(): { readonly protobuf: typeof Protobuf; readonly protobufWkt: typeof ProtobufWkt } {
    if (packageDependencies === undefined)
      throw new Error("Build handler analyzer dependencies are not loaded.");
    return packageDependencies;
  },

  /**
   * Resolves a dependency from the analyzer or application package boundary.
   *
   * @param program The TypeScript program supplying source files and type information.
   * @param specifier The dependency module specifier.
   * @returns The resolved module exports.
   */
  require(specifier: string, program: ts.Program): unknown {
    try {
      return createRequire(import.meta.url)(specifier);
    } catch (directError) {
      const appRoot = program.getRootFileNames()[0];
      if (appRoot === undefined) throw directError;
      const applicationRequire = createRequire(appRoot);
      try {
        return applicationRequire(specifier);
      } catch {
        // The in-repository generator transpiles this module into a temporary
        // cache directory. A fresh workspace install has the descriptor
        // package at the application's resolution boundary, while the
        // temporary module has no package boundary of its own.
      }
      try {
        const toolingEntry = applicationRequire.resolve("@spine-event-engine/proto-tools");
        return createRequire(join(PackageDependencies.rootFor(toolingEntry), "package.json"))(
          specifier,
        );
      } catch {
        throw directError;
      }
    }
  },

  /**
   * Finds the package directory containing an entry point.
   *
   * @param entry The resolved package entry path.
   * @returns The containing package directory.
   */
  rootFor(entry: string): string {
    let directory = dirname(entry);
    while (!existsSync(join(directory, "package.json"))) {
      const parent = dirname(directory);
      if (parent === directory) throw new Error("Cannot locate proto-tools package manifest.");
      directory = parent;
    }
    return directory;
  },
});

const HandlerTypes = Object.freeze({
  /**
   * Records a generated declaration's type and value exports.
   *
   * @param exports The generated export index to update or inspect.
   * @param statement The declaration or import statement being indexed.
   */
  recordNamedExport(statement: ts.Statement, exports: GeneratedExports): void {
    if (ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) {
      const name = statement.name;
      if (name !== undefined) {
        exports.types.add(name.text);
        exports.values.add(name.text);
      }
      return;
    }
    if (ts.isFunctionDeclaration(statement)) {
      const name = statement.name;
      if (name !== undefined) {
        exports.values.add(name.text);
      }
      return;
    }
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      exports.types.add(statement.name.text);
    }
  },

  /**
   * Checks whether generated exports contain a named type or value.
   *
   * @param exports The generated export index to update or inspect.
   * @param name The symbol, class, or member name to resolve.
   * @returns Whether the exports include the named generated type or value.
   */
  hasGeneratedType(exports: GeneratedExports, name: string): boolean {
    return exports.types.has(name) || exports.values.has(name);
  },

  /**
   * Checks a Spine server decorator name.
   *
   * @param name The symbol, class, or member name to resolve.
   * @returns The recognized server decorator name, or undefined otherwise.
   */
  serverDecorator(name: string | undefined): ServerDecorator | undefined {
    return name === "Assign" ||
      name === "Command" ||
      name === "React" ||
      name === "Subscribe" ||
      name === "Apply" ||
      name === "Where" ||
      name === "Throws"
      ? name
      : undefined;
  },

  /**
   * Reads a handler method's identifier or string literal name.
   *
   * @param node The syntax node being inspected.
   * @returns The identifier or string literal method name, or undefined otherwise.
   */
  methodName(node: ts.MethodDeclaration): string | undefined {
    if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) {
      return node.name.text;
    }

    return undefined;
  },

  /**
   * Checks whether a syntax node carries a modifier.
   *
   * @param kind The signal, modifier, or syntax kind being checked.
   * @param node The syntax node being inspected.
   * @returns Whether the node has the requested modifier.
   */
  hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    return (
      ts.canHaveModifiers(node) &&
      (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind)
    );
  },

  /**
   * Reads a dotted name from an identifier or property access.
   *
   * @param expression The expression being inspected.
   * @returns The dotted expression name, or undefined for unsupported expressions.
   */
  expressionName(expression: ts.Expression): string | undefined {
    if (ts.isIdentifier(expression)) {
      return expression.text;
    }
    if (ts.isPropertyAccessExpression(expression)) {
      const prefix = HandlerTypes.expressionName(expression.expression);
      return prefix === undefined ? undefined : `${prefix}.${expression.name.text}`;
    }

    return undefined;
  },

  /**
   * Adds a located handler diagnostic to the analysis scope.
   *
   * @param className The receiver class name used in records and diagnostics.
   * @param code The diagnostic code to report.
   * @param message The descriptor message or diagnostic text being inspected.
   * @param methodNameValue The optional method name included in the diagnostic.
   * @param node The syntax node being inspected.
   * @param scope The current source, imports, program, and diagnostic collection.
   */
  pushDiagnostic(
    scope: AnalyzerScope,
    code: BuildHandlerDiagnosticCode,
    node: ts.Node,
    message: string,
    className?: string,
    methodNameValue?: string,
  ): void {
    const location = scope.source.getLineAndCharacterOfPosition(node.getStart(scope.source));
    const base = {
      code,
      sourceFile: scope.source.fileName,
      line: location.line + 1,
      column: location.character + 1,
      message,
    };

    scope.diagnostics.push({
      ...base,
      ...(className === undefined ? {} : { className }),
      ...(methodNameValue === undefined ? {} : { methodName: methodNameValue }),
    });
  },

  /**
   * Converts a TypeScript syntax error to a handler diagnostic.
   *
   * @param diagnostic The TypeScript diagnostic to convert.
   * @param source The source file being inspected.
   * @returns A located handler diagnostic for the syntax error.
   */
  syntaxDiagnostic(
    source: ts.SourceFile,
    diagnostic: ts.DiagnosticWithLocation,
  ): BuildHandlerDiagnostic {
    const location = source.getLineAndCharacterOfPosition(diagnostic.start);

    return {
      code: "TYPESCRIPT_SYNTAX_ERROR",
      sourceFile: source.fileName,
      line: location.line + 1,
      column: location.character + 1,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    };
  },
});
