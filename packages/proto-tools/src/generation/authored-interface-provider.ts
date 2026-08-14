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

import { existsSync, realpathSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";

import type { DescMessage } from "@bufbuild/protobuf";
import ts from "typescript";

import type {
  AuthoredInterfaceDeclaration,
  InterfaceDeclarationProvider,
} from "./interface-provider.js";
import type { ModelSourceView } from "./source-view.js";

/**
 * Resolves authored TypeScript interfaces from the validated model source view.
 */
export class AuthoredInterfaceProvider implements InterfaceDeclarationProvider {

  /**
   * Resolves one compatible authored interface from the staged model Program.
   *
   * @param name Requested TypeScript interface identifier.
   * @param members Generated messages that must satisfy the interface.
   * @param sourceView Validated authored/staged compiler input.
   * @returns The authored declaration import, or undefined without a source view.
   */
  resolve(
    name: string,
    members: readonly DescMessage[],
    sourceView: ModelSourceView | undefined,
  ): AuthoredInterfaceDeclaration | undefined {
    if (sourceView === undefined) return undefined;
    const program = this.program(sourceView);
    const declaration = this.declaration(program, sourceView, name);
    const checker = program.getTypeChecker();
    this.assertLocalParents(checker, sourceView, declaration, name, new Set());
    const interfaceType = checker.getTypeAtLocation(declaration);
    for (const member of members) {
      const type = this.messageType(program, checker, sourceView, member);
      if (!checker.isTypeAssignableTo(type, interfaceType))
        throw new Error(
          `spine-proto: authored interface ${name}: incompatible message ${member.typeName}`,
        );
    }
    return Object.freeze({
      importPath: this.importPath(sourceView, name, declaration.getSourceFile().fileName),
      name,
    });
  }

  private program(sourceView: ModelSourceView): ts.Program {
    const configFile = join(sourceView.packageRoot, "tsconfig.json");
    if (!existsSync(configFile))
      throw new Error("spine-proto: authored interface discovery requires tsconfig.json");
    const config = ts.readConfigFile(configFile, (path) => ts.sys.readFile(path));
    if (config.error !== undefined)
      throw new Error("spine-proto: authored interface discovery could not read tsconfig.json");
    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      sourceView.packageRoot,
      undefined,
      configFile,
    );
    if (parsed.errors.length > 0)
      throw new Error("spine-proto: authored interface discovery has invalid tsconfig.json");
    return ts.createProgram({
      options: parsed.options,
      rootNames: [...sourceView.authoredFiles, ...this.stagedFiles(sourceView.stagedGeneratedRoot)],
    });
  }

  private stagedFiles(root: string): readonly string[] {
    return ts.sys.readDirectory(root, [".cts", ".mts", ".ts", ".tsx"], undefined, ["**/*"]);
  }

  private declaration(
    program: ts.Program,
    sourceView: ModelSourceView,
    name: string,
  ): ts.InterfaceDeclaration {
    const candidates = sourceView.authoredFiles.flatMap((file) => {
      const source = program.getSourceFile(file);
      if (source === undefined) return [];
      return source.statements.filter(
        (statement): statement is ts.InterfaceDeclaration =>
          ts.isInterfaceDeclaration(statement) && statement.name.text === name,
      );
    });
    if (candidates.length === 0)
      throw new Error(`spine-proto: authored interface ${name}: missing top-level interface`);
    if (candidates.length > 1)
      throw new Error(`spine-proto: authored interface ${name}: ambiguous top-level interface`);
    const declaration = candidates[0];
    if (declaration === undefined)
      throw new Error(`spine-proto: authored interface ${name}: missing top-level interface`);
    if (declaration.typeParameters !== undefined && declaration.typeParameters.length > 0)
      throw new Error(
        `spine-proto: authored interface ${name}: generic interface is not supported`,
      );
    return declaration;
  }

  private messageType(
    program: ts.Program,
    checker: ts.TypeChecker,
    sourceView: ModelSourceView,
    member: DescMessage,
  ): ts.Type {
    const proto = member.file.proto.name;
    const generated = join(
      sourceView.stagedGeneratedRoot,
      `${proto.slice(0, -".proto".length)}_pb.ts`,
    );
    const source = program.getSourceFile(generated);
    if (source === undefined)
      throw new Error(
        `spine-proto: authored interface ${member.name}: missing staged generated message`,
      );
    const module = checker.getSymbolAtLocation(source);
    const packagePrefix = `${member.file.proto.package}.`;
    const generatedName = member.typeName.startsWith(packagePrefix)
      ? member.typeName.slice(packagePrefix.length).replaceAll(".", "_")
      : member.name;
    const symbol =
      module === undefined
        ? undefined
        : checker.getExportsOfModule(module).find((value) => value.name === generatedName);
    if (symbol === undefined)
      throw new Error(
        `spine-proto: authored interface ${member.name}: missing staged generated message`,
      );
    return checker.getDeclaredTypeOfSymbol(symbol);
  }

  private assertLocalParents(
    checker: ts.TypeChecker,
    sourceView: ModelSourceView,
    declaration: ts.InterfaceDeclaration,
    name: string,
    visited: Set<ts.Symbol>,
  ): void {
    const clauses = Object.getOwnPropertyDescriptor(declaration, "heritageClauses")?.value as
      | ts.NodeArray<ts.HeritageClause>
      | undefined;
    if (clauses === undefined) return;
    for (const clause of clauses) {
      for (const parent of clause.types) {
        const referenced = checker.getSymbolAtLocation(parent.expression);
        const symbol =
          referenced !== undefined && (referenced.flags & ts.SymbolFlags.Alias) !== 0
            ? checker.getAliasedSymbol(referenced)
            : referenced;
        if (symbol === undefined)
          throw new Error(
            `spine-proto: authored interface ${name}: extends parent must stay in the model module`,
          );
        if (visited.has(symbol))
          throw new Error(`spine-proto: authored interface ${name}: cyclic extends chain`);
        visited.add(symbol);
        const parentDeclaration = symbol.declarations?.find(ts.isInterfaceDeclaration);
        if (parentDeclaration === undefined)
          throw new Error(
            `spine-proto: authored interface ${name}: extends parent must stay in the model module`,
          );
        if (parentDeclaration.typeParameters !== undefined && parentDeclaration.typeParameters.length > 0)
          throw new Error(`spine-proto: authored interface ${name}: generic extends parent is not supported`);
        const localSources = new Set(sourceView.authoredFiles.map((file) => realpathSync(file)));
        if (!localSources.has(realpathSync(parentDeclaration.getSourceFile().fileName)))
          throw new Error(
            `spine-proto: authored interface ${name}: extends parent must stay in the model module`,
          );
        this.assertLocalParents(checker, sourceView, parentDeclaration, name, visited);
      }
    }
  }

  private importPath(sourceView: ModelSourceView, name: string, source: string): string {
    const output = join(sourceView.liveGeneratedRoot, "interfaces", `${name}.ts`);
    const extension = extname(source);
    const path = `${relative(dirname(output), source.slice(0, -extension.length))}.js`;
    return path.startsWith(".") ? path : `./${path}`;
  }
}
