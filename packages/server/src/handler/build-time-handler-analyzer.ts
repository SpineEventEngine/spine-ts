import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import type * as Protobuf from "@bufbuild/protobuf";
import type * as ProtobufWkt from "@bufbuild/protobuf/wkt";
import ts from "typescript";

import type {
  GeneratedHandlerKind,
  GeneratedHandlerParameterCount,
} from "./generated-handler-registry.js";

/** Build-time analysis result for bare decorated entity handler methods. */
export interface BuildHandlerAnalysis {
  /** Entity groups in source-file and class declaration order. */
  readonly entities: readonly BuildEntityHandlers[];
  /** Deterministic diagnostics for unsupported handler declarations. */
  readonly diagnostics: readonly BuildHandlerDiagnostic[];
}

/** Build-time entity group shaped for later generated registry rendering. */
export interface BuildEntityHandlers {
  /** Entity class declaration name. */
  readonly className: string;
  /** Source file where the entity class is declared. */
  readonly sourceFile: string;
  /** Importable generated schema reference for entity state. */
  readonly stateSchema: SchemaReference;
  /** Analyzed bare-decorator handler records. */
  readonly handlers: readonly BuildHandlerRecord[];
}

/** Importable generated schema reference used by later source rendering. */
export interface SchemaReference {
  /** Module specifier exactly as declared by analyzed source. */
  readonly moduleSpecifier: string;
  /** Generated schema export name in that module. */
  readonly exportName: string;
}

/** Build-time handler record before generated source rendering. */
export interface BuildHandlerRecord {
  /** Handler role inferred from the bare decorator. */
  readonly kind: GeneratedHandlerKind;
  /** String method name selected by the generated metadata. */
  readonly methodName: string;
  /** Generated schema accepted by the first handler parameter. */
  readonly signalSchema: SchemaReference;
  /** Generated schemas emitted by the handler return type. */
  readonly emittedSchemas: readonly SchemaReference[];
  /** Public method arity: `handler(signal)` or `handler(signal, context)`. */
  readonly parameterCount: GeneratedHandlerParameterCount;
}

/** Stable diagnostic codes emitted by build-time handler analysis. */
export type BuildHandlerDiagnosticCode =
  | "APPLY_DECORATOR"
  | "FRAMEWORK_ENVELOPE_RETURN"
  | "INVALID_EMITTED_SCHEMA"
  | "INVALID_HANDLER_NAME"
  | "INVALID_HANDLER_VISIBILITY"
  | "INVALID_PARAMETER_COUNT"
  | "INVALID_SIGNAL_TYPE"
  | "INVALID_SUBSCRIBE_RETURN"
  | "MISSING_EMITTED_SCHEMAS"
  | "MISSING_ENTITY_STATE_SCHEMA"
  | "MISSING_RETURN_TYPE"
  | "MISSING_SIGNAL_TYPE"
  | "NON_EXPORTED_ENTITY_CLASS"
  | "SCHEMA_BEARING_DECORATOR"
  | "TYPESCRIPT_SYNTAX_ERROR"
  | "UNSUPPORTED_ENTITY_EXPORT"
  | "UNSUPPORTED_RETURN_TYPE";

/** One build-time analyzer diagnostic. */
export interface BuildHandlerDiagnostic {
  /** Stable machine-readable diagnostic code. */
  readonly code: BuildHandlerDiagnosticCode;
  /** Source file where the diagnostic was found. */
  readonly sourceFile: string;
  /** One-based source line. */
  readonly line: number;
  /** One-based source column. */
  readonly column: number;
  /** Human-readable diagnostic message. */
  readonly message: string;
  /** Entity class name when available. */
  readonly className?: string;
  /** Handler method name when available. */
  readonly methodName?: string;
}

/** Analyze configured TypeScript source files for bare Spine handler decorators. */
export function analyzeBuildHandlers(
  program: ts.Program,
  sourceFiles: readonly ts.SourceFile[] = appSourceFiles(program),
): BuildHandlerAnalysis {
  const entities: BuildEntityHandlers[] = [];
  const diagnostics: BuildHandlerDiagnostic[] = [];

  for (const source of sourceFiles) {
    const syntaxDiagnostics = program.getSyntacticDiagnostics(source);
    if (syntaxDiagnostics.length > 0) {
      diagnostics.push(
        ...syntaxDiagnostics.map((diagnostic) => syntaxDiagnostic(source, diagnostic)),
      );
      continue;
    }

    const scope = { program, source, imports: buildImportState(source, program), diagnostics };
    entities.push(...analyzeSource(scope));
  }

  return { entities, diagnostics };
}

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
  readonly nested: readonly DescriptorMessage[];
}

interface TypeWalk {
  remaining: number;
  readonly seen: Set<string>;
}

type HandlerDecorator = "Assign" | "Command" | "React" | "Subscribe";
type ServerDecorator = HandlerDecorator | "Apply";
type SignalKind = "command" | "event" | "rejection";

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
const protobuf = requirePackage("@bufbuild/protobuf") as typeof Protobuf;
const protobufWkt = requirePackage("@bufbuild/protobuf/wkt") as typeof ProtobufWkt;

function appSourceFiles(program: ts.Program): readonly ts.SourceFile[] {
  return program.getSourceFiles().filter((source) => !source.isDeclarationFile);
}

function analyzeSource(scope: AnalyzerScope): readonly BuildEntityHandlers[] {
  const entities: BuildEntityHandlers[] = [];

  for (const statement of scope.source.statements) {
    if (!ts.isClassDeclaration(statement) || statement.name === undefined) {
      continue;
    }

    const entity = analyzeClass(statement, scope);
    if (entity !== undefined) {
      entities.push(entity);
    }
  }

  return entities;
}

function analyzeClass(
  node: ts.ClassDeclaration,
  scope: AnalyzerScope,
): BuildEntityHandlers | undefined {
  const className = node.name?.text ?? "(anonymous)";
  const exportIssue = entityExportIssue(node, scope.source);
  if (hasDecoratedMethod(node, scope.imports) && exportIssue !== undefined) {
    pushDiagnostic(scope, exportIssue.code, node.name ?? node, exportIssue.message, className);
    return undefined;
  }

  const stateSchema = entityStateSchema(node, scope.imports);
  const handlers: BuildHandlerRecord[] = [];

  for (const member of node.members) {
    if (!ts.isMethodDeclaration(member)) {
      continue;
    }

    const handler = analyzeMethod(member, className, stateSchema, scope);
    if (handler !== undefined) {
      handlers.push(handler);
    }
  }

  if (stateSchema === undefined || handlers.length === 0) {
    return undefined;
  }

  return { className, sourceFile: scope.source.fileName, stateSchema, handlers };
}

function analyzeMethod(
  node: ts.MethodDeclaration,
  className: string,
  stateSchema: SchemaReference | undefined,
  scope: AnalyzerScope,
): BuildHandlerRecord | undefined {
  const decorators = methodDecorators(node, scope.imports);
  const apply = decorators.find((decorator) => decorator.name === "Apply");
  const handler = decorators.find(isHandlerUse);

  if (apply !== undefined) {
    pushDiagnostic(
      scope,
      "APPLY_DECORATOR",
      apply.node,
      "Generated registries do not support @Apply.",
      className,
      methodName(node),
    );
  }
  if (handler === undefined) {
    return undefined;
  }

  const method = methodName(node);
  const invalid = validateHandlerNode(node, handler.name, stateSchema, scope, className, method);
  if (handler.hasArguments) {
    pushDiagnostic(
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

  const signalSchema = schemaUseFromType(node.parameters[0]?.type, scope.imports)?.reference;
  const emittedSchemas = emittedSchemaUses(node.type, handler.name, scope.imports)?.map(
    (schema) => schema.reference,
  );
  if (signalSchema === undefined || emittedSchemas === undefined || method === undefined) {
    return undefined;
  }

  return {
    kind: handlerKind(handler.name),
    methodName: method,
    signalSchema,
    emittedSchemas,
    parameterCount: node.parameters.length as GeneratedHandlerParameterCount,
  };
}

function hasDecoratedMethod(node: ts.ClassDeclaration, imports: ImportState): boolean {
  return node.members.some(
    (member) => ts.isMethodDeclaration(member) && methodDecorators(member, imports).length > 0,
  );
}

function entityExportIssue(
  node: ts.ClassDeclaration,
  source: ts.SourceFile,
): { readonly code: BuildHandlerDiagnosticCode; readonly message: string } | undefined {
  if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
    return {
      code: "UNSUPPORTED_ENTITY_EXPORT",
      message: "Decorated entity classes must use named exports, not default exports.",
    };
  }
  if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
    return undefined;
  }
  if (node.name !== undefined && hasNamedClassExport(node.name.text, source)) {
    return undefined;
  }

  return {
    code: "NON_EXPORTED_ENTITY_CLASS",
    message: "Decorated entity classes must be exported for generated registry imports.",
  };
}

function hasNamedClassExport(className: string, source: ts.SourceFile): boolean {
  return source.statements.some(
    (statement) =>
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      namedExportIncludes(statement.exportClause, className),
  );
}

function namedExportIncludes(clause: ts.NamedExportBindings, className: string): boolean {
  return (
    ts.isNamedExports(clause) &&
    clause.elements.some(
      (element) =>
        element.name.text === className &&
        (element.propertyName === undefined || element.propertyName.text === className),
    )
  );
}

function validateHandlerNode(
  node: ts.MethodDeclaration,
  decorator: HandlerDecorator,
  stateSchema: SchemaReference | undefined,
  scope: AnalyzerScope,
  className: string,
  method: string | undefined,
): boolean {
  return [
    validateEntityState(node, stateSchema, scope, className, method),
    validateName(node, scope, className),
    validateVisibility(node, scope, className, method),
    validateParameters(node, decorator, scope, className, method),
    validateReturn(node, decorator, scope, className, method),
  ].some(Boolean);
}

function validateEntityState(
  node: ts.MethodDeclaration,
  stateSchema: SchemaReference | undefined,
  scope: AnalyzerScope,
  className: string,
  method: string | undefined,
): boolean {
  if (stateSchema !== undefined) {
    return false;
  }

  pushDiagnostic(
    scope,
    "MISSING_ENTITY_STATE_SCHEMA",
    node,
    "Decorated handlers must be declared on an entity class with an inferred state schema.",
    className,
    method,
  );
  return true;
}

function validateName(
  node: ts.MethodDeclaration,
  scope: AnalyzerScope,
  className: string,
): boolean {
  if (methodName(node) !== undefined) {
    return false;
  }

  pushDiagnostic(
    scope,
    "INVALID_HANDLER_NAME",
    node.name,
    "Decorated handlers must use a string method name.",
    className,
  );
  return true;
}

function validateVisibility(
  node: ts.MethodDeclaration,
  scope: AnalyzerScope,
  className: string,
  method: string | undefined,
): boolean {
  if (
    !hasModifier(node, ts.SyntaxKind.StaticKeyword) &&
    !hasModifier(node, ts.SyntaxKind.PrivateKeyword) &&
    !hasModifier(node, ts.SyntaxKind.ProtectedKeyword)
  ) {
    return false;
  }

  pushDiagnostic(
    scope,
    "INVALID_HANDLER_VISIBILITY",
    node.name,
    "Decorated handlers must be public instance methods.",
    className,
    method,
  );
  return true;
}

function validateParameters(
  node: ts.MethodDeclaration,
  decorator: HandlerDecorator,
  scope: AnalyzerScope,
  className: string,
  method: string | undefined,
): boolean {
  if (node.parameters.length !== 1 && node.parameters.length !== 2) {
    pushDiagnostic(
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
    pushDiagnostic(
      scope,
      "MISSING_SIGNAL_TYPE",
      node,
      `@${decorator} handlers require an explicit first parameter type.`,
      className,
      method,
    );
    return true;
  }

  const signal = schemaUseFromType(node.parameters[0].type, scope.imports);
  if (signal !== undefined && acceptsSignalKind(decorator, signal.kind)) {
    return false;
  }

  pushDiagnostic(
    scope,
    "INVALID_SIGNAL_TYPE",
    node.parameters[0].type,
    `@${decorator} first parameter must be ${signalMessage(decorator)}.`,
    className,
    method,
  );
  return true;
}

function validateReturn(
  node: ts.MethodDeclaration,
  decorator: HandlerDecorator,
  scope: AnalyzerScope,
  className: string,
  method: string | undefined,
): boolean {
  if (decorator === "Subscribe") {
    return validateSubscribeReturn(node, scope, className, method);
  }
  if (node.type === undefined) {
    pushDiagnostic(
      scope,
      "MISSING_RETURN_TYPE",
      node,
      `@${decorator} handlers require an explicit return type.`,
      className,
      method,
    );
    return true;
  }

  const envelope = frameworkEnvelope(node.type, scope.imports);
  if (envelope !== undefined) {
    pushDiagnostic(
      scope,
      "FRAMEWORK_ENVELOPE_RETURN",
      node.type,
      `Handler return type must not be framework ${envelope}.`,
      className,
      method,
    );
    return true;
  }

  return validateEmittedReturn(node, decorator, scope, className, method);
}

function validateSubscribeReturn(
  node: ts.MethodDeclaration,
  scope: AnalyzerScope,
  className: string,
  method: string | undefined,
): boolean {
  if (node.type?.kind === ts.SyntaxKind.VoidKeyword) {
    return false;
  }

  pushDiagnostic(
    scope,
    "INVALID_SUBSCRIBE_RETURN",
    node,
    "@Subscribe handlers must return explicit void.",
    className,
    method,
  );
  return true;
}

function validateEmittedReturn(
  node: ts.MethodDeclaration,
  decorator: HandlerDecorator,
  scope: AnalyzerScope,
  className: string,
  method: string | undefined,
): boolean {
  const schemas = emittedSchemaUses(node.type, decorator, scope.imports);
  if (schemas === undefined) {
    pushDiagnostic(
      scope,
      "UNSUPPORTED_RETURN_TYPE",
      node.type ?? node,
      `@${decorator} return type must resolve to generated schema references.`,
      className,
      method,
    );
    return true;
  }
  const expected = emittedSignalKind(decorator);
  if (expected !== undefined && schemas.some((schema) => schema.kind !== expected)) {
    pushDiagnostic(
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
    pushDiagnostic(
      scope,
      "MISSING_EMITTED_SCHEMAS",
      node.type ?? node,
      `@${decorator} handlers must emit at least one schema.`,
      className,
      method,
    );
    return true;
  }
  if (decorator === "React" && schemas.length === 0 && !isExplicitVoidType(node.type)) {
    pushDiagnostic(
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
}

function methodDecorators(
  node: ts.MethodDeclaration,
  imports: ImportState,
): readonly DecoratorUse[] {
  return (ts.getDecorators(node) ?? []).flatMap((decorator) => {
    const expression = ts.isCallExpression(decorator.expression)
      ? decorator.expression.expression
      : decorator.expression;
    const name = serverDecoratorName(expression, imports);

    return name === undefined
      ? []
      : [{ hasArguments: ts.isCallExpression(decorator.expression), name, node: decorator }];
  });
}

function serverDecoratorName(
  expression: ts.Expression,
  imports: ImportState,
): ServerDecorator | undefined {
  if (ts.isIdentifier(expression)) {
    return serverDecorator(imports.serverSymbols.get(expression.text));
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const namespace = expressionName(expression.expression);
    if (namespace !== undefined && imports.serverNamespaces.has(namespace)) {
      return serverDecorator(expression.name.text);
    }
  }

  return undefined;
}

function isHandlerUse(decorator: DecoratorUse): decorator is HandlerDecoratorUse {
  return handlerDecorators.has(decorator.name as HandlerDecorator);
}

function entityStateSchema(
  node: ts.ClassDeclaration,
  imports: ImportState,
): SchemaReference | undefined {
  for (const clause of node.heritageClauses ?? []) {
    for (const type of clause.types) {
      if (!isEntityBase(type.expression, imports)) {
        continue;
      }

      const stateType = type.typeArguments?.[1];
      const reference =
        stateType === undefined
          ? undefined
          : schemaFromTypeQuery(stateType, imports, newTypeWalk());
      if (reference !== undefined) {
        return reference;
      }
    }
  }

  return undefined;
}

function isEntityBase(expression: ts.Expression, imports: ImportState): boolean {
  if (ts.isIdentifier(expression)) {
    return entityBaseNames.has(imports.serverSymbols.get(expression.text) ?? "");
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const namespace = expressionName(expression.expression);
    return (
      namespace !== undefined &&
      imports.serverNamespaces.has(namespace) &&
      entityBaseNames.has(expression.name.text)
    );
  }

  return false;
}

function schemaFromTypeQuery(
  typeNode: ts.TypeNode,
  imports: ImportState,
  walk: TypeWalk,
): SchemaReference | undefined {
  if (!consumeTypeWalk(walk)) {
    return undefined;
  }
  if (ts.isParenthesizedTypeNode(typeNode)) {
    return schemaFromTypeQuery(typeNode.type, imports, walk);
  }
  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const alias = imports.localTypeAliases.get(typeNode.typeName.text);
    return alias === undefined
      ? undefined
      : resolveAlias(typeNode.typeName.text, alias, walk, (resolved) =>
          schemaFromTypeQuery(resolved, imports, walk),
        );
  }
  if (!ts.isTypeQueryNode(typeNode)) {
    return undefined;
  }

  return schemaFromEntityName(typeNode.exprName, imports);
}

function emittedSchemaUses(
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

  return schemaListFromType(typeNode, imports, newTypeWalk());
}

function schemaListFromType(
  typeNode: ts.TypeNode,
  imports: ImportState,
  walk: TypeWalk,
): readonly SchemaUse[] | undefined {
  if (!consumeTypeWalk(walk)) {
    return undefined;
  }
  const unwrapped = unwrapReadonly(typeNode);
  if (ts.isArrayTypeNode(unwrapped)) {
    const item = schemaUseFromType(unwrapped.elementType, imports, walk);
    return item === undefined ? undefined : [item];
  }
  if (ts.isTupleTypeNode(unwrapped)) {
    return schemaListFromTuple(unwrapped, imports, walk);
  }
  if (ts.isTypeReferenceNode(unwrapped) && isArrayReferenceType(unwrapped)) {
    const item = schemaUseFromType(unwrapped.typeArguments?.[0], imports, walk);
    return item === undefined ? undefined : [item];
  }

  const schema = schemaUseFromType(unwrapped, imports, walk);
  return schema === undefined ? undefined : [schema];
}

function schemaListFromTuple(
  typeNode: ts.TupleTypeNode,
  imports: ImportState,
  walk: TypeWalk,
): readonly SchemaUse[] | undefined {
  const schemas: SchemaUse[] = [];

  for (const element of typeNode.elements) {
    const schema = schemaFromTupleElement(element, imports, walk);
    if (schema === undefined) {
      return undefined;
    }
    schemas.push(schema);
  }

  return schemas;
}

function schemaFromTupleElement(
  typeNode: ts.TypeNode | ts.NamedTupleMember,
  imports: ImportState,
  walk: TypeWalk,
): SchemaUse | undefined {
  if (ts.isNamedTupleMember(typeNode)) {
    return typeNode.questionToken === undefined && typeNode.dotDotDotToken === undefined
      ? schemaUseFromType(typeNode.type, imports, walk)
      : undefined;
  }
  if (ts.isRestTypeNode(typeNode) || ts.isOptionalTypeNode(typeNode)) {
    return undefined;
  }

  return schemaUseFromType(typeNode, imports, walk);
}

function schemaUseFromType(
  typeNode: ts.TypeNode | undefined,
  imports: ImportState,
  walk: TypeWalk = newTypeWalk(),
): SchemaUse | undefined {
  if (typeNode === undefined) {
    return undefined;
  }
  if (!consumeTypeWalk(walk)) {
    return undefined;
  }
  const unwrapped = unwrapReadonly(typeNode);
  if (!ts.isTypeReferenceNode(unwrapped)) {
    return undefined;
  }
  if (ts.isIdentifier(unwrapped.typeName)) {
    const alias = imports.localTypeAliases.get(unwrapped.typeName.text);
    if (alias !== undefined) {
      return resolveAlias(unwrapped.typeName.text, alias, walk, (resolved) =>
        schemaUseFromType(resolved, imports, walk),
      );
    }

    return schemaUseFromSymbol(unwrapped.typeName.text, imports);
  }
  if (ts.isQualifiedName(unwrapped.typeName)) {
    return schemaUseFromName(unwrapped.typeName, imports);
  }

  return undefined;
}

function schemaUseFromSymbol(name: string, imports: ImportState): SchemaUse | undefined {
  const symbol = imports.generatedSymbols.get(name);
  if (symbol?.schemaExportName === undefined) {
    return undefined;
  }

  return {
    kind: symbol.kind,
    reference: { moduleSpecifier: symbol.moduleSpecifier, exportName: symbol.schemaExportName },
  };
}

function schemaUseFromName(name: ts.QualifiedName, imports: ImportState): SchemaUse | undefined {
  if (!ts.isIdentifier(name.left)) {
    return undefined;
  }
  const namespace = imports.generatedNamespaces.get(name.left.text);
  const schemaName = `${name.right.text}Schema`;

  return namespace === undefined ||
    !hasGeneratedType(namespace.exports, name.right.text) ||
    !namespace.exports.values.has(schemaName)
    ? undefined
    : {
        kind: namespace.exports.schemaRoles.get(schemaName),
        reference: { moduleSpecifier: namespace.moduleSpecifier, exportName: schemaName },
      };
}

function schemaFromEntityName(
  name: ts.EntityName,
  imports: ImportState,
): SchemaReference | undefined {
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
}

function frameworkEnvelope(
  typeNode: ts.TypeNode,
  imports: ImportState,
  walk: TypeWalk = newTypeWalk(),
): string | undefined {
  if (!consumeTypeWalk(walk)) {
    return undefined;
  }
  const unwrapped = unwrapReadonly(typeNode);
  if (!ts.isTypeReferenceNode(unwrapped)) {
    return undefined;
  }
  if (ts.isIdentifier(unwrapped.typeName)) {
    const alias = imports.localTypeAliases.get(unwrapped.typeName.text);
    if (alias !== undefined) {
      return resolveAlias(unwrapped.typeName.text, alias, walk, (resolved) =>
        frameworkEnvelope(resolved, imports, walk),
      );
    }

    return imports.protoSymbols.has(unwrapped.typeName.text) ? unwrapped.typeName.text : undefined;
  }
  if (ts.isQualifiedName(unwrapped.typeName) && ts.isIdentifier(unwrapped.typeName.left)) {
    const namespace = unwrapped.typeName.left.text;
    const name = unwrapped.typeName.right.text;
    return imports.protoNamespaces.has(namespace) && (name === "Event" || name === "Command")
      ? `${namespace}.${name}`
      : undefined;
  }

  return undefined;
}

function unwrapReadonly(typeNode: ts.TypeNode): ts.TypeNode {
  if (ts.isParenthesizedTypeNode(typeNode)) {
    return unwrapReadonly(typeNode.type);
  }
  if (ts.isTypeOperatorNode(typeNode) && typeNode.operator === ts.SyntaxKind.ReadonlyKeyword) {
    return unwrapReadonly(typeNode.type);
  }

  return typeNode;
}

function isExplicitVoidType(typeNode: ts.TypeNode | undefined): boolean {
  if (typeNode === undefined) {
    return false;
  }
  if (ts.isParenthesizedTypeNode(typeNode)) {
    return isExplicitVoidType(typeNode.type);
  }

  return typeNode.kind === ts.SyntaxKind.VoidKeyword;
}

function isArrayReferenceType(typeNode: ts.TypeReferenceNode): boolean {
  return (
    ts.isIdentifier(typeNode.typeName) &&
    (typeNode.typeName.text === "Array" || typeNode.typeName.text === "ReadonlyArray")
  );
}

function handlerKind(decorator: HandlerDecorator): GeneratedHandlerKind {
  switch (decorator) {
    case "Assign":
      return "command-assignment";
    case "Command":
      return "command-reaction";
    case "React":
      return "event-reaction";
    case "Subscribe":
      return "event-subscription";
  }
}

function acceptsSignalKind(decorator: HandlerDecorator, kind: SignalKind | undefined): boolean {
  if (decorator === "Command") {
    return kind === "command" || kind === "event" || kind === "rejection";
  }
  if (decorator === "Assign") {
    return kind === "command";
  }

  return kind === "event" || kind === "rejection";
}

function signalMessage(decorator: HandlerDecorator): string {
  if (decorator === "Command") {
    return "a generated command, event, or rejection type";
  }
  if (decorator === "Assign") {
    return "a generated command type";
  }

  return "a generated event or rejection type";
}

function emittedSignalKind(decorator: HandlerDecorator): SignalKind | undefined {
  if (decorator === "Command") {
    return "command";
  }
  if (decorator === "Assign" || decorator === "React") {
    return "event";
  }

  return undefined;
}

function newTypeWalk(): TypeWalk {
  return { remaining: maxAliasDepth, seen: new Set() };
}

function consumeTypeWalk(walk: TypeWalk): boolean {
  walk.remaining -= 1;

  return walk.remaining >= 0;
}

function resolveAlias<T>(
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
}

function buildImportState(source: ts.SourceFile, program: ts.Program): ImportState {
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
    recordImportStatement(statement, source, program, state);
  }

  return state;
}

function recordImportStatement(
  statement: ts.Statement,
  source: ts.SourceFile,
  program: ts.Program,
  state: MutableImportState,
): void {
  if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
    recordImportDeclaration(statement, statement.moduleSpecifier.text, source, program, state);
  }
  if (ts.isTypeAliasDeclaration(statement)) {
    state.localTypeAliases.set(statement.name.text, statement.type);
  }
}

function recordImportDeclaration(
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
  if (
    moduleSpecifier === "@spine-event-engine/server" &&
    statement.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword
  ) {
    recordServerImport(bindings, state);
  }
  if (moduleSpecifier === "@spine-event-engine/proto") {
    recordProtoImport(bindings, state);
  }
  if (isGeneratedModule(moduleSpecifier)) {
    recordGeneratedImport(
      bindings,
      moduleSpecifier,
      statement.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword,
      source,
      program,
      state,
    );
  }
}

function recordServerImport(bindings: ts.NamedImportBindings, state: MutableImportState): void {
  if (ts.isNamespaceImport(bindings)) {
    state.serverNamespaces.add(bindings.name.text);
    return;
  }

  for (const element of bindings.elements) {
    if (!element.isTypeOnly) {
      state.serverSymbols.set(element.name.text, element.propertyName?.text ?? element.name.text);
    }
  }
}

function recordProtoImport(bindings: ts.NamedImportBindings, state: MutableImportState): void {
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
}

function recordGeneratedImport(
  bindings: ts.NamedImportBindings,
  moduleSpecifier: string,
  valueImport: boolean,
  source: ts.SourceFile,
  program: ts.Program,
  state: MutableImportState,
): void {
  const exported = generatedModuleExports(source, moduleSpecifier, program);
  if (exported === undefined) {
    return;
  }

  if (ts.isNamespaceImport(bindings)) {
    state.generatedNamespaces.set(bindings.name.text, { exports: exported, moduleSpecifier });
    return;
  }

  for (const element of bindings.elements) {
    const exportName = element.propertyName?.text ?? element.name.text;
    if (!hasGeneratedType(exported, exportName)) {
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
}

function isGeneratedModule(moduleSpecifier: string): boolean {
  return /(^|\/)generated\/.+_pb(\.js)?$/.test(moduleSpecifier);
}

function generatedModuleExports(
  source: ts.SourceFile,
  moduleSpecifier: string,
  program: ts.Program,
): GeneratedExports | undefined {
  const module = generatedModuleSource(source, moduleSpecifier, program);

  return module === undefined ? undefined : exportedNames(module);
}

function generatedModuleSource(
  source: ts.SourceFile,
  moduleSpecifier: string,
  program: ts.Program,
): ts.SourceFile | undefined {
  const base = resolve(dirname(source.fileName), moduleSpecifier);
  const candidates = uniqueStrings([
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
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function exportedNames(source: ts.SourceFile): GeneratedExports {
  const files = generatedFiles(source);
  const schemaRoles = new Map<string, SignalKind | undefined>();
  const exports = { types: new Set<string>(), values: new Set<string>(), schemaRoles };

  for (const statement of source.statements) {
    recordExportedNames(statement, exports, files);
  }

  return exports;
}

function generatedFiles(source: ts.SourceFile): ReadonlyMap<string, GeneratedFile> {
  const files = new Map<string, GeneratedFile>();

  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) {
        continue;
      }
      const descriptor = fileDescriptor(declaration.initializer);
      if (descriptor !== undefined) {
        files.set(declaration.name.text, descriptor);
      }
    }
  }

  return files;
}

function recordExportedNames(
  statement: ts.Statement,
  exports: GeneratedExports,
  files: ReadonlyMap<string, GeneratedFile>,
): void {
  if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) {
        exports.values.add(declaration.name.text);
        const schemaRole = schemaRoleFromInitializer(
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

  if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
    recordNamedExport(statement, exports);
  }
}

function schemaRoleFromInitializer(
  schemaExportName: string,
  initializer: ts.Expression | undefined,
  files: ReadonlyMap<string, GeneratedFile>,
): { readonly found: boolean; readonly kind: SignalKind | undefined } {
  const call = callExpression(initializer, "messageDesc");
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
  const indexes = messageDescIndexes(call);
  const messageName = descriptorMessageName(file, indexes);
  const expectedName = schemaExportName.replace(/Schema$/, "");
  if (messageName === undefined || messageName !== expectedName) {
    return { found: true, kind: undefined };
  }

  return { found: true, kind: signalKindFromProto(file.sourceFile, indexes) };
}

function messageDescIndexes(call: ts.CallExpression): readonly number[] | undefined {
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
}

function descriptorMessageName(
  file: GeneratedFile,
  indexes: readonly number[] | undefined,
): string | undefined {
  if (indexes === undefined) {
    return undefined;
  }
  const path: string[] = [];
  let messages = file.messages;

  for (const index of indexes) {
    const message = messages[index];
    if (message === undefined) {
      return undefined;
    }
    path.push(message.name);
    messages = message.nested;
  }

  return path.join("_");
}

function fileDescriptor(initializer: ts.Expression | undefined): GeneratedFile | undefined {
  const call = callExpression(initializer, "fileDesc");
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
      : { sourceFile: file.name, messages: file.messageType.map(descriptorMessage) };
  } catch {
    return undefined;
  }
}

function callExpression(
  expression: ts.Expression | undefined,
  functionName: string,
): ts.CallExpression | undefined {
  if (expression === undefined) {
    return undefined;
  }
  const unwrapped = unwrapExpression(expression);
  if (!ts.isCallExpression(unwrapped) || !ts.isIdentifier(unwrapped.expression)) {
    return undefined;
  }

  return unwrapped.expression.text === functionName ? unwrapped : undefined;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression)) {
    return unwrapExpression(expression.expression);
  }
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return unwrapExpression(expression.expression);
  }

  return expression;
}

function signalKindFromProto(
  sourceFile: string,
  messageIndexes: readonly number[] | undefined,
): SignalKind | undefined {
  if (sourceFile.endsWith("rejections.proto")) {
    return messageIndexes?.length === 1 ? "rejection" : undefined;
  }
  if (sourceFile.endsWith("commands.proto")) {
    return "command";
  }
  if (sourceFile.endsWith("events.proto")) {
    return "event";
  }

  return undefined;
}

function descriptorMessage(message: {
  name: string;
  nestedType: readonly unknown[];
}): DescriptorMessage {
  return {
    name: message.name,
    nested: message.nestedType.map((nested) =>
      descriptorMessage(nested as { name: string; nestedType: readonly unknown[] }),
    ),
  };
}

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

function recordNamedExport(statement: ts.Statement, exports: GeneratedExports): void {
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
}

function hasGeneratedType(exports: GeneratedExports, name: string): boolean {
  return exports.types.has(name) || exports.values.has(name);
}

function serverDecorator(name: string | undefined): ServerDecorator | undefined {
  return name === "Assign" ||
    name === "Command" ||
    name === "React" ||
    name === "Subscribe" ||
    name === "Apply"
    ? name
    : undefined;
}

function methodName(node: ts.MethodDeclaration): string | undefined {
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) {
    return node.name.text;
  }

  return undefined;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind)
  );
}

function expressionName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const prefix = expressionName(expression.expression);
    return prefix === undefined ? undefined : `${prefix}.${expression.name.text}`;
  }

  return undefined;
}

function pushDiagnostic(
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
}

function syntaxDiagnostic(
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
}
