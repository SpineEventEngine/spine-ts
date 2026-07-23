import { expect, it } from "vitest";

import type { DeliverySource } from "@spine-ts/server";

import { DeliveryClient } from "../src/index.js";

it("is structurally assignable to the server delivery source", () => {
  const asSource = (client: DeliveryClient): DeliverySource => client;

  expect(asSource).toBeTypeOf("function");
});
