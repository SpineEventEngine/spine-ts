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

import { Environment, EnvironmentType } from "@spine-event-engine/server";
import { FieldnotesHost } from "./fieldnotes-host.js";
import { FieldnotesAuthenticationSettings, FieldnotesHostSettings } from "./host-settings.js";
import { FieldnotesProcessSignals } from "./fieldnotes-process.js";

const parser = new FieldnotesHostSettings();
try {
  const settings = parser.parse(process.env);
  const authentication = new FieldnotesAuthenticationSettings().parse(
    process.env,
    Environment.instance().type === EnvironmentType.Production,
  );
  const gatewayPort = parser.gatewayPort(process.env);
  const host = await FieldnotesHost.open(settings, { authentication, gatewayPort });
  FieldnotesProcessSignals.install(host);
  process.stdout.write(`Fieldnotes Gateway ready on 127.0.0.1:${String(gatewayPort)}.\n`);
} catch {
  process.stderr.write("Fieldnotes startup failed.\n");
  process.exitCode = 1;
}
