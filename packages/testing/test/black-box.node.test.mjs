import test from "node:test";
import * as testing from "@spine-ts/testing";
import { registerBlackBoxContract } from "./black-box.contract.mjs";

registerBlackBoxContract(test, testing);
