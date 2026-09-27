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
  DeclarationReflection,
  IntersectionType,
  QueryType,
  ReferenceType,
  ReflectionKind,
  ReflectionSymbolId,
  ReflectionType,
} from "typedoc";
import { describe, expect, it } from "vitest";
import { load, omitInternalEntityConstructor } from "./typedoc-entity-types.mjs";

const packageName = "@spine-event-engine/server";
const packagePath = "src/entity/entity.ts";

function constructorPart() {
  const declaration = new DeclarationReflection("__type", ReflectionKind.TypeLiteral);
  declaration.signatures = [{ kind: ReflectionKind.ConstructorSignature }];
  return new ReflectionType(declaration);
}

function propertiesPart() {
  const declaration = new DeclarationReflection("__type", ReflectionKind.TypeLiteral);
  declaration.children = [
    new DeclarationReflection("prototype", ReflectionKind.Property, declaration),
    new DeclarationReflection("name", ReflectionKind.Property, declaration),
  ];
  return new ReflectionType(declaration);
}

function reference(name, overrides = {}) {
  const id = new ReflectionSymbolId({
    packageName: overrides.packageName ?? packageName,
    packagePath: overrides.packagePath ?? packagePath,
    qualifiedName: name,
  });
  return ReferenceType.createUnresolvedReference(
    name,
    id,
    { getReflectionsFromSymbolId: () => [] },
    name,
  );
}

function constructorIntersection(marker) {
  return new IntersectionType([constructorPart(), marker, propertiesPart()]);
}

describe("TypeDoc Entity constructor presentation", () => {
  it.each([
    reference("EntityConstructorStatic"),
    new QueryType(reference("EntityConstructorShape")),
  ])("omits the internal component without removing constructor and properties", (marker) => {
    const type = constructorIntersection(marker);

    expect(omitInternalEntityConstructor(type)).toBe(true);
    expect(type.types.map((part) => part.type)).toEqual(["reflection", "reflection"]);
    expect(type.types[0].declaration.signatures).toHaveLength(1);
    expect(type.types[1].declaration.children.map((child) => child.name)).toEqual([
      "prototype",
      "name",
    ]);
  });

  it.each([
    reference("EntityConstructorStatic", { packageName: "another-package" }),
    reference("EntityConstructorStatic", { packagePath: "src/other/entity.ts" }),
    reference("EntityConstructorStaticAlias"),
    new QueryType(reference("EntityConstructorShapeExtra")),
  ])("preserves unrelated and similarly named symbols", (marker) => {
    const type = constructorIntersection(marker);

    expect(omitInternalEntityConstructor(type)).toBe(false);
    expect(type.types).toHaveLength(3);
  });

  it("rejects an internal marker outside the documented constructor shape", () => {
    const type = new IntersectionType([reference("EntityConstructorStatic")]);

    expect(() => omitInternalEntityConstructor(type)).toThrow(/constructor intersection/);
    expect(type.types).toHaveLength(1);
  });

  it("filters registered reflection types at TypeDoc's resolve-end event", () => {
    const type = constructorIntersection(new QueryType(reference("EntityConstructorShape")));
    const reflection = new DeclarationReflection("RepositoryEntityType", ReflectionKind.TypeAlias);
    reflection.type = type;
    let resolveEnd;
    load({
      converter: {
        on: (event, callback) => {
          expect(event).toBe(Converter.EVENT_RESOLVE_END);
          resolveEnd = callback;
        },
      },
    });

    resolveEnd({ project: { reflections: { [reflection.id]: reflection } } });

    expect(type.types).toHaveLength(2);
  });
});
