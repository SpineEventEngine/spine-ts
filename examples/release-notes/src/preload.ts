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

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld(
  "releaseNotes",
  Object.freeze({
    status: () => ipcRenderer.invoke("release-notes:command", "status", null),
    signIn: () => ipcRenderer.invoke("release-notes:command", "sign-in", null),
    reconnect: (clientId: string) =>
      ipcRenderer.invoke("release-notes:command", "reconnect", clientId),
    selectAccount: (clientId: string) =>
      ipcRenderer.invoke("release-notes:command", "select-account", clientId),
    models: (clientId: string) => ipcRenderer.invoke("release-notes:command", "models", clientId),
    selectModel: (clientId: string, model: string) =>
      ipcRenderer.invoke("release-notes:command", "select-model", { clientId, model }),
    signOut: (clientId: string) =>
      ipcRenderer.invoke("release-notes:command", "sign-out", clientId),
    manageUsage: () => ipcRenderer.invoke("release-notes:command", "usage", null),
  }),
);
