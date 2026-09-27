/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */
import {
  Converter,
  IntersectionType,
  QueryType,
  ReferenceType,
  ReflectionKind,
  ReflectionType,
  makeRecursiveVisitor,
} from "typedoc";

const entityPackage = "@spine-event-engine/server";
const entitySource = "src/entity/entity.ts";

/**
 * Checks whether a TypeDoc reference identifies an internal Entity constructor type.
 *
 * @param type The reference to inspect.
 * @returns Whether the reference identifies the exact internal symbol.
 */
function isInternalConstructorReference(type) {
  const id = type.symbolId;
  return (
    id?.packageName === entityPackage &&
    id.packagePath === entitySource &&
    ((id.qualifiedName === "EntityConstructorStatic" && type.name === id.qualifiedName) ||
      (id.qualifiedName === "EntityConstructorShape" && type.name === id.qualifiedName))
  );
}

/**
 * Checks whether a TypeDoc intersection retains the documented constructor contract.
 *
 * @param parts The intersection members left after removing the internal marker.
 * @returns Whether the members retain a constructor and its named prototype.
 */
function isConstructorIntersection(parts) {
  const hasConstructor = parts.some(
    (part) =>
      part instanceof ReflectionType &&
      part.declaration.signatures?.some(
        (signature) => signature.kind === ReflectionKind.ConstructorSignature,
      ),
  );
  const hasProperties = parts.some((part) => {
    const names =
      part instanceof ReflectionType ? part.declaration.children?.map((child) => child.name) : [];
    return names?.includes("prototype") && names.includes("name");
  });
  return hasConstructor && hasProperties;
}

/**
 * Removes one internal TypeDoc constructor marker from a validated public intersection.
 *
 * @param type The TypeDoc intersection that may contain an internal marker.
 * @returns Whether an exact internal marker was omitted.
 * @throws If the internal marker appears outside the expected constructor intersection.
 */
export function omitInternalEntityConstructor(type) {
  if (!(type instanceof IntersectionType)) return false;
  const markers = type.types.filter(
    (part) =>
      (part instanceof ReferenceType && isInternalConstructorReference(part)) ||
      (part instanceof QueryType && isInternalConstructorReference(part.queryType)),
  );
  if (markers.length === 0) return false;
  const retained = type.types.filter((part) => !markers.includes(part));
  if (markers.length !== 1 || !isConstructorIntersection(retained)) {
    throw new Error("Internal Entity marker appeared outside a constructor intersection.");
  }
  type.types = retained;
  return true;
}

/**
 * Registers the TypeDoc converter adjustment for internal Entity constructor markers.
 *
 * @param application The TypeDoc application whose converter supplies public reflections.
 */
export function load(application) {
  application.converter.on(Converter.EVENT_RESOLVE_END, (context) => {
    const visitor = makeRecursiveVisitor({ intersection: omitInternalEntityConstructor });
    for (const reflection of Object.values(context.project.reflections)) {
      reflection.type?.visit(visitor);
    }
  });
}
