import { afterEach, beforeEach, test } from "node:test";
import { ServerEnvironment } from "@spine-event-engine/server";
import { ServerTests } from "@spine-event-engine/server/testing";
import * as testing from "@spine-event-engine/testing";
import { registerBlackBoxContract } from "./black-box.contract.mjs";

beforeEach(async () => ServerEnvironment.instance().completeSetup());
afterEach(async () => ServerTests.resetEnvironment());

registerBlackBoxContract(test, testing);
