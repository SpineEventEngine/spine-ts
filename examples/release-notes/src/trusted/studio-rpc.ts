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

import { clipboard, ipc, workspace, type BrowserWindow, type RequestContext } from "@mobrowser/api";
import type { DesktopAuth, DesktopAuthStatus } from "./desktop-auth.js";
import type { PlanModelSelection } from "./plan-model-selection.js";
import type { ReleaseStudio, StudioComparison } from "./studio-service.js";
import { validateAccountInput } from "./studio-account-input.js";
import { StudioAccountGate } from "./studio-account-gate.js";
import { StudioDesktop } from "./studio-desktop.js";
import { StudioIpcErrors } from "./studio-ipc-errors.js";
import { validateStudioIpc, type StudioIpcCommand } from "./studio-ipc.js";
import { StudioTransport } from "./studio-transport.js";
import { StudioServiceDescriptor, type StudioService } from "../main/gen/ipc_service.js";
import type { Comparison } from "../main/gen/studio.js";

interface Services {
  window: BrowserWindow;
  auth: DesktopAuth;
  plan: PlanModelSelection;
  studio: ReleaseStudio;
}

const statusView = (value: DesktopAuthStatus) => ({
  ...value,
  pendingClientIds: [...value.pendingClientIds],
  accounts: value.accounts.map((account) => ({ ...account })),
});
const comparisonView = (value: StudioComparison): Comparison => ({
  ...value,
  changes: value.changes.map((change) => ({ ...change })),
  commits: value.commits.map((commit) => ({ ...commit, parents: [...commit.parents] })),
  evidence: value.evidence.map((item) => ({ ...item })),
});

/**
 * Applies one browser identity check, validation gate, and safe error boundary.
 */
class RpcContext {
  /**
   * Creates an IPC context for this application's services.
   *
   * @param services Session-only trusted services.
   */
  constructor(readonly services: Services) {}

  /**
   * Checks the sending browser before a trusted action.
   *
   * @typeParam T Action result.
   * @param name Fixed operation name.
   * @param ctx Vendor request context.
   * @param action Trusted action to run.
   * @returns Sanitized action result.
   */
  async call<T>(name: string, ctx: RequestContext, action: () => Promise<T>): Promise<T> {
    return StudioIpcErrors.execute(name, async () => {
      if (ctx.browser !== this.services.window.browser)
        throw new Error("IPC sender is not the application renderer.");
      if (this.services.studio.isClosing()) throw new Error("Studio is closing.");
      return action();
    });
  }

  /**
   * Validates an account action and holds its transition gate.
   *
   * @typeParam T Action result.
   * @param name Fixed account action name.
   * @param input Account action input.
   * @param ctx Vendor request context.
   * @param action Trusted account action.
   * @returns Sanitized account result.
   */
  async account<T>(
    name: string,
    input: unknown,
    ctx: RequestContext,
    action: () => Promise<T>,
  ): Promise<T> {
    return this.call(name, ctx, async () => {
      validateAccountInput(name, input);
      return StudioAccountGate.run(this.services.studio, name, action);
    });
  }

  /**
   * Dispatches one validated Studio action.
   *
   * @typeParam T Action result.
   * @param name Fixed Studio action name.
   * @param input Studio action input.
   * @param ctx Vendor request context.
   * @returns Sanitized Studio result.
   */
  async studioAction<T>(name: StudioIpcCommand, input: unknown, ctx: RequestContext): Promise<T> {
    return this.call(
      name,
      ctx,
      async () =>
        StudioDesktop.action(
          this.services.window,
          this.services.studio,
          name,
          validateStudioIpc(name, input),
        ) as Promise<T>,
    );
  }
}

const StudioRpcOperations = {
  /**
   * Creates account-state and model-discovery operations.
   *
   * @param rpc Trusted browser and account boundary.
   * @returns Fixed status operations.
   */
  accountStatusOperations(
    rpc: RpcContext,
  ): Pick<StudioService, "Status" | "CurrentModel" | "SignIn" | "Models"> {
    const { auth, plan } = rpc.services;
    return {
      Status: (_request, ctx) =>
        rpc.account("status", null, ctx, async () => statusView(await auth.status())),
      CurrentModel: (_request, ctx) =>
        rpc.account("current-model", null, ctx, async () => ({
          model: (await plan.activeBinding())?.model ?? "",
        })),
      SignIn: (_request, ctx) =>
        rpc.account("sign-in", null, ctx, async () => statusView(await auth.signInOrResume())),
      Models: (request, ctx) =>
        rpc.account("models", request.clientId, ctx, async () => ({
          models: [...(await auth.models(request.clientId))],
        })),
    };
  },

  /**
   * Creates account-selection, sign-out, and usage operations.
   *
   * @param rpc Trusted browser and account boundary.
   * @returns Fixed account management operations.
   */
  accountManagementOperations(
    rpc: RpcContext,
  ): Pick<StudioService, "SelectModel" | "SignOut" | "ManageUsage"> {
    const { auth, plan } = rpc.services;
    return {
      SelectModel: (request, ctx) =>
        rpc.account("select-model", request, ctx, async () => {
          await plan.selectDiscovered(request.clientId, request.model);
          return { model: request.model };
        }),
      SignOut: (request, ctx) =>
        rpc.account("sign-out", request.clientId, ctx, async () => {
          const result = await auth.signOut(request.clientId);
          return {
            status: statusView(result.status),
            revocationConfirmed: result.revocationConfirmed,
          };
        }),
      ManageUsage: (_request, ctx) =>
        rpc.account("usage", null, ctx, () => {
          workspace.openUrl("https://chatgpt.com/#settings/usage");
          return Promise.resolve({});
        }),
    };
  },

  /**
   * Creates session, project picker, and comparison operations.
   *
   * @param rpc Trusted browser and Studio boundary.
   * @returns Fixed project operations.
   */
  projectOperations(
    rpc: RpcContext,
  ): Pick<StudioService, "Session" | "ChooseProject" | "CompareProject"> {
    return {
      Session: (_request, ctx) => rpc.studioAction("session", null, ctx),
      ChooseProject: async (_request, ctx) => {
        const project = await rpc.studioAction<{
          handle: string;
          name: string;
          refs: readonly string[];
        } | null>("choose-project", null, ctx);
        return { project: project ? { ...project, refs: [...project.refs] } : undefined };
      },
      CompareProject: (request, ctx) =>
        rpc.call("compare-project", ctx, async () => {
          const input = validateStudioIpc("compare-project", request);
          if (!input) throw new Error("Invalid comparison request.");
          return comparisonView(
            await rpc.services.studio.compareProject(
              input.handle as string,
              input.base as string,
              input.target as string,
            ),
          );
        }),
    };
  },

  /**
   * Creates comparison picker and evidence operations.
   *
   * @param rpc Trusted browser and Studio boundary.
   * @returns Fixed comparison operations.
   */
  comparisonOperations(rpc: RpcContext): Pick<StudioService, "ChooseComparison" | "EvidencePatch"> {
    return {
      ChooseComparison: async (request, ctx) => {
        const comparison = await rpc.studioAction<StudioComparison | null>(
          "choose-comparison",
          { base: request.base, target: request.target },
          ctx,
        );
        return { comparison: comparison ? comparisonView(comparison) : undefined };
      },
      EvidencePatch: (request, ctx) => rpc.studioAction("evidence-patch", request, ctx),
    };
  },

  /**
   * Creates draft lifecycle and generation operations.
   *
   * @param rpc Trusted browser and Studio boundary.
   * @returns Fixed draft operations.
   */
  draftOperations(
    rpc: RpcContext,
  ): Pick<StudioService, "OpenDraft" | "ReadDraft" | "CancelGeneration"> {
    return {
      OpenDraft: (request, ctx) =>
        rpc.call("open-draft", ctx, async () =>
          StudioTransport.draft(
            await StudioDesktop.openDraft(
              rpc.services.studio,
              validateStudioIpc("open-draft", request),
            ),
          ),
        ),
      ReadDraft: (request, ctx) =>
        rpc.call("read-draft", ctx, async () => {
          const input = validateStudioIpc("read-draft", request);
          return StudioTransport.draft(await rpc.services.studio.readDraft(input?.id as string));
        }),
      CancelGeneration: (request, ctx) =>
        rpc.call("cancel-generation", ctx, async () => {
          const input = validateStudioIpc("cancel-generation", request);
          return StudioTransport.draft(
            await rpc.services.studio.cancelGeneration(
              input?.id as string,
              input?.generation as string,
            ),
          );
        }),
    };
  },

  /**
   * Creates fixed generation admission and phase operations.
   *
   * @param rpc Trusted browser and Studio boundary.
   * @returns Generation operations.
   */
  generationOperations(
    rpc: RpcContext,
  ): Pick<StudioService, "Generate" | "RepeatGeneration" | "Phase"> {
    return {
      Generate: (request, ctx) => rpc.studioAction("generate", request, ctx),
      RepeatGeneration: (request, ctx) => rpc.studioAction("repeat-generation", request, ctx),
      Phase: (request, ctx) => rpc.studioAction("phase", request, ctx),
    };
  },

  /**
   * Creates the indexed Agent history operation.
   *
   * @param rpc Trusted browser and Studio boundary.
   * @returns Fixed history operation.
   */
  historyOperations(rpc: RpcContext): Pick<StudioService, "History"> {
    return {
      History: (request, ctx) =>
        rpc.call("history", ctx, async () => {
          const account = await rpc.services.auth.status();
          if (!account.planEnabled || !account.selectedClientId)
            throw new Error("Sign in to read release history.");
          const input = validateStudioIpc("history", {
            id: request.id,
            category: request.category,
            pageSize: request.pageSize,
            ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
          });
          if (!input) throw new Error("Invalid history request.");
          const page = await rpc.services.studio.history(
            input.id as string,
            input.category as "all" | "conversation" | "system" | "domain",
            input.pageSize as number,
            input.cursor as string | undefined,
          );
          const current = await rpc.services.auth.status();
          if (!current.planEnabled || current.selectedClientId !== account.selectedClientId)
            throw new Error("Sign in to read release history.");
          return {
            itemsJson: page.items.map((item) => JSON.stringify(item)),
            ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
          };
        }),
    };
  },

  /**
   * Creates exact Markdown editing and preview operations.
   *
   * @param rpc Trusted browser and Studio boundary.
   * @returns Fixed editor operations.
   */
  editorOperations(rpc: RpcContext): Pick<StudioService, "Edit" | "Preview"> {
    const { studio } = rpc.services;
    return {
      Edit: (request, ctx) =>
        rpc.call("edit", ctx, async () =>
          StudioTransport.draft(
            await StudioDesktop.editDraft(
              studio,
              validateStudioIpc("edit", {
                id: request.id,
                version: StudioTransport.versionJson(request.version),
                markdown: new Uint8Array(request.markdown),
              }),
            ),
          ),
        ),
      Preview: async (request, ctx) => {
        const result = await rpc.studioAction<{
          version: object;
          markdown: Uint8Array;
          digest: string;
        }>("preview", request, ctx);
        return {
          version: Buffer.from(StudioTransport.versionWire(result.version)),
          markdown: Buffer.from(result.markdown),
          digest: result.digest,
        };
      },
    };
  },

  /**
   * Creates native Markdown export and clipboard operations.
   *
   * @param rpc Trusted browser and Studio boundary.
   * @returns Fixed output operations.
   */
  outputOperations(rpc: RpcContext): Pick<StudioService, "ExportMarkdown" | "CopyMarkdown"> {
    const { window, studio } = rpc.services;
    return {
      ExportMarkdown: (request, ctx) =>
        rpc.call(
          "export",
          ctx,
          async () =>
            StudioDesktop.action(
              window,
              studio,
              "export",
              validateStudioIpc("export", {
                id: request.id,
                version: StudioTransport.versionJson(request.version),
              }),
            ) as Promise<{ saved: boolean }>,
        ),
      CopyMarkdown: (request, ctx) =>
        rpc.call("copy", ctx, () => {
          clipboard.write("text/plain", request.markdown);
          return Promise.resolve({});
        }),
    };
  },
};

/**
 * Registers the fixed desktop operations with browser identity, semantic input checks, and safe errors.
 *
 * @param services Trusted in-memory Studio services and its only application window.
 */
export const registerStudioRpc = (services: Services): void => {
  const rpc = new RpcContext(services);
  const service: StudioService = {
    ...StudioRpcOperations.accountStatusOperations(rpc),
    ...StudioRpcOperations.accountManagementOperations(rpc),
    ...StudioRpcOperations.projectOperations(rpc),
    ...StudioRpcOperations.comparisonOperations(rpc),
    ...StudioRpcOperations.draftOperations(rpc),
    ...StudioRpcOperations.generationOperations(rpc),
    ...StudioRpcOperations.historyOperations(rpc),
    ...StudioRpcOperations.editorOperations(rpc),
    ...StudioRpcOperations.outputOperations(rpc),
  };
  ipc.registerService(StudioServiceDescriptor, service);
};
