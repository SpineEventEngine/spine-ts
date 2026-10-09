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

import {
  ModelRef,
  type AiBackendRegistration,
  type AiConnectionIdentity,
} from "@spine-event-engine/ai";

import type { DesktopAuth } from "./desktop-auth.js";
import type { SiwcSession } from "./siwc-session.js";

type AuthPort = Pick<DesktopAuth, "status">;
type SessionPort = Pick<SiwcSession, "models" | "accessToken">;

interface Selection {
  /**
   * Issued OAuth client identifier.
   */
  readonly clientId: string;

  /**
   * Verified account subject.
   */
  readonly subject: string;

  /**
   * Account-advertised model slug selected for this registration.
   */
  readonly model: string;

  /**
   * Authorized deployment registration bound to this account and model.
   */
  readonly registration: AiBackendRegistration;
}

/**
 * Binds a discovered model to one verified ChatGPT account registration.
 */
export class PlanModelSelection {
  /**
   * Current in-memory deployment choice, if the user selected a model.
   */
  private selected: Selection | undefined;

  private selectionVersion = 0;

  /**
   * Initializes the trusted service.
   *
   * @param auth Trusted account status service.
   * @param session Trusted catalog and access-token service.
   */
  constructor(
    private readonly auth: AuthPort,
    private readonly session: SessionPort,
  ) {}

  /**
   * Binds a discovered account model to this application's deployment reference.
   *
   * @param clientId Issued OAuth registration identifier.
   * @param model Account-advertised model slug.
   * @returns Registration for the selected plan model.
   */
  async selectDiscovered(clientId: string, model: string): Promise<AiBackendRegistration> {
    return this.select(clientId, model, ModelRef.of("release-notes-plan", `${clientId}:${model}`));
  }

  /**
   * Sets a model advertised for the verified account.
   *
   * @param clientId Issued OAuth client identifier.
   * @param model Account-advertised model slug.
   * @param ref Immutable deployment reference for the selected model.
   * @returns Registration bound to the verified account and model.
   */
  async select(clientId: string, model: string, ref: ModelRef): Promise<AiBackendRegistration> {
    const version = ++this.selectionVersion;
    const status = await this.auth.status();
    const account = status.accounts.find((candidate) => candidate.clientId === clientId);
    if (status.selectedClientId !== clientId || !account?.planEnabled || !status.planEnabled) {
      throw new Error("ChatGPT plan account is not selected.");
    }
    if (!(await this.session.models(clientId)).some((candidate) => candidate.slug === model)) {
      throw new Error("Model is not available to this account.");
    }
    await this.assertSelectionCurrent(version, clientId, account.subject);
    const selection = { clientId, subject: account.subject, model };
    const identity: AiConnectionIdentity = Object.freeze({
      provider: "openai-chatgpt-plan",
      account: `${clientId}:${account.subject}`,
      endpoint: "https://api.openai.com/v1",
      model,
    });
    const registration = await this.createRegistration(ref, selection, identity);
    await this.assertSelectionCurrent(version, clientId, account.subject);
    this.selected = { ...selection, registration };
    return registration;
  }

  /**
   * Rejects a selection superseded by a later choice or account change.
   *
   * @param version Local selection attempt used to reject delayed completions.
   * @param clientId The issued client identifier.
   * @param subject The verified account subject.
   * @returns After the account and selection still match.
   */
  private async assertSelectionCurrent(version: number, clientId: string, subject: string) {
    const status = await this.auth.status();
    const account = status.accounts.find((candidate) => candidate.clientId === clientId);
    if (
      version !== this.selectionVersion ||
      status.selectedClientId !== clientId ||
      !status.planEnabled ||
      !account?.planEnabled ||
      account.subject !== subject
    ) {
      throw new Error("ChatGPT account or model selection changed.");
    }
  }

  /**
   * Checks that the account and model selection remain valid.
   *
   * @param selection Account and model binding to verify.
   * @returns Whether the binding remains selected and plan-enabled.
   */
  private async active(selection: Omit<Selection, "registration">): Promise<boolean> {
    const current = await this.auth.status();
    const account = current.accounts.find((candidate) => candidate.clientId === selection.clientId);
    return (
      this.selected?.clientId === selection.clientId &&
      this.selected.model === selection.model &&
      current.selectedClientId === selection.clientId &&
      current.planEnabled &&
      account?.subject === selection.subject &&
      account.planEnabled
    );
  }

  /**
   * Creates a plan model registration bound to the verified account.
   *
   * @param ref Immutable deployment reference.
   * @param selection Verified account and model binding.
   * @param identity Authorized provider deployment identity.
   * @returns Registration whose callbacks recheck this binding.
   */
  private async createRegistration(
    ref: ModelRef,
    selection: Omit<Selection, "registration">,
    identity: AiConnectionIdentity,
  ): Promise<AiBackendRegistration> {
    const { VercelAx } = await import("@spine-event-engine/ai-vercel-ax");
    const registration = VercelAx.chatgptPlanModel({
      ref,
      resolveIdentity: () => identity,
      authorizeUse: async (_scope, expected) =>
        (await this.active(selection)) &&
        expected.provider === identity.provider &&
        expected.account === identity.account &&
        expected.endpoint === identity.endpoint &&
        expected.model === identity.model,
      connect: async () => {
        if (
          !(await this.active(selection)) ||
          !(await this.session.models(selection.clientId)).some(
            (candidate) => candidate.slug === selection.model,
          ) ||
          !(await this.active(selection))
        ) {
          throw new Error("ChatGPT account or model selection changed.");
        }
        const accessToken = await this.session.accessToken(selection.clientId);
        if (!(await this.active(selection))) {
          throw new Error("ChatGPT account or model selection changed.");
        }
        return { accessToken, identity };
      },
    });
    return registration;
  }

  /**
   * Returns the selected plan model registration.
   *
   * @returns Selected registration, if one was chosen in this session.
   */
  current(): AiBackendRegistration | undefined {
    return this.selected?.registration;
  }

  /**
   * Returns a credential-free selection only while its account and model remain available.
   *
   * @returns Current authorized registration identity for a generation Command.
   */
  async activeBinding(): Promise<
    | {
        readonly clientId: string;
        readonly subject: string;
        readonly model: string;
        readonly registration: AiBackendRegistration;
      }
    | undefined
  > {
    const selected = this.selected;
    if (!selected || !(await this.active(selected))) return undefined;
    if (
      !(await this.session.models(selected.clientId)).some((item) => item.slug === selected.model)
    )
      return undefined;
    if (!(await this.active(selected))) return undefined;
    return { ...selected };
  }
}
