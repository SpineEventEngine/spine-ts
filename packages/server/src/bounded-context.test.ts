import { describe, expect, it } from "vitest";

import {
  BoundedContext,
  BoundedContextBuilder,
  BoundedContextNameError,
  ContextSpec,
  type ContextSpecSnapshot,
  type TenantMode,
} from "./bounded-context.js";

type UntypedConstructor<T> = new (...args: unknown[]) => T;

const ContextSpecConstructor = ContextSpec as unknown as UntypedConstructor<ContextSpec>;
const BoundedContextBuilderConstructor =
  BoundedContextBuilder as unknown as UntypedConstructor<BoundedContextBuilder>;
const BoundedContextConstructor = BoundedContext as unknown as UntypedConstructor<BoundedContext>;

describe("BoundedContext builder shell", () => {
  it("rejects empty or blank context names", () => {
    expect(() => BoundedContext.singleTenant("\t\n")).toThrow(BoundedContextNameError);
    expect(() => BoundedContext.multitenant("")).toThrow(BoundedContextNameError);
  });

  it("keeps context names as immutable value objects", () => {
    const builder = BoundedContext.singleTenant("Tasks");
    const spec = builder.spec;
    const firstSnapshot = spec.snapshot;
    const secondSnapshot = spec.snapshot;

    expect(spec.name.value).toBe("Tasks");
    expect(Object.isFrozen(spec.name)).toBe(true);
    expect(Object.isFrozen(spec)).toBe(true);
    expect(firstSnapshot).toEqual(secondSnapshot);
    expect(firstSnapshot).not.toBe(secondSnapshot);
    expect(firstSnapshot.name).not.toBe(secondSnapshot.name);
  });

  it("creates single-tenant and multitenant builders with expected tenant mode", () => {
    const singleTenant = BoundedContext.singleTenant("Tasks");
    const multitenant = BoundedContext.multitenant("Customers");

    expect(singleTenant.name.value).toBe("Tasks");
    expect(singleTenant.tenantMode).toBe<TenantMode>("single-tenant");
    expect(singleTenant.isMultitenant()).toBe(false);
    expect(singleTenant.spec.multitenant).toBe(false);

    expect(multitenant.name.value).toBe("Customers");
    expect(multitenant.tenantMode).toBe<TenantMode>("multitenant");
    expect(multitenant.isMultitenant()).toBe(true);
    expect(multitenant.spec.multitenant).toBe(true);
  });

  it("builds an immutable copy-safe context snapshot", () => {
    const builder = BoundedContext.multitenant("Tasks");
    const context = builder.build();
    const firstSnapshot = context.snapshot;
    const firstBuilderSpec = builder.spec;
    const secondBuilderSpec = builder.spec;
    const firstContextSpec = context.spec;
    const secondContextSpec = context.spec;

    expect(context.name.value).toBe("Tasks");
    expect(context.tenantMode).toBe<TenantMode>("multitenant");
    expect(context.isMultitenant).toBe(true);
    expect(context.spec.storesEvents).toBe(true);
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(firstSnapshot)).toBe(true);
    expect(Object.isFrozen(firstSnapshot.name)).toBe(true);
    expect(Object.isFrozen(firstSnapshot.spec)).toBe(true);
    expect(firstSnapshot).toEqual({
      name: { value: "Tasks" },
      tenantMode: "multitenant",
      spec: {
        name: { value: "Tasks" },
        multitenant: true,
        storesEvents: true,
      },
    });

    const secondSnapshot = context.snapshot;
    expect(secondSnapshot).toEqual(firstSnapshot);
    expect(secondSnapshot).not.toBe(firstSnapshot);
    expect(secondSnapshot.name).not.toBe(firstSnapshot.name);
    expect(secondSnapshot.spec).not.toBe(firstSnapshot.spec);
    expect(firstBuilderSpec.snapshot).toEqual(secondBuilderSpec.snapshot);
    expect(firstBuilderSpec).not.toBe(secondBuilderSpec);
    expect(firstBuilderSpec.name).not.toBe(secondBuilderSpec.name);
    expect(firstContextSpec.snapshot).toEqual(secondContextSpec.snapshot);
    expect(firstContextSpec).not.toBe(secondContextSpec);
    expect(firstContextSpec.name).not.toBe(secondContextSpec.name);
  });

  it("exposes the metadata-only builder and built-context surface", () => {
    const builder = BoundedContext.singleTenant("Tasks");
    const context = builder.build();

    expect(Object.getOwnPropertyNames(BoundedContextBuilder.prototype).sort()).toEqual([
      "build",
      "constructor",
      "isMultitenant",
      "name",
      "spec",
      "tenantMode",
    ]);
    expect(Object.getOwnPropertyNames(BoundedContext.prototype).sort()).toEqual([
      "constructor",
      "isMultitenant",
      "name",
      "snapshot",
      "spec",
      "tenantMode",
    ]);
    expect(Object.getOwnPropertyNames(ContextSpec.prototype).sort()).toEqual([
      "constructor",
      "multitenant",
      "name",
      "snapshot",
      "storesEvents",
      "tenantMode",
    ]);
    expect(Object.keys(builder.spec.snapshot).sort()).toEqual([
      "multitenant",
      "name",
      "storesEvents",
    ]);
    expect(Object.keys(context.snapshot).sort()).toEqual(["name", "spec", "tenantMode"]);
    expect(context.spec.snapshot).toEqual(builder.spec.snapshot);
  });

  it("rejects direct JS construction outside the public builder path", () => {
    expect(() =>
      Reflect.construct(ContextSpecConstructor, [
        {
          name: { value: "Tasks" },
          multitenant: false,
          storesEvents: true,
        } satisfies ContextSpecSnapshot,
      ]),
    ).toThrow(/framework-owned/);
    expect(() =>
      Reflect.construct(BoundedContextBuilderConstructor, [
        { name: { value: "Tasks" }, multitenant: false, storesEvents: true },
      ]),
    ).toThrow(/BoundedContext\.singleTenant\(name\)|BoundedContext\.multitenant\(name\)/);
    expect(() =>
      Reflect.construct(BoundedContextConstructor, [
        {
          name: { value: "Tasks" },
          tenantMode: "single-tenant",
          spec: { name: { value: "Tasks" }, multitenant: false, storesEvents: true },
        },
      ]),
    ).toThrow(/builder\.build\(\)/);
  });

  it("rejects subclass and prototype forgery at the construction boundary", () => {
    class MaliciousContextSpec extends ContextSpecConstructor {
      override get snapshot() {
        return Object.freeze({
          name: Object.freeze({ value: "" }) as never,
          multitenant: "no" as never,
          storesEvents: "yes" as never,
        });
      }
    }

    const forgedBuilder = Object.create(BoundedContextBuilder.prototype) as BoundedContextBuilder;

    expect(() =>
      Reflect.construct(
        ContextSpecConstructor,
        [
          {
            name: { value: "Tasks" },
            multitenant: false,
            storesEvents: true,
          } satisfies ContextSpecSnapshot,
        ],
        MaliciousContextSpec as UntypedConstructor<ContextSpec>,
      ),
    ).toThrow(/framework-owned/);
    expect(() =>
      Reflect.construct(BoundedContextBuilderConstructor, [
        {
          name: { value: "Tasks" },
          multitenant: false,
          storesEvents: true,
        } satisfies ContextSpecSnapshot,
      ]),
    ).toThrow(/framework-owned/);
    expect(() => forgedBuilder.build()).toThrow(TypeError);
  });

  it("does not allow constructor-property leakage to forge valid-looking instances", () => {
    const builder = BoundedContext.singleTenant("Tasks");
    const context = builder.build();
    const spec = builder.spec;

    const leakedSpecConstructor = spec.constructor as UntypedConstructor<ContextSpec>;
    const leakedBuilderConstructor =
      builder.constructor as UntypedConstructor<BoundedContextBuilder>;
    const leakedContextConstructor = context.constructor as UntypedConstructor<BoundedContext>;

    expect(() =>
      Reflect.construct(leakedSpecConstructor, [
        {
          name: { value: "" },
          multitenant: "nope",
          storesEvents: true,
        },
      ]),
    ).toThrow();
    expect(() =>
      Reflect.construct(leakedBuilderConstructor, [
        {
          name: { value: "" },
          multitenant: "nope",
          storesEvents: true,
        },
      ]),
    ).toThrow();
    expect(() =>
      Reflect.construct(leakedContextConstructor, [
        {
          name: { value: "" },
          tenantMode: "anything-goes",
          spec: {
            name: { value: "" },
            multitenant: "nope",
            storesEvents: true,
          },
        },
      ]),
    ).toThrow();
    expect(() => Reflect.construct(leakedContextConstructor, [null])).toThrow(
      /snapshot must be an object/,
    );
    expect(() =>
      Reflect.construct(leakedContextConstructor, [
        {
          name: { value: "Tasks" },
          tenantMode: "single-tenant",
          spec: {
            name: { value: "OtherTasks" },
            multitenant: false,
            storesEvents: true,
          },
        },
      ]),
    ).toThrow(/must match BoundedContext\.spec\.name/);
    expect(() =>
      Reflect.construct(leakedContextConstructor, [
        {
          name: { value: "Tasks" },
          tenantMode: "multitenant",
          spec: {
            name: { value: "Tasks" },
            multitenant: false,
            storesEvents: true,
          },
        },
      ]),
    ).toThrow(/must match BoundedContext\.spec\.multitenant/);
  });
});
