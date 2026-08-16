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
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import type * as Protobuf from "@bufbuild/protobuf";
import type * as ProtobufWkt from "@bufbuild/protobuf/wkt";
import ts from "typescript";

import type {
  GeneratedHandlerKind,
  GeneratedHandlerParameterCount,
} from "./generated-handler-registry.js";

/**
 * Build-time analysis result for bare decorated entity handler methods.
 */
export interface BuildHandlerAnalysis {
  // prettier-ignore

  /**
   * Entity groups in source-file and class declaration order.
   */
  readonly entities: readonly BuildEntityHandlers[];

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
  readonly signalSchema: SchemaReference;

  /**
   * Generated schemas emitted by the handler return type.
   */
  readonly emittedSchemas: readonly SchemaReference[];

  /**
   * Public method arity: `handler(signal)` or `handler(signal, context)`.
   */
  readonly parameterCount: GeneratedHandlerParameterCount;

  /** Origin declared on the first receptor parameter. */
  readonly origin: "domestic" | "external";

  /**
   * Optional statically declared Event field filter.
   */
  readonly where?: BuildWhereOptions;
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

/**
 * Stable diagnostic codes emitted by build-time handler analysis.
 */
export type BuildHandlerDiagnosticCode =
  | "APPLY_DECORATOR"
  | "FRAMEWORK_ENVELOPE_RETURN"
  | "INVALID_EMITTED_SCHEMA"
  | "INVALID_HANDLER_NAME"
  | "INVALID_HANDLER_VISIBILITY"
  | "INVALID_PARAMETER_COUNT"
  | "INVALID_SIGNAL_TYPE"
  | "INVALID_EXTERNAL_ORIGIN"
  | "EXTERNAL_COMMAND_RECEIVER"
  | "INVALID_SUBSCRIBE_RETURN"
  | "INVALID_WHERE"
  | "MISSING_EMITTED_SCHEMAS"
  | "MISSING_ENTITY_STATE_SCHEMA"
  | "MISSING_RETURN_TYPE"
  | "MISSING_SIGNAL_TYPE"
  | "NON_EXPORTED_ENTITY_CLASS"
  | "SCHEMA_BEARING_DECORATOR"
  | "TYPESCRIPT_SYNTAX_ERROR"
  | "UNSUPPORTED_ENTITY_EXPORT"
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
   * Inspects source files and returns entity handler records with deterministic diagnostics.
   *
   * @param program TypeScript program that owns the source files and diagnostics.
   * @param sourceFiles Application source files to inspect; defaults to program files.
   * @returns Entity handler records and deterministic diagnostics.
   */
  analyze(program: ts.Program, sourceFiles?: readonly ts.SourceFile[]): BuildHandlerAnalysis;
}

/**
 * Provides build-time analysis for bare Spine handler decorators.
 */
export const BuildHandlerAnalyzer: BuildHandlerAnalyzer = Object.freeze({
  // prettier-ignore

  /**
   * Inspects source files and returns entity handler records with deterministic diagnostics.
   *
   * @param program TypeScript program that owns the source files and diagnostics.
   * @param sourceFiles Application source files to inspect; defaults to program files.
   * @returns Entity handler records and deterministic diagnostics.
   */
  analyze(
    program: ts.Program,
    sourceFiles: readonly ts.SourceFile[] = HandlerSources.appSourceFiles(program),
  ): BuildHandlerAnalysis {
    const entities: BuildEntityHandlers[] = [];
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
      entities.push(...HandlerSources.analyzeSource(scope));
    }

    return { entities, diagnostics };
  },
});

interface AnalyzerScope {
  readonly program: ts.Program;
  readonly source: ts.SourceFile;
  readonly imports: ImportState;
  readonly diagnostics: BuildHandlerDiagnostic[];
}

interface ImportState {
  readonly generatedNamespaces: ReadonlyMap<string, GeneratedNamespace>;
  readonly generatedSymbols: ReadonlyMap<string, GeneratedSymbol>;
  readonly localTypeAliases: ReadonlyMap<string, ts.TypeNode>;
  readonly serverNamespaces: ReadonlySet<string>;
  readonly serverSymbols: ReadonlyMap<string, string>;
  readonly protoNamespaces: ReadonlySet<string>;
  readonly protoSymbols: ReadonlySet<string>;
}

interface MutableImportState {
  readonly generatedNamespaces: Map<string, GeneratedNamespace>;
  readonly generatedSymbols: Map<string, GeneratedSymbol>;
  readonly localTypeAliases: Map<string, ts.TypeNode>;
  readonly serverNamespaces: Set<string>;
  readonly serverSymbols: Map<string, string>;
  readonly protoNamespaces: Set<string>;
  readonly protoSymbols: Set<string>;
}

interface GeneratedNamespace {
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
type ServerDecorator = HandlerDecorator | "Apply" | "Where";
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
const maxAliasDepth = 50;
// `spine.options.entity` in the frozen `spine/options.proto` contract.
const entityOptionFieldNumber = 73903;
const protobuf = requirePackage("@bufbuild/protobuf") as typeof Protobuf;
const protobufWkt = requirePackage("@bufbuild/protobuf/wkt") as typeof ProtobufWkt;

const HandlerSources = Object.freeze({
  appSourceFiles(program: ts.Program): readonly ts.SourceFile[] {
    return program.getSourceFiles().filter((source) => !source.isDeclarationFile);
  },

  analyzeSource(scope: AnalyzerScope): readonly BuildEntityHandlers[] {
    const entities: BuildEntityHandlers[] = [];

    for (const statement of scope.source.statements) {
      if (!ts.isClassDeclaration(statement) || statement.name === undefined) {
        continue;
      }

      const entity = HandlerSources.analyzeClass(statement, scope);
      if (entity !== undefined) {
        entities.push(entity);
      }
    }

    return entities;
  },

  analyzeClass(node: ts.ClassDeclaration, scope: AnalyzerScope): BuildEntityHandlers | undefined {
    const className = node.name?.text ?? "(anonymous)";
    const exportIssue = HandlerSources.entityExportIssue(node, scope.source);
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

    const stateSchema = HandlerSources.entityStateSchema(node, scope.imports);
    const handlers: BuildHandlerRecord[] = [];

    for (const member of node.members) {
      if (!ts.isMethodDeclaration(member)) {
        continue;
      }

      const handler = HandlerSources.analyzeMethod(member, className, stateSchema, scope);
      if (handler !== undefined) {
        handlers.push(handler);
      }
    }

    if (stateSchema === undefined || handlers.length === 0) {
      return undefined;
    }

    return { className, sourceFile: scope.source.fileName, stateSchema, handlers };
  },

  analyzeMethod(
    node: ts.MethodDeclaration,
    className: string,
    stateSchema: SchemaReference | undefined,
    scope: AnalyzerScope,
  ): BuildHandlerRecord | undefined {
    const decorators = HandlerSources.methodDecorators(node, scope.imports);
    const apply = decorators.find((decorator) => decorator.name === "Apply");
    const handler = decorators.find(HandlerSources.isHandlerUse);
    const whereUses = decorators.filter((decorator) => decorator.name === "Where");

    if (apply !== undefined) {
      HandlerTypes.pushDiagnostic(
        scope,
        "APPLY_DECORATOR",
        apply.node,
        "Generated registries do not support @Apply.",
        className,
        HandlerTypes.methodName(node),
      );
    }
    if (handler === undefined) {
      if (whereUses.length > 0) {
        HandlerTypes.pushDiagnostic(
          scope,
          "INVALID_WHERE",
          whereUses[0]?.node ?? node,
          "@Where requires an Event-consuming @Subscribe, @React, or @Command handler.",
          className,
          HandlerTypes.methodName(node),
        );
      }
      return undefined;
    }

    const method = HandlerTypes.methodName(node);
    const invalid = HandlerSources.validateHandlerNode(
      node,
      handler.name,
      stateSchema,
      scope,
      className,
      method,
    );
    if (handler.hasArguments) {
      HandlerTypes.pushDiagnostic(
        scope,
        "SCHEMA_BEARING_DECORATOR",
        handler.node,
        `@${handler.name}(...) is not supported in analyzed app source.`,
        className,
        method,
      );
      return undefined;
    }
    if (invalid) {
      return undefined;
    }

    const origin = HandlerSources.externalOrigin(node.parameters, scope, className, method);
    if (origin === undefined) return undefined;
    const signal = HandlerSources.schemaUseFromType(origin.type, scope.imports);
    const signalSchema = signal?.reference;
    const emittedSchemas = HandlerSources.emittedSchemaUses(
      node.type,
      handler.name,
      scope.imports,
    )?.map((schema) => schema.reference);
    if (signalSchema === undefined || emittedSchemas === undefined || method === undefined) {
      return undefined;
    }
    const where = HandlerSources.whereDeclaration(
      whereUses,
      handler,
      signal?.kind,
      scope,
      className,
      method,
    );
    if (whereUses.length > 0 && where === undefined) {
      return undefined;
    }

    return {
      kind: HandlerSources.handlerKind(handler.name, signal?.kind),
      methodName: method,
      signalSchema,
      emittedSchemas,
      parameterCount: node.parameters.length as GeneratedHandlerParameterCount,
      origin: origin.value,
      ...(where === undefined ? {} : { where }),
    };
  },

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

  hasDecoratedMethod(node: ts.ClassDeclaration, imports: ImportState): boolean {
    return node.members.some(
      (member) =>
        ts.isMethodDeclaration(member) &&
        HandlerSources.methodDecorators(member, imports).length > 0,
    );
  },

  entityExportIssue(
    node: ts.ClassDeclaration,
    source: ts.SourceFile,
  ): { readonly code: BuildHandlerDiagnosticCode; readonly message: string } | undefined {
    if (HandlerTypes.hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
      return {
        code: "UNSUPPORTED_ENTITY_EXPORT",
        message: "Decorated entity classes must use named exports, not default exports.",
      };
    }
    if (HandlerTypes.hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
      return undefined;
    }
    if (node.name !== undefined && HandlerSources.hasNamedClassExport(node.name.text, source)) {
      return undefined;
    }

    return {
      code: "NON_EXPORTED_ENTITY_CLASS",
      message: "Decorated entity classes must be exported for generated registry imports.",
    };
  },

  hasNamedClassExport(className: string, source: ts.SourceFile): boolean {
    return source.statements.some(
      (statement) =>
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier === undefined &&
        statement.exportClause !== undefined &&
        HandlerSources.namedExportIncludes(statement.exportClause, className),
    );
  },

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

  validateHandlerNode(
    node: ts.MethodDeclaration,
    decorator: HandlerDecorator,
    stateSchema: SchemaReference | undefined,
    scope: AnalyzerScope,
    className: string,
    method: string | undefined,
  ): boolean {
    return [
      HandlerSources.validateEntityState(node, stateSchema, scope, className, method),
      HandlerSources.validateName(node, scope, className),
      HandlerSources.validateVisibility(node, scope, className, method),
      HandlerSources.validateParameters(node, decorator, scope, className, method),
      HandlerSources.validateReturn(node, decorator, scope, className, method),
    ].some(Boolean);
  },

  validateEntityState(
    node: ts.MethodDeclaration,
    stateSchema: SchemaReference | undefined,
    scope: AnalyzerScope,
    className: string,
    method: string | undefined,
  ): boolean {
    if (stateSchema !== undefined) {
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

    const envelope = HandlerSources.frameworkEnvelope(node.type, scope.imports);
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

    return HandlerSources.validateEmittedReturn(node, decorator, scope, className, method);
  },

  validateSubscribeReturn(
    node: ts.MethodDeclaration,
    scope: AnalyzerScope,
    className: string,
    method: string | undefined,
  ): boolean {
    if (node.type?.kind === ts.SyntaxKind.VoidKeyword) {
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

  validateEmittedReturn(
    node: ts.MethodDeclaration,
    decorator: HandlerDecorator,
    scope: AnalyzerScope,
    className: string,
    method: string | undefined,
  ): boolean {
    const schemas = HandlerSources.emittedSchemaUses(node.type, decorator, scope.imports);
    if (schemas === undefined) {
      HandlerTypes.pushDiagnostic(
        scope,
        "UNSUPPORTED_RETURN_TYPE",
        node.type ?? node,
        `@${decorator} return type must resolve to generated schema references.`,
        className,
        method,
      );
      return true;
    }
    const expected = HandlerSources.emittedSignalKind(decorator);
    if (expected !== undefined && schemas.some((schema) => schema.kind !== expected)) {
      HandlerTypes.pushDiagnostic(
        scope,
        "INVALID_EMITTED_SCHEMA",
        node.type ?? node,
        `@${decorator} return type must emit generated ${expected} schemas.`,
        className,
        method,
      );
      return true;
    }
    if ((decorator === "Assign" || decorator === "Command") && schemas.length === 0) {
      HandlerTypes.pushDiagnostic(
        scope,
        "MISSING_EMITTED_SCHEMAS",
        node.type ?? node,
        `@${decorator} handlers must emit at least one schema.`,
        className,
        method,
      );
      return true;
    }
    if (
      decorator === "React" &&
      schemas.length === 0 &&
      !HandlerSources.isExplicitVoidType(node.type)
    ) {
      HandlerTypes.pushDiagnostic(
        scope,
        "MISSING_EMITTED_SCHEMAS",
        node.type ?? node,
        "@React handlers must emit at least one schema unless they return explicit void.",
        className,
        method,
      );
      return true;
    }
    return false;
  },

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

  isHandlerUse(decorator: DecoratorUse): decorator is HandlerDecoratorUse {
    return handlerDecorators.has(decorator.name as HandlerDecorator);
  },

  entityStateSchema(node: ts.ClassDeclaration, imports: ImportState): SchemaReference | undefined {
    for (const clause of node.heritageClauses ?? []) {
      for (const type of clause.types) {
        if (!HandlerSources.isEntityBase(type.expression, imports)) {
          continue;
        }

        const stateType = type.typeArguments?.[1];
        const reference =
          stateType === undefined
            ? undefined
            : HandlerSources.schemaFromTypeQuery(stateType, imports, HandlerSources.newTypeWalk());
        if (reference !== undefined) {
          return reference;
        }
      }
    }

    return undefined;
  },

  isEntityBase(expression: ts.Expression, imports: ImportState): boolean {
    if (ts.isIdentifier(expression)) {
      return entityBaseNames.has(imports.serverSymbols.get(expression.text) ?? "");
    }
    if (ts.isPropertyAccessExpression(expression)) {
      const namespace = HandlerTypes.expressionName(expression.expression);
      return (
        namespace !== undefined &&
        imports.serverNamespaces.has(namespace) &&
        entityBaseNames.has(expression.name.text)
      );
    }

    return false;
  },

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

  emittedSchemaUses(
    typeNode: ts.TypeNode | undefined,
    decorator: HandlerDecorator,
    imports: ImportState,
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

    return HandlerSources.schemaListFromType(typeNode, imports, HandlerSources.newTypeWalk());
  },

  schemaListFromType(
    typeNode: ts.TypeNode,
    imports: ImportState,
    walk: TypeWalk,
  ): readonly SchemaUse[] | undefined {
    if (!HandlerSources.consumeTypeWalk(walk)) {
      return undefined;
    }
    const unwrapped = HandlerSources.unwrapReadonly(typeNode);
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

  schemaListFromTuple(
    typeNode: ts.TupleTypeNode,
    imports: ImportState,
    walk: TypeWalk,
  ): readonly SchemaUse[] | undefined {
    const schemas: SchemaUse[] = [];

    for (const element of typeNode.elements) {
      const schema = HandlerSources.schemaFromTupleElement(element, imports, walk);
      if (schema === undefined) {
        return undefined;
      }
      schemas.push(schema);
    }

    return schemas;
  },

  schemaFromTupleElement(
    typeNode: ts.TypeNode | ts.NamedTupleMember,
    imports: ImportState,
    walk: TypeWalk,
  ): SchemaUse | undefined {
    if (ts.isNamedTupleMember(typeNode)) {
      return typeNode.questionToken === undefined && typeNode.dotDotDotToken === undefined
        ? HandlerSources.schemaUseFromType(typeNode.type, imports, walk)
        : undefined;
    }
    if (ts.isRestTypeNode(typeNode) || ts.isOptionalTypeNode(typeNode)) {
      return undefined;
    }

    return HandlerSources.schemaUseFromType(typeNode, imports, walk);
  },

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

  unwrapReadonly(typeNode: ts.TypeNode): ts.TypeNode {
    if (ts.isParenthesizedTypeNode(typeNode)) {
      return HandlerSources.unwrapReadonly(typeNode.type);
    }
    if (ts.isTypeOperatorNode(typeNode) && typeNode.operator === ts.SyntaxKind.ReadonlyKeyword) {
      return HandlerSources.unwrapReadonly(typeNode.type);
    }

    return typeNode;
  },

  isExplicitVoidType(typeNode: ts.TypeNode | undefined): boolean {
    if (typeNode === undefined) {
      return false;
    }
    if (ts.isParenthesizedTypeNode(typeNode)) {
      return HandlerSources.isExplicitVoidType(typeNode.type);
    }

    return typeNode.kind === ts.SyntaxKind.VoidKeyword;
  },

  isArrayReferenceType(typeNode: ts.TypeReferenceNode): boolean {
    return (
      ts.isIdentifier(typeNode.typeName) &&
      (typeNode.typeName.text === "Array" || typeNode.typeName.text === "ReadonlyArray")
    );
  },

  handlerKind(
    decorator: HandlerDecorator,
    signalKind: SignalKind | undefined,
  ): GeneratedHandlerKind {
    switch (decorator) {
      case "Assign":
        return "command-assignment";
      case "Command":
        return "command-reaction";
      case "React":
        return "event-reaction";
      case "Subscribe":
        return signalKind === "state" ? "state-subscription" : "event-subscription";
    }
  },

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

  emittedSignalKind(decorator: HandlerDecorator): SignalKind | undefined {
    if (decorator === "Command") {
      return "command";
    }
    if (decorator === "Assign" || decorator === "React") {
      return "event";
    }

    return undefined;
  },

  externalOrigin(
    parameters: readonly ts.ParameterDeclaration[],
    scope: AnalyzerScope,
    className: string,
    method: string | undefined,
  ): { readonly value: "domestic" | "external"; readonly type: ts.TypeNode } | undefined {
    const first = parameters[0]?.type;
    if (first === undefined) return undefined;
    const marker = HandlerSources.externalMarker(first, scope.imports);
    const laterMarker = parameters
      .slice(1)
      .some((parameter) =>
        parameter.type === undefined
          ? false
          : HandlerSources.containsExternalMarker(parameter.type, scope.imports),
      );
    const nestedMarker =
      marker === undefined && HandlerSources.containsExternalMarker(first, scope.imports);
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

  externalMarker(
    type: ts.TypeNode,
    imports: ImportState,
  ): { readonly direct: boolean; readonly type?: ts.TypeNode } | undefined {
    if (!ts.isTypeReferenceNode(type)) return undefined;
    const canonical =
      (ts.isIdentifier(type.typeName) &&
        imports.serverSymbols.get(type.typeName.text) === "External") ||
      (ts.isQualifiedName(type.typeName) &&
        ts.isIdentifier(type.typeName.left) &&
        type.typeName.right.text === "External" &&
        imports.serverNamespaces.has(type.typeName.left.text));
    if (!canonical) return undefined;
    const argument = type.typeArguments?.[0];
    return argument === undefined
      ? { direct: false }
      : { direct: type.typeArguments?.length === 1, type: argument };
  },

  containsExternalMarker(type: ts.TypeNode, imports: ImportState): boolean {
    if (HandlerSources.externalMarker(type, imports) !== undefined) return true;
    if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
      const alias = imports.localTypeAliases.get(type.typeName.text);
      if (alias !== undefined && HandlerSources.containsExternalMarker(alias, imports)) return true;
    }
    let found = false;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (ts.isTypeNode(node) && HandlerSources.externalMarker(node, imports) !== undefined) {
        found = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(type, visit);
    return found;
  },

  newTypeWalk(): TypeWalk {
    return { remaining: maxAliasDepth, seen: new Set() };
  },

  consumeTypeWalk(walk: TypeWalk): boolean {
    walk.remaining -= 1;

    return walk.remaining >= 0;
  },

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

  buildImportState(source: ts.SourceFile, program: ts.Program): ImportState {
    const state: MutableImportState = {
      generatedNamespaces: new Map(),
      generatedSymbols: new Map(),
      localTypeAliases: new Map(),
      serverNamespaces: new Set(),
      serverSymbols: new Map(),
      protoNamespaces: new Set(),
      protoSymbols: new Set(),
    };

    for (const statement of source.statements) {
      HandlerSources.recordImportStatement(statement, source, program, state);
    }

    return state;
  },

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

  recordImportDeclaration(
    statement: ts.ImportDeclaration,
    moduleSpecifier: string,
    source: ts.SourceFile,
    program: ts.Program,
    state: MutableImportState,
  ): void {
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined) {
      return;
    }
    if (moduleSpecifier === "@spine-event-engine/server") {
      HandlerSources.recordServerImport(bindings, state);
    }
    if (moduleSpecifier === "@spine-event-engine/proto") {
      HandlerSources.recordProtoImport(bindings, state);
    }
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
  },

  recordServerImport(bindings: ts.NamedImportBindings, state: MutableImportState): void {
    if (ts.isNamespaceImport(bindings)) {
      state.serverNamespaces.add(bindings.name.text);
      return;
    }

    for (const element of bindings.elements) {
      state.serverSymbols.set(element.name.text, element.propertyName?.text ?? element.name.text);
    }
  },

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
    }
  },

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

  isGeneratedModule(moduleSpecifier: string): boolean {
    return /(^|\/)generated\/.+_pb(\.js)?$/.test(moduleSpecifier);
  },

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

  uniqueStrings(values: readonly string[]): readonly string[] {
    return [...new Set(values)];
  },

  exportedNames(source: ts.SourceFile): GeneratedExports {
    const files = HandlerSources.generatedFiles(source);
    const schemaRoles = new Map<string, SignalKind | undefined>();
    const exports = { types: new Set<string>(), values: new Set<string>(), schemaRoles };

    for (const statement of source.statements) {
      HandlerSources.recordExportedNames(statement, exports, files);
    }

    return exports;
  },

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

  fileDescriptor(initializer: ts.Expression | undefined): GeneratedFile | undefined {
    const call = HandlerSources.callExpression(initializer, "fileDesc");
    const descriptor = call?.arguments[0];
    if (descriptor === undefined || !ts.isStringLiteralLike(descriptor)) {
      return undefined;
    }

    try {
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

  unwrapExpression(expression: ts.Expression): ts.Expression {
    if (ts.isParenthesizedExpression(expression)) {
      return HandlerSources.unwrapExpression(expression.expression);
    }
    if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
      return HandlerSources.unwrapExpression(expression.expression);
    }

    return expression;
  },

  signalKindFromProto(
    sourceFile: string,
    messageIndexes: readonly number[] | undefined,
  ): SignalKind | undefined {
    const sourceName = sourceFile.split(/[\\/]/u).at(-1);
    if (sourceName === "rejections.proto" || sourceName?.endsWith("_rejections.proto") === true) {
      return messageIndexes?.length === 1 ? "rejection" : undefined;
    }
    if (sourceFile.endsWith("commands.proto")) {
      return "command";
    }
    if (sourceFile.endsWith("events.proto")) {
      return "event";
    }

    return undefined;
  },

  descriptorMessage(message: ProtobufWkt.DescriptorProto): DescriptorMessage {
    return {
      name: message.name,
      isEntityState:
        message.options?.$unknown?.some((field) => field.no === entityOptionFieldNumber) === true,
      nested: message.nestedType.map(HandlerSources.descriptorMessage),
    };
  },
});

function requirePackage(specifier: string): unknown {
  const directRequire = createRequire(import.meta.url);
  try {
    return directRequire(specifier);
  } catch (error) {
    const packageRequire = createRequire(resolve(process.cwd(), "packages/server/package.json"));
    try {
      return packageRequire(specifier);
    } catch {
      throw error;
    }
  }
}

const HandlerTypes = Object.freeze({
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

  hasGeneratedType(exports: GeneratedExports, name: string): boolean {
    return exports.types.has(name) || exports.values.has(name);
  },

  serverDecorator(name: string | undefined): ServerDecorator | undefined {
    return name === "Assign" ||
      name === "Command" ||
      name === "React" ||
      name === "Subscribe" ||
      name === "Apply" ||
      name === "Where"
      ? name
      : undefined;
  },

  methodName(node: ts.MethodDeclaration): string | undefined {
    if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) {
      return node.name.text;
    }

    return undefined;
  },

  hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    return (
      ts.canHaveModifiers(node) &&
      (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind)
    );
  },

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
