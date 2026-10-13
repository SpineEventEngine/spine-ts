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

import type { ReactElement, ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, Download, FileText, LogOut, Plus } from "lucide-react";

/**
 * One release shown on the in-memory session dashboard.
 */
export interface SessionRelease {
  /**
   * Draft identifier used to reopen it.
   */
  readonly id: string;

  /**
   * Editor-facing release title.
   */
  readonly title: string;

  /**
   * Git project display name.
   */
  readonly subtitle?: string;

  /**
   * Bounded comparison summary.
   */
  readonly summary?: string;

  /**
   * Trusted content-change timestamp for the session card.
   */
  readonly lastEditedAt?: string | undefined;
}

/**
 * Renders the fixed brand and explicit session sign-out action.
 *
 * @param signOut Requests a safe sign-out after pending work settles.
 * @param disabled Whether sign-out is already in progress.
 * @returns The application header.
 */
export const StudioTopBar = ({
  signOut,
  disabled = false,
}: {
  signOut: () => void;
  disabled?: boolean;
}): ReactElement => (
  <header className="rs-topbar">
    <div className="rs-brand">
      <FileText aria-hidden="true" size={20} />
      <span>Release Notes Studio</span>
    </div>
    <button
      type="button"
      className="rs-sign-out"
      aria-label="Sign out"
      title="Sign out"
      disabled={disabled}
      onClick={signOut}
    >
      <LogOut aria-hidden="true" size={18} />
    </button>
  </header>
);

/**
 * Renders current-session drafts and the new-release entry action.
 *
 * @param releases Drafts available in this session.
 * @param newRelease Opens the changes wizard.
 * @param openRelease Opens one retained draft.
 * @returns The dashboard.
 */
export const DashboardView = ({
  releases,
  newRelease,
  openRelease,
}: {
  releases: readonly SessionRelease[];
  newRelease: () => void;
  openRelease: (id: string) => void;
}): ReactElement => (
  <section className="rs-dashboard">
    <DashboardHeading newRelease={newRelease} />
    {releases.length > 0 ? (
      <div className="rs-release-grid">
        {releases.map((release) => (
          <ReleaseCard key={release.id} release={release} openRelease={openRelease} />
        ))}
      </div>
    ) : (
      <div className="rs-empty-dashboard">
        <span className="rs-card-icon">
          <FileText aria-hidden="true" size={19} />
        </span>
        <h2>No releases yet.</h2>
      </div>
    )}
    <p className="rs-session-note">
      <Download aria-hidden="true" size={16} /> Export to keep a copy after closing the app.
    </p>
  </section>
);

const DashboardHeading = ({ newRelease }: { newRelease: () => void }): ReactElement => (
  <div className="rs-dashboard-heading">
    <div>
      <h1>Your releases</h1>
      <p>This session</p>
    </div>
    <button type="button" className="rs-primary" onClick={newRelease}>
      <Plus aria-hidden="true" size={17} /> New release
    </button>
  </div>
);

const ReleaseCard = ({
  release,
  openRelease,
}: {
  release: SessionRelease;
  openRelease: (id: string) => void;
}): ReactElement => (
  <button
    type="button"
    className="rs-release-card"
    onClick={() => {
      openRelease(release.id);
    }}
  >
    <span className="rs-card-icon">
      <FileText aria-hidden="true" size={19} />
    </span>
    <strong>{release.title}</strong>
    {release.subtitle && <span className="rs-card-subtitle">{release.subtitle}</span>}
    <span className="rs-card-summary">{release.summary ?? "Open and continue editing."}</span>
    <span className="rs-card-bottom">
      {release.lastEditedAt
        ? `Edited ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(release.lastEditedAt))}`
        : "Saved for this session"}
      <ArrowRight aria-hidden="true" size={17} />
    </span>
  </button>
);

/**
 * Visible step of new-release creation.
 */
export type WizardStep = "changes" | "review" | "style" | "writing";
const steps: readonly { value: WizardStep; label: string }[] = [
  { value: "changes", label: "Changes" },
  { value: "review", label: "Review" },
  { value: "style", label: "Style" },
  { value: "writing", label: "Write" },
];

/**
 * Renders the current wizard step.
 *
 * @param step Current creation step.
 * @returns The accessible step list.
 */
export const WizardProgress = ({ step }: { step: WizardStep }): ReactElement => {
  const current = steps.findIndex((item) => item.value === step);
  return (
    <ol className="rs-wizard-progress" aria-label="New release progress">
      {steps.map((item, index) => (
        <li
          key={item.value}
          className={index === current ? "current" : index < current ? "complete" : "upcoming"}
          aria-current={index === current ? "step" : undefined}
        >
          <span className="rs-step-number">
            {index < current ? <Check aria-hidden="true" size={15} /> : index + 1}
          </span>
          <span>{item.label}</span>
        </li>
      ))}
    </ol>
  );
};

/**
 * Renders shared geometry for each new-release step.
 *
 * @param step Current creation step.
 * @param dashboard Returns to the dashboard.
 * @param heading Current form heading.
 * @param children Form content.
 * @param footer Step actions.
 * @returns The wizard card.
 */
export const WizardFrame = ({
  step,
  dashboard,
  heading,
  children,
  footer,
}: {
  step: WizardStep;
  dashboard: () => void;
  heading?: string;
  children: ReactNode;
  footer: ReactNode;
}): ReactElement => (
  <section className="rs-wizard">
    <button type="button" className="rs-back-link" onClick={dashboard}>
      <ArrowLeft aria-hidden="true" size={16} /> Dashboard
    </button>
    <h1>New release</h1>
    <WizardProgress step={step} />
    <div className="rs-wizard-card">
      <div className="rs-wizard-body">
        {heading && <h2>{heading}</h2>}
        {children}
      </div>
      <div className="rs-wizard-footer">{footer}</div>
    </div>
  </section>
);
