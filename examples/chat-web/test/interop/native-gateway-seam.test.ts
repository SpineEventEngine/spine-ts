import {
  createNativeGatewayServices,
  type NativeGatewayRequestContext,
  type SubscriptionGateway,
  type UnaryGateway,
} from "../../../../packages/auth/dist/index.js";
import { expect, test } from "vitest";

test("exposes ResolveContext beside the native browser services", () => {
  const services = createNativeGatewayServices({
    unary: {} as UnaryGateway,
    subscriptions: {} as SubscriptionGateway,
    requests: {
      credential: () => ({ kind: "bearer", value: "test" }),
      transport: () => ({ service: "test", method: "test" }),
    } satisfies NativeGatewayRequestContext,
  });

  expect(services).toHaveProperty("authentication");
});
