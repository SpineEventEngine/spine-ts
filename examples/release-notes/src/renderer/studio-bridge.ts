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

import { ipc } from "./gen/ipc.js";
import type { Draft } from "./gen/studio.js";
import { StudioTransport } from "../trusted/studio-transport.js";

const service = ipc.studio;
const draftView = (draft: Draft) => {
  if (!draft.comparison) throw new Error("Incomplete Studio draft.");
  return {
    ...draft,
    version: StudioTransport.versionJson(draft.version),
    markdown: new Uint8Array(draft.markdown),
  };
};

/**
 * Fixed renderer adapter for the generated desktop service.
 */
const StudioBridge = Object.freeze({
  status: () => service.Status({}),
  currentModel: () => service.CurrentModel({}),
  signIn: () => service.SignIn({}),
  models: async (clientId: string) => (await service.Models({ clientId })).models,
  selectModel: (clientId: string, model: string) => service.SelectModel({ clientId, model }),
  signOut: async (clientId: string) => {
    const result = await service.SignOut({ clientId });
    if (!result.status) throw new Error("Incomplete sign-out result.");
    return { status: result.status, revocationConfirmed: result.revocationConfirmed };
  },
  manageUsage: async () => {
    await service.ManageUsage({});
  },
  session: () => service.Session({}),
  chooseProject: async () => (await service.ChooseProject({})).project ?? null,
  compareProject: (handle: string, base: string, target: string) =>
    service.CompareProject({ handle, base, target }),
  chooseComparison: async (base: string, target: string) =>
    (await service.ChooseComparison({ base, target })).comparison ?? null,
  evidencePatch: (selectionId: string, index: number) =>
    service.EvidencePatch({ selectionId, index }),
  openDraft: async (id: string, selectionId: string, title: string, audience: string) =>
    draftView(await service.OpenDraft({ id, selectionId, title, audience })),
  readDraft: async (id: string) => draftView(await service.ReadDraft({ id })),
  generate: (id: string, instruction: string) => service.Generate({ id, instruction }),
  repeatGeneration: (generation: string) => service.RepeatGeneration({ generation }),
  cancelGeneration: async (id: string, generation: string) =>
    draftView(await service.CancelGeneration({ id, generation })),
  phase: (generation: string) => service.Phase({ generation }),
  history: async (id: string, category: string, pageSize: number, cursor?: string) => {
    const page = await service.History({ id, category, pageSize, cursor });
    return {
      items: page.itemsJson.map((item) => JSON.parse(item) as unknown),
      cursor: page.cursor,
    };
  },
  edit: async (id: string, version: object, markdown: Uint8Array) =>
    draftView(await service.Edit(StudioTransport.editRequest(id, version, markdown))),
  preview: async (id: string) => {
    const result = await service.Preview({ id });
    return {
      version: StudioTransport.versionJson(result.version),
      markdown: new Uint8Array(result.markdown),
      digest: result.digest,
    };
  },
  exportMarkdown: (id: string, version: object) =>
    service.ExportMarkdown({
      id,
      version: StudioTransport.versionWire(version),
    }),
  copyMarkdown: async (markdown: string) => {
    await service.CopyMarkdown({ markdown });
  },
});

Object.assign(window, { releaseNotes: StudioBridge });
