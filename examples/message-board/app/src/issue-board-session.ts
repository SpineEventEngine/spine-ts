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

/**
 * Administrative offline issuance from protected key and account configuration.
 */
import { BoardAdmission } from "./signed-admission.js";

const admission = BoardAdmission.signed(process.env);
const id = process.env.MESSAGE_BOARD_ACCOUNT_ID;
const boards = process.env.MESSAGE_BOARD_ACCOUNT_BOARDS;
if (id === undefined || id.trim() === "" || boards === undefined || boards.trim() === "")
  throw new Error("MESSAGE_BOARD_ACCOUNT_ID and MESSAGE_BOARD_ACCOUNT_BOARDS are required.");
const issued = await admission.sessions.issue({
  id,
  attributes: {
    boards,
    canReadRestricted:
      process.env.MESSAGE_BOARD_ACCOUNT_CAN_READ_RESTRICTED === "true" ? "true" : "false",
  },
});
if (issued.kind !== "issued") throw new Error("Administrative session issuance failed.");
process.stdout.write(`${issued.credential.value}\n`);
await admission.sessions.close();
