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

import type { DescriptorMessageSchema } from "../entity/entity-metadata.js";
import { type WhereOptions } from "./handler-metadata.js";

export type { WhereOptions } from "./handler-metadata.js";

/**
 * TypeScript method decorator metadata used to validate handler declarations.
 */
interface HandlerDecoratorContext {
  readonly static: boolean;
  readonly private: boolean;
  readonly name: string | symbol;
}

/**
 * Describes the standard TypeScript method decorator accepted by Spine handler declarations.
 *
 * @typeParam This Receiver instance on which the decorated method runs.
 * @typeParam Parameters - Parameters accepted by the decorated method.
 * @typeParam Return - Result returned by the decorated method.
 * @param value Decorated method implementation.
 * @param context Standard TypeScript decorator context.
 */
export type HandlerMethodDecorator = <
  This extends object,
  Parameters extends readonly unknown[],
  Return,
>(
  value: HandlerMethodValue<This, Parameters, Return>,
  context: ClassMethodDecoratorContext<This, HandlerMethodValue<This, Parameters, Return>>,
) => void;

/**
 * Describes an instance method shape accepted by public handler decorators.
 *
 * @typeParam This Receiver instance on which the method runs.
 * @typeParam Parameters - Parameters accepted by the method.
 * @typeParam Return - Result returned by the method.
 * @param this Entity instance that receives the invocation.
 * @param parameters Arguments supplied to the handler.
 * @returns Handler result.
 */
export type HandlerMethodValue<
  This extends object = object,
  Parameters extends readonly unknown[] = readonly unknown[],
  Return = unknown,
> = (this: This, ...parameters: Parameters) => Return;

/**
 * Generated companion declaration for a rejection that a command receptor may throw.
 */
export interface RejectionDeclaration {
  // prettier-ignore

  /**
   * Generated Protobuf schema of the declared rejection.
   */
  readonly schema: DescriptorMessageSchema;
}

/**
 * Validates declared domain rejections for build-time handler discovery.
 *
 * Put `@Assign` or `@Command` first and `@Throws` last for readability; either
 * order is accepted. The generated registry registers these rejection types
 * even when no server handler consumes them. Rejections are thrown, not normal
 * return values, and do not belong in the handler's return union or tuple.
 *
 * @param declarations Generated rejection companions.
 * @returns A method decorator that validates the annotated instance method.
 */
export function Throws(...declarations: readonly RejectionDeclaration[]): HandlerMethodDecorator {
  if (declarations.length === 0) {
    throw new TypeError("@Throws requires at least one generated rejection declaration.");
  }
  const schemas = declarations.map((declaration) => {
    const value: unknown = declaration;
    const schema =
      value !== null && typeof value === "object"
        ? (value as { readonly schema?: unknown }).schema
        : undefined;
    if (
      schema === null ||
      typeof schema !== "object" ||
      typeof (schema as { readonly typeName?: unknown }).typeName !== "string"
    ) {
      throw new TypeError("@Throws accepts only generated rejection declarations.");
    }
    return schema as DescriptorMessageSchema;
  });
  const typeNames = schemas.map((schema) => schema.typeName);
  if (new Set(typeNames).size !== typeNames.length) {
    throw new TypeError("@Throws cannot declare the same rejection more than once.");
  }
  return (_value, context): void => {
    DecoratorValidation.methodName(context);
  };
}

/**
 * Creates a command-assignee declaration.
 *
 * Bare `@Assign` is the ordinary application form. Generated handler
 * registries require a command input and normal event output; a rejection is
 * valid in neither role, but the handler may throw a generated rejection
 * throwable. Generated tooling discovers the declaration from source; the
 * decorator validates method placement without registering or invoking it.
 *
 * Declare a generated Event type, a union such as `TaskAssigned | TaskReassigned`,
 * a flat Event array (`T[]`, `readonly T[]`, `Array<T>`, or `ReadonlyArray<T>`),
 * or a fixed tuple such as `readonly [TaskCreated, TaskAssigned?]`. Tuples may
 * have named entries and union alternatives. Concrete local/imported aliases
 * and exactly one outer built-in `Promise` are supported. A successful command
 * must produce at least one Event; `void`, whole-result `undefined`, and
 * optional-only tuples are not valid assignment declarations.
 *
 * Return domain messages, not framework envelopes or rejections. Nested
 * collections, rest tuples, nested promises, custom thenables, `any`, and
 * `unknown` are unsupported. TypeScript checks tuple structure; Spine validates
 * each returned message against this handler's declarations and keeps its order.
 * Declare thrown domain rejections separately with {@link Throws}.
 *
 * @typeParam This Receiver instance on which the method runs.
 * @typeParam Parameters - Parameters accepted by the method.
 * @typeParam Return - Result returned by the method.
 * @param value Decorated method implementation.
 * @param context Standard decorator context for bare usage.
 */
export function Assign<This extends object, Parameters extends readonly unknown[], Return>(
  value: HandlerMethodValue<This, Parameters, Return>,
  context: ClassMethodDecoratorContext<This, HandlerMethodValue<This, Parameters, Return>>,
): void;

/**
 * Validates a bare command-assignment declaration.
 *
 * @param value Decorated method implementation.
 * @param context Standard decorator context.
 */
export function Assign(value: HandlerMethodValue, context: ClassMethodDecoratorContext): void {
  DecoratorValidation.method(value, context);
}

/**
 * Creates a command handler declaration.
 *
 * Bare `@Command` accepts a generated Command, Event, or rejection input.
 * A Command input is the unique command-substitution receptor for its type and
 * substitutes it with one or more Commands. Among Entity repositories, only
 * Process Managers support `@Command`; Aggregates and Projections reject it.
 * Standalone receivers use `AbstractCommander`.
 * Event and rejection inputs are Event Bus reactions that may return Commands.
 * Rejections are thrown, not returned.
 *
 * Declare a generated Command, a union such as
 * `CreateAccessGrant | ExtendAccessGrant`, a flat Command array, or a fixed
 * tuple. Arrays support `T[]`, `readonly T[]`, `Array<T>`, and `ReadonlyArray<T>`;
 * tuples support readonly, named, optional, and union-valued entries. Concrete
 * local/imported aliases and one outer built-in `Promise` are supported.
 * A Command-input handler must declare a guaranteed Command output. An
 * Event/rejection reaction may declare `undefined` alone or in any supported
 * union, and may return an empty typed Command array. `void` is not supported
 * for reactions; optional-only tuples are rejected for Command inputs.
 *
 * Every result must be a declared domain Command, not a framework envelope.
 * Nested collections, rest tuples, nested promises, custom thenables, `any`,
 * and `unknown` are unsupported. TypeScript checks tuple structure; Spine
 * validates returned message types and preserves their order.
 *
 * @typeParam This Receiver instance on which the method runs.
 * @typeParam Parameters - Parameters accepted by the method.
 * @typeParam Return - Result returned by the method.
 * @param value Decorated method implementation.
 * @param context Standard decorator context for bare usage.
 */
export function Command<This extends object, Parameters extends readonly unknown[], Return>(
  value: HandlerMethodValue<This, Parameters, Return>,
  context: ClassMethodDecoratorContext<This, HandlerMethodValue<This, Parameters, Return>>,
): void;

/**
 * Validates a bare command handler declaration.
 *
 * @param value Decorated method implementation.
 * @param context Standard decorator context.
 */
export function Command(value: HandlerMethodValue, context: ClassMethodDecoratorContext): void {
  DecoratorValidation.method(value, context);
}

/**
 * Creates an Event/rejection or Entity-state subscriber declaration.
 *
 * Bare `@Subscribe` accepts generated Event/rejection or descriptor-marked
 * Entity-state inputs and declares `void` or one built-in `Promise<void>`;
 * aliases and parenthesized forms of `void` are supported, but `undefined`
 * alone is not a subscriber return type.
 * It does not return signals; unions, arrays, and tuples of messages belong in
 * producing handlers such as {@link React}, not subscribers. Nested promises
 * and custom thenables are unsupported. Event/rejection inputs produce
 * event-subscription metadata; Entity state inputs produce state-subscription
 * metadata. Generated registry tooling discovers subscribers from source and
 * bridges their declarations to runtime handler metadata.
 *
 * @typeParam This Receiver instance on which the method runs.
 * @typeParam Parameters - Parameters accepted by the method.
 * @typeParam Return - Result returned by the method.
 * @param value Decorated method implementation.
 * @param context Standard decorator context for bare usage.
 */
export function Subscribe<This extends object, Parameters extends readonly unknown[], Return>(
  value: HandlerMethodValue<This, Parameters, Return>,
  context: ClassMethodDecoratorContext<This, HandlerMethodValue<This, Parameters, Return>>,
): void;

/**
 * Validates a bare event subscription declaration.
 *
 * @param value Decorated method implementation.
 * @param context Standard decorator context.
 */
export function Subscribe(value: HandlerMethodValue, context: ClassMethodDecoratorContext): void {
  DecoratorValidation.method(value, context);
}

/**
 * Creates an event-reactor declaration.
 *
 * Bare `@React` accepts generated Event or rejection inputs and returns domain
 * Events, not rejections or framework envelopes. Declare one Event, a union of
 * Event types, a flat array, or a fixed tuple. Arrays support `T[]`, `readonly T[]`,
 * `Array<T>`, and `ReadonlyArray<T>`; tuples support readonly, named, optional,
 * and union-valued entries. Concrete local/imported aliases are supported.
 *
 * Declare explicit `undefined` for no output, or a type such as
 * `TaskRenamed | undefined` when a reaction sometimes emits an Event. Empty
 * arrays and absent optional tuple entries produce no signals. Any supported
 * result may have exactly one outer built-in `Promise`, including `Promise<undefined>`.
 * `void` is not a valid reactor return type.
 * Nested collections, rest tuples, nested promises, custom thenables, `any`,
 * and `unknown` are unsupported. TypeScript checks tuple structure; Spine checks
 * each actual Event against this handler's declarations and preserves order.
 * Generated registry metadata connects the declaration to runtime dispatch.
 *
 * @typeParam This Receiver instance on which the method runs.
 * @typeParam Parameters - Parameters accepted by the method.
 * @typeParam Return - Result returned by the method.
 * @param value Decorated method implementation.
 * @param context Standard decorator context for bare usage.
 */
export function React<This extends object, Parameters extends readonly unknown[], Return>(
  value: HandlerMethodValue<This, Parameters, Return>,
  context: ClassMethodDecoratorContext<This, HandlerMethodValue<This, Parameters, Return>>,
): void;

/**
 * Validates a bare event reaction declaration.
 *
 * @param value Decorated method implementation.
 * @param context Standard decorator context.
 */
export function React(value: HandlerMethodValue, context: ClassMethodDecoratorContext): void {
  DecoratorValidation.method(value, context);
}

/**
 * Creates one Event field equality filter for an Event-consuming handler.
 *
 * Generated handler analysis validates the declaration and carries it into
 * immutable repository metadata. The decorator itself does not inspect or
 * invoke the handler.
 *
 * @param options Event source field and canonical expected value.
 * @returns Decorator for a public instance handler method.
 */
export function Where(options: WhereOptions): HandlerMethodDecorator {
  const snapshot = WhereValues.snapshot(options);

  return (_value, context): void => {
    void snapshot;
    DecoratorValidation.methodName(context);
  };
}

const DecoratorValidation = Object.freeze({
  /**
   * Validates a public instance method with a string name.
   *
   * @param context TypeScript decorator context identifying the method.
   */
  methodName(context: HandlerDecoratorContext): void {
    if (context.static || context.private) {
      throw new TypeError("Spine handler decorators must be applied to public instance methods.");
    }

    if (typeof context.name !== "string") {
      throw new TypeError("Spine handler decorators require string-named methods.");
    }
  },

  /**
   * Validates one bare method decorator invocation.
   *
   * @param value Decorated method implementation.
   * @param context Standard method decorator context.
   */
  method(value: HandlerMethodValue, context: ClassMethodDecoratorContext): void {
    const suppliedContext = context as { readonly kind?: string } | undefined;
    if (suppliedContext?.kind !== "method" || typeof value !== "function") {
      throw new TypeError("Spine handler decorators require a standard method decorator context.");
    }
    DecoratorValidation.methodName(context);
  },
});

const WhereValues = Object.freeze({
  /**
   * Validates and copies the supported single-field Event filter.
   *
   * @param options Field name and comparison value supplied to the decorator.
   * @returns A frozen filter independent of the caller's object.
   */
  snapshot(options: WhereOptions): WhereOptions {
    const value: unknown = options;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("Where options must be an object.");
    }
    const keys = Object.keys(value);
    if (
      keys.length !== 2 ||
      !keys.includes("eventField") ||
      !keys.includes("equals") ||
      typeof options.eventField !== "string" ||
      options.eventField.trim().length === 0 ||
      typeof options.equals !== "string"
    ) {
      throw new TypeError("Where options require exactly non-empty eventField and string equals.");
    }
    return Object.freeze({ eventField: options.eventField, equals: options.equals });
  },
});
