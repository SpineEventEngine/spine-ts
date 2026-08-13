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

/** A resolved authored interface declaration supplied by the T-0182 provider. */
export interface AuthoredInterfaceDeclaration {
  readonly name: string;
  readonly importPath: string;
}

/** T-0181-owned seam for later authored-interface discovery and conformance. */
export interface InterfaceDeclarationProvider {
  resolve(name: string, members: readonly DescMessage[]): AuthoredInterfaceDeclaration | undefined;
}

/** Fails closed until T-0182 supplies same-module authored-interface discovery. */
export const unresolvedInterfaceProvider: InterfaceDeclarationProvider = Object.freeze({
  resolve: () => undefined,
});
