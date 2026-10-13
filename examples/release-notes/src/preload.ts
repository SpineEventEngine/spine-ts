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
    currentModel: () => ipcRenderer.invoke("release-notes:command", "current-model", null),
    signIn: () => ipcRenderer.invoke("release-notes:command", "sign-in", null),
    models: (clientId: string) => ipcRenderer.invoke("release-notes:command", "models", clientId),
    selectModel: (clientId: string, model: string) =>
      ipcRenderer.invoke("release-notes:command", "select-model", { clientId, model }),
    signOut: (clientId: string) =>
      ipcRenderer.invoke("release-notes:command", "sign-out", clientId),
    manageUsage: () => ipcRenderer.invoke("release-notes:command", "usage", null),
    session: () => ipcRenderer.invoke("release-notes:command", "session", null),
    chooseProject: () => ipcRenderer.invoke("release-notes:command", "choose-project", null),
    compareProject: (handle: string, base: string, target: string) =>
      ipcRenderer.invoke("release-notes:command", "compare-project", { handle, base, target }),
    chooseComparison: (base: string, target: string) =>
      ipcRenderer.invoke("release-notes:command", "choose-comparison", { base, target }),
    evidencePatch: (selectionId: string, index: number) =>
      ipcRenderer.invoke("release-notes:command", "evidence-patch", { selectionId, index }),
    openDraft: (id: string, selectionId: string, title: string, audience: string) =>
      ipcRenderer.invoke("release-notes:command", "open-draft", {
        id,
        selectionId,
        title,
        audience,
      }),
    readDraft: (id: string) => ipcRenderer.invoke("release-notes:command", "read-draft", { id }),
    generate: (id: string, instruction: string) =>
      ipcRenderer.invoke("release-notes:command", "generate", { id, instruction }),
    repeatGeneration: (generation: string) =>
      ipcRenderer.invoke("release-notes:command", "repeat-generation", { generation }),
    cancelGeneration: (id: string, generation: string) =>
      ipcRenderer.invoke("release-notes:command", "cancel-generation", { id, generation }),
    phase: (generation: string) =>
      ipcRenderer.invoke("release-notes:command", "phase", { generation }),
    history: (id: string, category: string, pageSize: number, cursor?: string) =>
      ipcRenderer.invoke("release-notes:command", "history", {
        id,
        category,
        pageSize,
        ...(cursor === undefined ? {} : { cursor }),
      }),
    edit: (id: string, version: object, markdown: Uint8Array) =>
      ipcRenderer.invoke("release-notes:command", "edit", { id, version, markdown }),
    preview: (id: string) => ipcRenderer.invoke("release-notes:command", "preview", { id }),
    exportMarkdown: (id: string, version: object) =>
      ipcRenderer.invoke("release-notes:command", "export", { id, version }),
  }),
);
