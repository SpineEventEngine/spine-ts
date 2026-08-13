/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import type { DescMessage } from "@bufbuild/protobuf";

/**
 * A resolved authored interface declaration supplied by an authored-interface provider.
 */
export interface AuthoredInterfaceDeclaration {
  /**
   * Public TypeScript identifier of the authored interface.
   */
  readonly name: string;

  /**
   * Module specifier from which the authored interface is imported.
   */
  readonly importPath: string;
}

/**
 * Resolves authored interface declarations for generated message membership.
 */
export interface InterfaceDeclarationProvider {
  /**
   * Resolves one compatible authored interface declaration, if available.
   *
   * @param name The requested generated TypeScript interface name.
   * @param members Concrete generated message members of that interface.
   * @returns The authored declaration to alias, or `undefined` when unresolved.
   */
  resolve(name: string, members: readonly DescMessage[]): AuthoredInterfaceDeclaration | undefined;
}

/**
 * Leaves authored declarations unresolved until a discovery provider is installed.
 */
export const unresolvedInterfaceProvider: InterfaceDeclarationProvider = Object.freeze({
  resolve: () => undefined,
});
